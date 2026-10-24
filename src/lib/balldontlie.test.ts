import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectBallDontLieSnapshot, createBallDontLieClient, createCollectionMetrics,
  saveBallDontLieSnapshot, statPages,
} from "../../scripts/collect-balldontlie.ts";
import type { Request } from "../../scripts/collect-balldontlie.ts";
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
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
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
  }, async (ms) => { waits.push(ms); }, { now: () => 0 });
  assert.deepEqual(await client("stats", new URLSearchParams({ "seasons[]": "2025" })), response([]));
  assert.deepEqual(waits, [1100, 10000]);
  for (const status of [401, 403, 404, 500]) {
    let count = 0;
    const metrics = createCollectionMetrics();
    const blocked = createBallDontLieClient("test-only", async () => {
      count++;
      return new Response("", { status });
    }, async () => {}, { metrics, now: () => 0 });
    await assert.rejects(blocked("stats", new URLSearchParams()), new RegExp(`HTTP ${status}`));
    assert.equal(count, status === 500 ? 3 : 1);
    assert.equal(metrics.requests.season, count);
    assert.equal(metrics.retries, count - 1);
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

const at = (date: string) => () => Date.parse(`${date}T12:00:00.000Z`);
const dataset = (rows: ApiRow[], history: (id: number) => ApiRow[] = () => []): Request =>
  async (endpoint, params) => {
    if (endpoint === "teams") return { data: [home, away] };
    if (params.has("player_ids[]")) return response(history(Number(params.get("player_ids[]"))));
    const start = params.get("start_date");
    return response(rows.filter((row) => !start ||
      String((row.game as ApiRow).date).slice(0, 10) >= start));
  };
const dnp = (row: ApiRow): ApiRow => ({
  ...row, min: null, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
  fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
});

test("cold and warm caches equal full scans across corrections, removals, DNPs, live games and new debuts", async () => {
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
  const cache = join(folder, "2025-26.json");
  const output = join(folder, "snapshot.json");
  try {
    const initial = [line(1), line(8), line(9), line(10), line(11)];
    const coldMetrics = createCollectionMetrics();
    const cold = await saveBallDontLieSnapshot("2025-26", output, dataset(initial),
      { cache, now: at("2025-10-12"), metrics: coldMetrics });
    assert.deepEqual(cold, await collectBallDontLieSnapshot("2025-26", dataset(initial),
      { now: at("2025-10-12") }));
    assert.equal(coldMetrics.cache, "miss");
    assert.equal(coldMetrics.requests.history, 1);

    const corrected = [
      line(1), { ...line(8), pts: 20 }, dnp(line(10)),
      { ...line(11), game: { ...line(11).game as ApiRow, status: "1st Qtr" } },
      { ...line(15), player: { ...player, id: 777, draft_year: null, draft_number: null } },
      { ...line(16), player: { ...player, id: 888, draft_year: 2020 } },
    ];
    const calls: URLSearchParams[] = [];
    const warmMetrics = createCollectionMetrics();
    const source = dataset(corrected);
    const warm = await saveBallDontLieSnapshot("2025-26", output, async (endpoint, params) => {
      calls.push(new URLSearchParams(params));
      return source(endpoint, params);
    }, { cache, now: at("2025-10-20"), metrics: warmMetrics });
    const uncached = await collectBallDontLieSnapshot("2025-26", source, { now: at("2025-10-20") });
    assert.deepEqual(warm, uncached);
    assert.equal(calls.find((params) => params.has("start_date"))?.get("start_date"), "2025-10-05");
    assert.equal(warmMetrics.cache, "hit");
    assert.equal(warmMetrics.eligibilityHits, 1);
    assert.equal(warmMetrics.requests.history, 2);
    assert.deepEqual(warm.rookies.map((row) => row.id), ["123", "777", "888"]);
    assert.equal(warm.rookies[0].stats.gamesPlayed, 2);
    assert.equal(warm.rookies[0].stats.points, 15);
    const persisted = JSON.parse(await readFile(cache, "utf8"));
    assert.equal(persisted.collectedAt, warm.updatedAt);
    assert.equal(persisted.rows.length, 4);
    assert.deepEqual(await readdir(folder), ["2025-26.json", "snapshot.json"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("warm eligibility is season-scoped and full-refresh bypasses both history and box-score caches", async () => {
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
  const cache = join(folder, "cache.json");
  const output = join(folder, "snapshot.json");
  try {
    await saveBallDontLieSnapshot("2025-26", output, fixtureRequest, { cache, now: at("2025-10-12") });
    const fullMetrics = createCollectionMetrics();
    const query: URLSearchParams[] = [];
    const full = await saveBallDontLieSnapshot("2025-26", output, async (endpoint, params) => {
      query.push(new URLSearchParams(params));
      return fixtureRequest(endpoint, params);
    }, { cache, fullRefresh: true, now: at("2025-10-20"), metrics: fullMetrics });
    assert.equal(full.rookies.length, 1);
    assert.equal(fullMetrics.requests.history, 1);
    assert.equal(fullMetrics.eligibilityHits, 0);
    assert.equal(fullMetrics.cache, "full-refresh");
    assert.ok(query.every((params) => !params.has("start_date")));

    const nextYear = { ...line(2), game: { ...line(2).game as ApiRow, season: 2026, date: "2026-10-02" } };
    const newRookie = { ...nextYear, player: { ...player, id: 999 } };
    const diagnostics: string[] = [];
    const nextMetrics = createCollectionMetrics();
    const next = await saveBallDontLieSnapshot("2026-27", output, dataset([nextYear, newRookie],
      (id) => id === 123 ? [line()] : []), {
      cache, now: at("2026-10-20"), diagnostic: (message) => diagnostics.push(message), metrics: nextMetrics,
    });
    assert.deepEqual(next.rookies.map((row) => row.id), ["999"]);
    assert.equal(nextMetrics.requests.history, 2);
    assert.equal(nextMetrics.cache, "miss");
    assert.equal(diagnostics.length, 1);
    assert.equal(JSON.parse(await readFile(cache, "utf8")).season, "2026-27");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("malformed, incompatible and incomplete caches safely fall back to a full validated scan", async () => {
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
  const cache = join(folder, "cache.json");
  const output = join(folder, "snapshot.json");
  try {
    await saveBallDontLieSnapshot("2025-26", output, fixtureRequest, { cache, now: at("2025-10-12") });
    const good = JSON.parse(await readFile(cache, "utf8"));
    const invalid = [
      "{secret-response-body", "null", JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, collectedAt: "not a date" }),
      JSON.stringify({ ...good, collectedAt: "2099-01-01T00:00:00.000Z" }),
      JSON.stringify({ ...good, eligibility: { "123": "true" } }),
      JSON.stringify({ ...good, eligibility: {} }),
      JSON.stringify({ ...good, rows: [line(), line()] }),
      JSON.stringify({ ...good, rows: [{ ...line(), pts: null }] }),
      JSON.stringify({
        ...good, eligibility: { "123": true, "456": false },
        rows: [line(), { ...line(2), player: { ...player, id: 456 }, pts: null }],
      }),
      JSON.stringify({ ...good, rows: [dnp(line())] }),
      JSON.stringify({ ...good, rows: [{ ...line(), game: { ...line().game as ApiRow, season: 2024 } }] }),
    ];
    for (const value of invalid) {
      await writeFile(cache, value);
      const diagnostics: string[] = [];
      const metrics = createCollectionMetrics();
      const fresh = await collectBallDontLieSnapshot("2025-26", async (endpoint, params) => {
        assert.equal(params.has("start_date"), false);
        return fixtureRequest(endpoint, params);
      }, { cache, now: at("2025-10-20"), diagnostic: (message) => diagnostics.push(message), metrics });
      assert.equal(fresh.rookies.length, 1);
      assert.equal(metrics.requests.history, 1);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0], "BALLDONTLIE cache invalid or unreadable; using a full season/history scan.");
      assert.equal(await readFile(cache, "utf8"), value);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("failed incremental or full collections preserve both successful artifacts and reject duplicate refreshed rows", async () => {
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
  const cache = join(folder, "cache.json");
  const output = join(folder, "snapshot.json");
  try {
    await saveBallDontLieSnapshot("2025-26", output, dataset([line(), line(10)]),
      { cache, now: at("2025-10-12") });
    const snapshotBefore = await readFile(output, "utf8");
    const cacheBefore = await readFile(cache, "utf8");
    const failing: Request[] = [
      async () => { throw new Error("network failed"); },
      dataset([{ ...line(10), pts: null }]),
      dataset([line(10), line(10)]),
      dataset([dnp(line(10)), dnp(line(10))]),
      async (endpoint, params) => {
        if (endpoint === "teams") return { data: [home, away] };
        if (params.has("player_ids[]")) throw new Error("history unavailable");
        return response([{ ...line(15), player: { ...player, id: 777 } }]);
      },
      async (endpoint) => endpoint === "teams" ? { data: [home, away] } : response([line()]),
    ];
    for (const request of failing) {
      await assert.rejects(saveBallDontLieSnapshot("2025-26", output, request,
        { cache, now: at("2025-10-20") }));
      assert.equal(await readFile(output, "utf8"), snapshotBefore);
      assert.equal(await readFile(cache, "utf8"), cacheBefore);
      assert.deepEqual(await readdir(folder), ["cache.json", "snapshot.json"]);
    }
    await assert.rejects(saveBallDontLieSnapshot("2025-26", output, dataset([{ ...line(), pts: null }]),
      { cache, fullRefresh: true, now: at("2025-10-20") }));
    assert.equal(await readFile(cache, "utf8"), cacheBefore);

    const blocked = join(folder, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "entry"), "keep");
    await assert.rejects(saveBallDontLieSnapshot("2025-26", output, fixtureRequest,
      { cache: blocked, fullRefresh: true, now: at("2025-10-20") }));
    assert.equal(await readFile(output, "utf8"), snapshotBefore);
    assert.equal(await readFile(cache, "utf8"), cacheBefore);
    assert.equal(await readFile(join(blocked, "entry"), "utf8"), "keep");
    assert.deepEqual(await readdir(folder), ["blocked", "cache.json", "snapshot.json"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("historical pages use batches of 100 and stop only on a real appearance, not a DNP", async () => {
  const histories: string[] = [];
  const veteran = { ...line(), game: { ...line().game as ApiRow, season: 2024 } };
  const result = await collectBallDontLieSnapshot("2025-26", async (endpoint, params) => {
    if (endpoint === "teams") return { data: [home, away] };
    if (!params.has("player_ids[]")) return response([line(), { ...line(), player: { ...player, id: 456 } }]);
    assert.equal(params.get("per_page"), "100");
    const id = Number(params.get("player_ids[]"));
    if (id === 456) return response([]);
    histories.push(params.get("cursor") ?? "first");
    if (!params.has("cursor")) return response(Array.from({ length: 100 }, () => dnp(veteran)), 100);
    if (params.get("cursor") === "100") return response([dnp(veteran)], 200);
    // Bad trailing rows and the next cursor must never be fetched after the first appearance.
    return response([veteran, { min: "invalid" }], 300);
  });
  assert.deepEqual(histories, ["first", "100", "200"]);
  assert.deepEqual(result.rookies.map((rookie) => rookie.id), ["456"]);
});

test("history worker concurrency is bounded", async () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({ ...line(), player: { ...player, id: index + 1 } }));
  let active = 0;
  let peak = 0;
  const snapshot = await collectBallDontLieSnapshot("2025-26", async (endpoint, params) => {
    if (endpoint === "teams") return { data: [home, away] };
    if (!params.has("player_ids[]")) return response(rows);
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return response([]);
  }, { concurrency: 3 });
  assert.equal(snapshot.rookies.length, 9);
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("history failure stops queued players, awaits in-flight work, preserves first error and records elapsed phase", async () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({ ...line(), player: { ...player, id: index + 1 } }));
  const started: number[] = [];
  const firstError = new Error("first history failure");
  let releaseFirst!: () => void;
  let releaseThird!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const third = new Promise<void>((resolve) => { releaseThird = resolve; });
  let time = 0;
  let settled = false;
  const metrics = createCollectionMetrics();
  const pending = collectBallDontLieSnapshot("2025-26", async (endpoint, params) => {
    if (endpoint === "teams") { time += 10; return { data: [home, away] }; }
    if (!params.has("player_ids[]")) { time += 20; return response(rows); }
    const id = Number(params.get("player_ids[]"));
    started.push(id);
    if (id === 2) { time += 30; throw firstError; }
    if (id === 1) {
      await first;
      time += 10;
      throw new Error("later failure from lower-index worker");
    }
    await third;
    time += 10;
    return response([], 77);
  }, { concurrency: 3, now: () => time, metrics });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, (error) => error === firstError);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]);
  assert.equal(settled, false);
  releaseThird();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(started, [1, 2, 3]);
  releaseFirst();
  await rejected;
  assert.equal(settled, true);
  assert.deepEqual(started, [1, 2, 3]);
  assert.deepEqual(metrics.requests, { teams: 1, season: 1, history: 3 });
  assert.deepEqual(metrics.timingsMs, { teams: 10, season: 20, history: 50, total: 80 });
});

test("failed team and season requests record their active phase timings", async () => {
  for (const failingPhase of ["teams", "season"]) {
    let time = 0;
    const metrics = createCollectionMetrics();
    await assert.rejects(collectBallDontLieSnapshot("2025-26", async (endpoint) => {
      time += 25;
      if (endpoint === "teams" && failingPhase === "season") return { data: [home, away] };
      throw new Error("request failed");
    }, { now: () => time, metrics }), /request failed/);
    assert.equal(metrics.timingsMs[failingPhase as "teams" | "season"], 25);
  }
});

test("cached rookie and veteran eligibility survive empty refreshes and configurable windows", async () => {
  const folder = await mkdtemp(join(process.cwd(), ".balldontlie-test-"));
  const cache = join(folder, "cache.json");
  const output = join(folder, "snapshot.json");
  try {
    const veteran: ApiRow = { ...line(2), player: { ...player, id: 456 } };
    const source = dataset([line(), veteran], (id) => id === 456
      ? [{ ...veteran, game: { ...veteran.game as ApiRow, season: 2024 } }] : []);
    await saveBallDontLieSnapshot("2025-26", output, source, { cache, now: at("2025-10-12") });
    assert.deepEqual(JSON.parse(await readFile(cache, "utf8")).eligibility, { "123": true, "456": false });
    const metrics = createCollectionMetrics();
    const result = await saveBallDontLieSnapshot("2025-26", output, async (endpoint, params) => {
      if (endpoint === "stats") {
        assert.equal(params.has("player_ids[]"), false);
        assert.equal(params.get("start_date"), "2025-10-10");
      }
      return source(endpoint, params);
    }, { cache, refreshDays: 2, now: at("2025-10-20"), metrics });
    assert.deepEqual(result.rookies.map((rookie) => rookie.id), ["123"]);
    assert.equal(result.rookies[0].stats.gamesPlayed, 1);
    assert.equal(metrics.eligibilityHits, 2);
    assert.equal(metrics.requests.history, 0);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("all concurrent attempts share paced admission and Retry-After cooldown, including queued requests", async () => {
  let time = 0;
  const starts: { time: number; id: string; status: number }[] = [];
  const timers: { deadline: number; resolve: () => void }[] = [];
  let attempts = 0;
  const metrics = createCollectionMetrics();
  const client = createBallDontLieClient("test-only", async (_url) => {
    const url = new URL(String(_url));
    const id = url.searchParams.get("id")!;
    const status = ++attempts === 1 ? 429 : 200;
    starts.push({ time, id, status });
    return status === 429 ? new Response("", { status, headers: { "Retry-After": "10" } })
      : Response.json(response([]));
  }, (ms) => new Promise<void>((resolve) => { timers.push({ deadline: time + ms, resolve }); }),
  { now: () => time, metrics });
  let finished = false;
  const all = Promise.all(["a", "b", "c"].map((id) =>
    client("stats", new URLSearchParams({ id })))).then(() => { finished = true; });
  for (let tick = 0; tick < 100 && !finished; tick++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    timers.sort((a, b) => a.deadline - b.deadline);
    const timer = timers.shift();
    if (timer) {
      time = timer.deadline;
      timer.resolve();
    }
  }
  assert.equal(finished, true);
  await all;
  assert.equal(starts.length, 4);
  assert.equal(starts[0].time, 1100);
  assert.ok(starts[1].time >= 11_100, JSON.stringify(starts));
  for (let index = 1; index < starts.length; index++) {
    assert.ok(starts[index].time - starts[index - 1].time >= 1100);
  }
  assert.equal(metrics.retries, 1);
  assert.equal(metrics.requests.season, 4);
});

test("retry backoff is global for network failures and configurable spacing supports concurrent requests", async () => {
  let time = 0;
  const starts: number[] = [];
  let attempts = 0;
  const client = createBallDontLieClient("test-only", async () => {
    starts.push(time);
    if (++attempts === 1) throw new Error("do not expose transport details");
    return Response.json(response([]));
  }, async (ms) => { time += ms; }, { now: () => time, requestsPerMinute: 30 });
  await Promise.all([client("stats", new URLSearchParams()), client("teams", new URLSearchParams())]);
  assert.equal(starts.length, 3);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] - starts[index - 1] >= 2200);
});

test("invalid collector settings fail before network access", async () => {
  let calls = 0;
  const request: Request = async () => { calls++; throw new Error("must not request"); };
  for (const options of [
    { refreshDays: 0 }, { refreshDays: 367 }, { refreshDays: NaN },
    { concurrency: 0 }, { concurrency: 17 }, { concurrency: 1.5 },
    { requestsPerMinute: 0 }, { requestsPerMinute: 601 }, { requestsPerMinute: Infinity },
  ]) {
    await assert.rejects(collectBallDontLieSnapshot("2025-26", request, options), /must be an integer/);
  }
  await assert.rejects(saveBallDontLieSnapshot("2025-26", join(process.cwd(), "same.json"), request,
    { cache: join(process.cwd(), "same.json") }), /must be different/);
  assert.equal(calls, 0);
  assert.throws(() => createBallDontLieClient("test-only", fetch, undefined,
    { requestsPerMinute: 0 }), /requests-per-minute/);
});

test("CLI prints safe metrics even when collection fails before publication", () => {
  const script = join(process.cwd(), "scripts/collect-balldontlie.ts");
  const preload = `
    globalThis.fetch = async () => new Response("private-response-body", { status: 401 });
    process.env.BALLDONTLIE_API_KEY = "synthetic-credential";
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types",
    "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    script, "--requests-per-minute", "600",
  ], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  const line = result.stdout.split("\n").find((line) => line.startsWith("Collection metrics: "));
  assert.ok(line, result.stdout);
  const metrics = JSON.parse(line.slice("Collection metrics: ".length));
  assert.deepEqual(metrics.requests, { teams: 1, season: 0, history: 0 });
  assert.equal(metrics.retries, 0);
  assert.ok(metrics.timingsMs.teams >= 100);
  assert.ok(metrics.timingsMs.total >= metrics.timingsMs.teams);
  assert.match(result.stderr, /Collection failed; no snapshot replaced/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-response-body|synthetic-credential/);
});
