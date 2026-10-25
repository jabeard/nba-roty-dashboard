import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectCoverage } from "./coverage.ts";
import { FORECAST_FILES, loadForecastDashboard } from "./forecast-provider.ts";
import type { ForecastPool } from "./forecast.ts";
import type { RookieSnapshot } from "./models.ts";
import { auditPlayerRecords } from "../../scripts/audit-coverage.ts";
import { computeRotyScore } from "./scoring.ts";

// Synthetic records only: no official eligibility, projections, or market prices.
const snapshot: RookieSnapshot = {
  season: "2024-25", source: "snapshot", updatedAt: "2025-01-01T12:00:00.000Z", scheduledGames: 82,
  sourceMetadata: { provider: "BALLDONTLIE", seasonType: "Regular Season", endpoints: ["/nba/v1/stats"], warnings: [] },
  rookies: [{
    id: "1", name: "Test Rookie", team: "Test Team", teamCode: "TST", position: "Guard",
    number: null, draftPick: null, age: null, color: "#abcdef",
    stats: { gamesPlayed: 1, points: 15, rebounds: 4, assists: 5, steals: 1, blocks: 0, fieldGoalPct: 0.5, threePointPct: 0.3, freeThrowPct: 0.8 },
    games: [{ date: "2024-12-31T00:00:00.000Z", opponent: "vs. TST", points: 15, rebounds: 4, assists: 5 }],
  }],
};
const pool: ForecastPool = {
  season: "2024-25", provider: "BALLDONTLIE", updatedAt: snapshot.updatedAt, complete: true,
  players: ["1", "2"].map((id) => ({
    id, name: id === "1" ? "Test Rookie" : "AJ Dybantsa",
    eligibilitySource: "Synthetic test evidence only", verifiedAt: "2024-10-01T00:00:00.000Z",
    preseason: { minutes: 25, points: 14, rebounds: 4, assists: 3, steals: 1, blocks: 0.5, role: "Synthetic starter" },
    remainingGames: 60, expectedMinutes: 25, availability: 0.9, uncertainty: 0.3,
  })),
};
const now = Date.parse("2025-01-02T00:00:00.000Z");
const missing = async () => { throw Object.assign(new Error("private file contents"), { code: "ENOENT" }); };
const files = (values: Record<string, unknown>) => async (path: keyof typeof FORECAST_FILES) => {
  const key = Object.keys(values).find((name) => FORECAST_FILES[path].endsWith(name));
  return key ? JSON.stringify(values[key]) : missing();
};

test("coverage retains reviewed players with no appearances without inventing debut status", () => {
  const coverage = inspectCoverage(snapshot, pool);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.players[1].appearance, "not-in-snapshot");
  assert.match(coverage.dybantsa, /Awaiting debut and missing provider data/);
  assert.equal(coverage.unreviewed.length, 0);
});

test("coverage refuses season/provider mismatches and discloses demo mode", () => {
  assert.equal(inspectCoverage(snapshot, { ...pool, season: "2025-26" }).players.length, 0);
  assert.equal(inspectCoverage(snapshot, { ...pool, provider: "NBA Stats" }).complete, false);
  assert.match(inspectCoverage({ ...snapshot, source: "demo" }, pool).dybantsa, /illustrative/);
  assert.equal(inspectCoverage(snapshot, { ...pool, players: pool.players.slice(1) }).complete, false);
});

test("missing or malformed optional artifacts leave the statistical snapshot usable and redact errors", async () => {
  const data = await loadForecastDashboard(snapshot, missing, now);
  assert.equal(data.forecast, null);
  assert.equal(data.odds, null);
  assert.equal(data.notices.length, 3);
  const invalid = await loadForecastDashboard(snapshot, async () => { throw new Error("secret file content"); }, now);
  assert.ok(invalid.notices.every((notice) => !notice.includes("secret")));
  assert.equal(snapshot.rookies[0].stats.points, 15);
});

test("reviewed complete pool produces experimental forecasts including non-debutants", async () => {
  const data = await loadForecastDashboard(snapshot, files({ "rookie-pool.json": pool }), now);
  assert.equal(data.forecast?.status, "experimental");
  assert.equal(data.forecast.players.length, 2);
  assert.equal(data.forecast.players.find((player) => player.id === "2")?.observedWeight, 0);
  assert.ok(Math.abs(data.forecast.players.reduce((sum, player) => sum + player.probability, 0) - 1) < 1e-12);
});

test("incomplete field, future review, and demo observations withhold forecasts", async () => {
  const incomplete = await loadForecastDashboard(snapshot, files({ "rookie-pool.json": { ...pool, complete: false } }), now);
  assert.equal(incomplete.forecast, null);
  const future = await loadForecastDashboard(snapshot, files({ "rookie-pool.json": { ...pool, updatedAt: "2025-01-03T00:00:00.000Z" } }), now);
  assert.equal(future.forecast, null);
  const demo = await loadForecastDashboard({ ...snapshot, source: "demo" }, files({ "rookie-pool.json": pool }), now);
  assert.equal(demo.forecast, null);
});

test("odds from a different season or future collection are never published", async () => {
  const odds = {
    season: "2025-26", market: "nba_roty", provider: "Synthetic licensed fixture", playerProvider: "BALLDONTLIE",
    collectedAt: snapshot.updatedAt, quotes: [], completeBooks: [],
  };
  assert.equal((await loadForecastDashboard(snapshot, files({ "odds-snapshot.json": odds }), now)).odds, null);
  assert.equal((await loadForecastDashboard(snapshot, files({ "odds-snapshot.json": { ...odds, season: snapshot.season, collectedAt: "2025-01-03T00:00:00.000Z" } }), now)).odds, null);
  assert.equal((await loadForecastDashboard(snapshot, files({ "odds-snapshot.json": { ...odds, season: snapshot.season, playerProvider: "NBA Stats" } }), now)).odds, null);
});

test("provider audit does not query or infer eligibility without credentials", async () => {
  const report = await auditPlayerRecords("2026-27", "Dybantsa", "", async () => { throw new Error("must not fetch"); });
  assert.equal(report.status, "unverified");
  assert.equal(report.players.length, 0);
});

test("provider audit redacts transport credentials", async () => {
  await assert.rejects(auditPlayerRecords("2026-27", "Dybantsa", "synthetic-key", async () => {
    throw new Error("Authorization: synthetic-key");
  }), (error: Error) => !error.message.includes("synthetic-key"));
});

test("old statistics and outlooks flag historical forecasts instead of current EV", async () => {
  const data = await loadForecastDashboard(snapshot, files({ "rookie-pool.json": pool }), now + 3 * 86_400_000);
  assert.equal(data.forecastStale, true);
  assert.match(data.notices.join(" "), /expected-value comparisons are withheld/);
});

test("season progress affects only the ten-point availability component at fixed per-game performance", () => {
  const stats = snapshot.rookies[0].stats;
  const early = computeRotyScore(stats, 82);
  const full = computeRotyScore({ ...stats, gamesPlayed: 82 }, 82);
  assert.ok(Math.abs(full - early - 10 * 81 / 82) < 1e-12);
  assert.ok(full < 100);
});
