import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSnapshot, normalizeGameLogs, normalizePercentage, normalizeRookie, resultRows } from "./nba-stats.ts";
import { validateSnapshot } from "./snapshot.ts";
import { createSnapshotProvider } from "./snapshot-provider.ts";
import { selectRookieProvider } from "./data.ts";
import { mockRookieProvider } from "../data/rookies.ts";
import { collectSnapshot, createNbaClient } from "../../scripts/collect-nba-stats.ts";

// Synthetic endpoint-shaped fixtures; not official player data.
function table(name: string, rows: Record<string, unknown>[]) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { resultSets: [{ name, headers, rowSet: rows.map((row) => headers.map((header) => row[header])) }] };
}

const line = {
  PLAYER_ID: 123, PLAYER_NAME: "Test Rookie", TEAM_ABBREVIATION: "SAS", AGE: 20,
  GP: 12, PTS: 12.5, REB: 4, AST: 3, STL: 1, BLK: 0.5, FG_PCT: 0.45, FG3_PCT: 0, FT_PCT: 1,
};
const bio = table("CommonPlayerInfo", [{
  PERSON_ID: 123, TEAM_ABBREVIATION: "SAS", TEAM_CITY: "San Antonio", TEAM_NAME: "Spurs",
  POSITION: "Guard-Forward", JERSEY: "00", DRAFT_NUMBER: "Undrafted",
}]);
const logRows = Array.from({ length: 12 }, (_, index) => ({
  Player_ID: 123,
  GAME_DATE: `OCT ${String(12 - index).padStart(2, "0")}, 2026`,
  MATCHUP: "SAS vs. BOS", PTS: 12, REB: 4, AST: 3,
}));
const logs = table("PlayerGameLog", logRows);
const makeSnapshot = () => createSnapshot("2026-27", [
  normalizeRookie(line, bio, logs),
], "2026-11-01T12:00:00.000Z");

test("percent normalization preserves fractions, zero and one; rejects wrong scales and missing values", () => {
  for (const value of [0, 0.45, 1]) assert.equal(normalizePercentage(value), value);
  for (const value of [45, -1, NaN, Infinity, null, undefined, "0.45"]) {
    assert.throws(() => normalizePercentage(value), /percentage/);
  }
});

test("NBA result tables require well-formed headers, rows and a named dataset", () => {
  assert.deepEqual(resultRows(table("Test", [{ PTS: 12 }]), "Test"), [{ PTS: 12 }]);
  for (const payload of [null, {}, { resultSets: [] },
    { resultSets: [{ name: "Test", headers: ["PTS"], rowSet: [[]] }] },
    { resultSets: [{ name: "Test", headers: ["PTS", "PTS"], rowSet: [[1, 2]] }] }]) {
    assert.throws(() => resultRows(payload, "Test"));
  }
});

test("logs retain the most recent ten appearances in oldest-to-newest UTC order", () => {
  const games = normalizeGameLogs(logs);
  assert.equal(games.length, 10);
  assert.equal(games[0].date, "2026-10-03T00:00:00.000Z");
  assert.equal(games.at(-1)?.date, "2026-10-12T00:00:00.000Z");
  assert.deepEqual(games.map((game) => game.date), games.map((game) => game.date).sort());
  assert.equal(normalizeGameLogs(table("PlayerGameLog", [{ ...logRows[0], GAME_DATE: "2026-10-12" }]))[0].date,
    "2026-10-12T00:00:00.000Z");
  assert.throws(() => normalizeGameLogs(table("PlayerGameLog", [logRows[0], logRows[0]])), /Duplicate/);
  assert.throws(() => normalizeGameLogs(table("PlayerGameLog", [{ ...logRows[0], GAME_DATE: "not a date" }])), /GAME_DATE/);
  assert.throws(() => normalizeGameLogs(table("PlayerGameLog", [{ ...logRows[0], GAME_DATE: "FEB 30, 2026" }])), /GAME_DATE/);
  assert.throws(() => normalizeGameLogs(logs, 456), /player ID/);
});

test("rookie transformation supplies required stats and bio fields without inventing draft picks", () => {
  const rookie = normalizeRookie(line, bio, logs);
  assert.equal(rookie.id, "123");
  assert.equal(rookie.position, "Guard");
  assert.equal(rookie.number, 0);
  assert.equal(rookie.draftPick, null);
  assert.equal(rookie.team, "San Antonio Spurs");
  assert.deepEqual(rookie.stats, {
    gamesPlayed: 12, points: 12.5, rebounds: 4, assists: 3, steals: 1, blocks: 0.5,
    fieldGoalPct: 0.45, threePointPct: 0, freeThrowPct: 1,
  });
  for (const field of Object.keys(line)) {
    const incomplete = { ...line } as Record<string, unknown>;
    delete incomplete[field];
    assert.throws(() => normalizeRookie(incomplete, bio, logs), Error, `must reject missing ${field}`);
  }
  assert.throws(() => normalizeRookie(line, bio, table("PlayerGameLog", logRows.slice(0, 3))), /Incomplete/);
  const early = normalizeRookie({ ...line, GP: 2 }, bio, table("PlayerGameLog", logRows.slice(0, 2)));
  assert.equal(early.games.length, 2);
});

test("snapshot contract validates metadata, timestamps, unique IDs, stats and chronological logs", () => {
  assert.equal(validateSnapshot(makeSnapshot()).source, "snapshot");
  const invalid = [
    (s: ReturnType<typeof makeSnapshot>) => { s.updatedAt = "bad date"; },
    (s: ReturnType<typeof makeSnapshot>) => { s.updatedAt = "2026-02-30T00:00:00.000Z"; },
    (s: ReturnType<typeof makeSnapshot>) => { s.season = "2026-28"; },
    (s: ReturnType<typeof makeSnapshot>) => { s.source = "demo"; },
    (s: ReturnType<typeof makeSnapshot>) => { Object.assign(s, { notice: { message: "invalid" } }); },
    (s: ReturnType<typeof makeSnapshot>) => { delete s.sourceMetadata; },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies = []; },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies.push(s.rookies[0]); },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies[0].stats.fieldGoalPct = 45; },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies[0].stats.points = NaN; },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies[0].games.reverse(); },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies[0].games.pop(); },
    (s: ReturnType<typeof makeSnapshot>) => { s.rookies[0].games[9].date = "2027-01-01T00:00:00.000Z"; },
  ];
  for (const mutate of invalid) {
    const snapshot = makeSnapshot();
    mutate(snapshot);
    assert.throws(() => validateSnapshot(snapshot));
  }
});

test("file provider loads a valid snapshot and selection defaults to unchanged demo data", async () => {
  const folder = await mkdtemp(join(tmpdir(), "rookie-snapshot-"));
  try {
    const file = join(folder, "snapshot.json");
    const provider = createSnapshotProvider(() => readFile(file, "utf8"));
    await assert.rejects(provider.getSnapshot(), /Cannot load provider snapshot/);
    await writeFile(file, "{not json");
    await assert.rejects(provider.getSnapshot(), /Cannot load/);
    await writeFile(file, JSON.stringify({}));
    await assert.rejects(provider.getSnapshot(), /Cannot load/);
    const fallback = await selectRookieProvider("snapshot", provider).getSnapshot();
    assert.equal(fallback.source, "demo");
    assert.match(fallback.notice!, /missing or invalid/);
    await writeFile(file, JSON.stringify(makeSnapshot()));
    assert.deepEqual(await selectRookieProvider("snapshot", provider).getSnapshot(), makeSnapshot());
    assert.deepEqual(await selectRookieProvider("demo", provider).getSnapshot(), await mockRookieProvider.getSnapshot());
    assert.match((await selectRookieProvider("typo", provider).getSnapshot()).notice!, /Unrecognized/);
    assert.equal(await readFile(file, "utf8"), JSON.stringify(makeSnapshot()));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("collector requests rookie per-game regular season and fails clearly on empty or partial data", async () => {
  const calls: string[] = [];
  const request = async (endpoint: string, params: Record<string, string>) => {
    calls.push(endpoint);
    if (endpoint === "leaguedashplayerstats") {
      assert.equal(params.Season, "2026-27");
      assert.equal(params.PlayerExperience, "Rookie");
      assert.equal(params.PerMode, "PerGame");
      assert.equal(params.SeasonType, "Regular Season");
      return table("LeagueDashPlayerStats", [line]);
    }
    assert.equal(params.PlayerID, "123");
    return endpoint === "commonplayerinfo" ? bio : logs;
  };
  const snapshot = await collectSnapshot("2026-27", request);
  assert.deepEqual(calls, ["leaguedashplayerstats", "commonplayerinfo", "playergamelog"]);
  assert.equal(snapshot.rookies.length, 1);
  assert.equal(snapshot.sourceMetadata?.provider, "NBA Stats");
  await assert.rejects(collectSnapshot("2026-28", request), /consecutive years/);
  await assert.rejects(collectSnapshot("2026-27", async () => table("LeagueDashPlayerStats", [])), /No rookie/);
  await assert.rejects(collectSnapshot("2026-27", async (endpoint, params) => {
    if (endpoint === "playergamelog") throw new Error("HTTP 403");
    return request(endpoint, params);
  }), /Incomplete collection.*0\/1.*HTTP 403/);
});

test("NBA client paces requests, backs off, honors Retry-After and caps retries", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const client = createNbaClient(async () => {
    attempts++;
    return attempts === 1
      ? new Response("", { status: 429, headers: { "Retry-After": "10" } })
      : Response.json({ ok: true });
  }, async (ms) => { waits.push(ms); });
  assert.deepEqual(await client("playergamelog", {}), { ok: true });
  assert.deepEqual(waits, [3000, 10000, 3000]);
  let failures = 0;
  const blocked = createNbaClient(async () => {
    failures++;
    return new Response("", { status: 403 });
  }, async () => {});
  await assert.rejects(blocked("playergamelog", {}), /HTTP 403/);
  assert.equal(failures, 1);
  failures = 0;
  const offline = createNbaClient(async () => { failures++; throw new Error("timeout"); }, async () => {});
  await assert.rejects(offline("playergamelog", {}), /after 3 attempts/);
  assert.equal(failures, 3);
  const longWait = createNbaClient(async () => new Response("", {
    status: 429, headers: { "Retry-After": "300" },
  }), async () => {});
  await assert.rejects(longWait("playergamelog", {}), /long Retry-After/);
  const html = createNbaClient(async () => new Response("<html>blocked</html>"), async () => {});
  await assert.rejects(html("playergamelog", {}), /expected JSON/);
});
