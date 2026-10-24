import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectBallDontLieSnapshot, createBallDontLieClient, saveBallDontLieSnapshot, statPages,
} from "../../scripts/collect-balldontlie.ts";
import { apiDate, hasAppearance, normalizeBallDontLieRookie } from "./balldontlie.ts";
import type { ApiRow } from "./balldontlie.ts";
import { validateSnapshot } from "./snapshot.ts";
import { createSnapshotProvider } from "./snapshot-provider.ts";
import { selectRookieProvider } from "./data.ts";
import { rankRookies } from "./scoring.ts";

// Synthetic endpoint-shaped fixtures; not official player data.
const home = { id: 1, full_name: "Test Home", abbreviation: "HOM" };
const away = { id: 2, full_name: "Test Away", abbreviation: "AWY" };
const teams = new Map([[1, home], [2, away]]);
const player = {
  id: 123, first_name: "Test", last_name: "Rookie", position: "G-F",
  jersey_number: "00", draft_year: 2023, draft_number: null,
};
const line = (index = 1): ApiRow => ({
  id: index, player, team: home, min: "20:30",
  pts: 10, reb: 4, ast: 3, stl: 1, blk: 0,
  fgm: 4, fga: 10, fg3m: 0, fg3a: 0, ftm: 2, fta: 2,
  game: {
    id: index, date: `2025-10-${String(index).padStart(2, "0")}`, season: 2025,
    postseason: false, status: "Final", home_team_id: 1, visitor_team_id: 2,
  },
});
const response = (data: ApiRow[], next: number | null = null) => ({ data, meta: { next_cursor: next } });
const fixtureRequest = async (endpoint: string, params: URLSearchParams) => {
  if (endpoint === "teams") return { data: [home, away] };
  if (params.has("player_ids[]")) return response([]);
  return response([line()]);
};

test("ALL-STAR box scores produce full season averages, weighted shooting, and last ten logs", () => {
  const rows = Array.from({ length: 12 }, (_, index) => line(index + 1));
  rows[0] = { ...rows[0], fgm: 1, fga: 1 };
  const rookie = normalizeBallDontLieRookie(rows.reverse(), teams);
  assert.equal(rookie.id, "123");
  assert.equal(rookie.position, "Guard");
  assert.equal(rookie.number, 0);
  assert.equal(rookie.age, null);
  assert.equal(rookie.draftPick, null);
  assert.equal(rookie.stats.gamesPlayed, 12);
  assert.equal(rookie.stats.points, 10);
  assert.equal(rookie.stats.fieldGoalPct, 45 / 111);
  assert.equal(rookie.stats.threePointPct, 0);
  assert.equal(rookie.stats.freeThrowPct, 1);
  assert.equal(rookie.games.length, 10);
  assert.equal(rookie.games[0].date, "2025-10-03T00:00:00.000Z");
  assert.equal(rookie.games.at(-1)?.opponent, "vs. AWY");
  assert.equal(rows[0].id, 12);
  const traded = normalizeBallDontLieRookie([line(), { ...line(2), team: away }], teams);
  assert.equal(traded.teamCode, "AWY");
  assert.equal(traded.stats.gamesPlayed, 2);
  assert.equal(traded.games.at(-1)?.opponent, "@ HOM");
});

test("invalid, missing, duplicate, or mismatched box scores fail rather than inventing stats", () => {
  for (const row of [
    { ...line(), pts: null }, { ...line(), reb: -1 }, { ...line(), ast: 0.5 },
    { ...line(), fgm: 11 }, { ...line(), team: { ...home, id: 3 } },
    { ...line(), player: { ...player, position: null } },
    { ...line(), game: { ...line().game as ApiRow, date: "2025-02-30" } },
  ]) assert.throws(() => normalizeBallDontLieRookie([row], teams));
  assert.throws(() => normalizeBallDontLieRookie([line(), line()], teams), /duplicate/);
  assert.throws(() => normalizeBallDontLieRookie([line(), {
    ...line(2), player: { ...player, id: 456 },
  }], teams), /mismatched/);
  assert.throws(() => normalizeBallDontLieRookie([line()], new Map()), /opponent/);
  assert.throws(() => apiDate("invalid"));
});

test("minutes distinguish DNPs, whole minutes, and sub-minute appearances", () => {
  for (const min of ["1", "0:01", "20:30"]) assert.equal(hasAppearance({ min }), true);
  for (const min of [null, "", "0", "00:00"]) assert.equal(hasAppearance({ min }), false);
  assert.equal(hasAppearance({ min: "0:00", reb: 1 }), true);
  assert.equal(hasAppearance({ min: null, pts: 10 }), true);
  for (const min of [undefined, "DNP", "1:99", 12]) assert.throws(() => hasAppearance({ min }));
});

test("pagination traverses every page and rejects malformed or looping responses", async () => {
  const calls: string[] = [];
  const pages = [];
  for await (const page of statPages(async (_endpoint, params) => {
    calls.push(params.get("cursor") ?? "first");
    return response([line()], params.has("cursor") ? null : 77);
  }, new URLSearchParams())) pages.push(page);
  assert.equal(pages.length, 2);
  assert.deepEqual(calls, ["first", "77"]);
  for (const payload of [{}, { data: [] }, { data: [], meta: { next_cursor: "bad" } },
    response([line()], 77), response([], 77)]) {
    await assert.rejects(async () => {
      for await (const page of statPages(async () => payload, new URLSearchParams())) void page;
    });
  }
});

test("collector discovers delayed/undrafted first-season players, excludes veterans, DNPs and live games", async () => {
  const calls: URLSearchParams[] = [];
  const snapshot = await collectBallDontLieSnapshot("2025-26", async (endpoint, params) => {
    calls.push(new URLSearchParams(params));
    if (endpoint === "teams") return { data: [home, away] };
    assert.equal(params.get("postseason"), "false");
    if (params.has("player_ids[]")) {
      assert.ok(params.getAll("seasons[]").includes("1946"));
      assert.equal(params.getAll("seasons[]").at(-1), "2024");
      assert.ok(!params.getAll("seasons[]").includes("2025"));
      const id = Number(params.get("player_ids[]"));
      const historical = {
        ...line(), player: { ...player, id },
        game: { ...line().game as ApiRow, season: 2024 },
      };
      if (id === 456) return response([historical]);
      if (!params.has("cursor")) return response([{ min: null, player: { id }, game: historical.game }], 55);
      return response([]);
    }
    assert.equal(params.get("seasons[]"), "2025");
    assert.equal(params.get("per_page"), "100");
    if (params.has("cursor")) return response([line(2)]);
    return response([
      line(),
      { ...line(), player: { ...player, id: 456 } },
      { min: null, player: { id: 789 }, game: line().game },
      { ...line(), player: { ...player, id: 999 }, game: { ...line().game as ApiRow, status: "2nd Qtr" } },
    ], 99);
  });
  assert.equal(snapshot.sourceMetadata?.provider, "BALLDONTLIE");
  assert.equal(snapshot.rookies.length, 1);
  assert.equal(snapshot.rookies[0].id, "123");
  assert.equal(snapshot.rookies[0].stats.gamesPlayed, 2);
  assert.equal(snapshot.rookies[0].games.length, 2);
  assert.match(snapshot.sourceMetadata!.warnings.join(" "), /not an official NBA eligibility list/);
  assert.equal(validateSnapshot(snapshot), snapshot);
  const loaded = await selectRookieProvider("snapshot",
    createSnapshotProvider(async () => JSON.stringify(snapshot))).getSnapshot();
  assert.deepEqual(loaded, snapshot);
  assert.ok(rankRookies(loaded.rookies, loaded.scheduledGames)[0].score > 0);
  assert.equal(calls.filter((params) => params.get("player_ids[]") === "123").length, 2);
});

test("empty, wrong-season, duplicate, incomplete, and failed collections do not replace good snapshots", async () => {
  const folder = await mkdtemp(join(tmpdir(), "balldontlie-"));
  const output = join(folder, "snapshot.json");
  try {
    const saved = await saveBallDontLieSnapshot("2025-26", output, fixtureRequest);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), saved);
    await writeFile(output, "last successful snapshot");
    const failures = [
      async () => { throw new Error("HTTP 429"); },
      async (endpoint: string, params: URLSearchParams) =>
        endpoint === "teams" ? fixtureRequest(endpoint, params) : response([]),
      ...[
        [{ ...line(), pts: null }],
        [line(), line()],
        [{ ...line(), game: { ...line().game as ApiRow, postseason: true } }],
        [{ ...line(), game: { ...line().game as ApiRow, season: 2024 } }],
      ].map((data) => async (endpoint: string, params: URLSearchParams) => {
        if (endpoint === "teams") return fixtureRequest(endpoint, params);
        return response(params.has("player_ids[]") ? [] : data);
      }),
    ];
    for (const request of failures) {
      await assert.rejects(saveBallDontLieSnapshot("2025-26", output, request));
      assert.equal(await readFile(output, "utf8"), "last successful snapshot");
      assert.deepEqual(await readdir(folder), ["snapshot.json"]);
    }
    await assert.rejects(collectBallDontLieSnapshot("2025-27", fixtureRequest), /consecutive/);
    await assert.rejects(collectBallDontLieSnapshot("9998-99", fixtureRequest), /next year/);
    await assert.rejects(saveBallDontLieSnapshot("2025-26", folder, fixtureRequest));
    assert.deepEqual(await readdir(folder), ["snapshot.json"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("API client uses server-side authorization, paces requests, retries transient failures and honors Retry-After", async () => {
  assert.throws(() => createBallDontLieClient(""), /BALLDONTLIE_API_KEY/);
  const waits: number[] = [];
  let attempts = 0;
  const client = createBallDontLieClient("test-only", async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.balldontlie.io");
    assert.equal(url.pathname, "/nba/v1/stats");
    assert.equal(url.searchParams.get("seasons[]"), "2025");
    assert.deepEqual(options?.headers, { Authorization: "test-only", Accept: "application/json" });
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    attempts++;
    return attempts === 1 ? new Response("", { status: 429, headers: { "Retry-After": "10" } })
      : Response.json(response([]));
  }, async (ms) => { waits.push(ms); });
  assert.deepEqual(await client("stats", new URLSearchParams({ "seasons[]": "2025" })), response([]));
  assert.deepEqual(waits, [1100, 10000, 1100]);
  for (const status of [401, 403, 404, 500]) {
    let count = 0;
    const blocked = createBallDontLieClient("test-only", async () => {
      count++;
      return new Response("", { status });
    }, async () => {});
    await assert.rejects(blocked("stats", new URLSearchParams()), new RegExp(`HTTP ${status}`));
    assert.equal(count, status === 500 ? 3 : 1);
  }
  const longWait = createBallDontLieClient("test-only", async () =>
    new Response("", { status: 429, headers: { "Retry-After": "300" } }), async () => {});
  await assert.rejects(longWait("stats", new URLSearchParams()), /long Retry-After/);
  const invalid = createBallDontLieClient("test-only", async () => new Response("<html>"),
    async () => {});
  await assert.rejects(invalid("stats", new URLSearchParams()), /valid JSON/);
  let offlineAttempts = 0;
  const offline = createBallDontLieClient("test-only", async () => {
    offlineAttempts++;
    throw new Error("sensitive request headers must not be logged");
  }, async () => {});
  await assert.rejects(offline("stats", new URLSearchParams()), /^Error: stats: network\/timeout failure after 3 attempts\.$/);
  assert.equal(offlineAttempts, 3);
});
