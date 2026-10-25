import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { RookieSnapshot } from "./models.ts";
import {
  forecastRace, trainForecastModel, validateForecastModel, validateForecastPool,
  validateHistoricalRace,
} from "./forecast.ts";
import type { ForecastPool, HistoricalRace } from "./forecast.ts";
import { fairOdds } from "./odds.ts";

function fixture(year = 2024): HistoricalRace {
  const season = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  const updatedAt = `${year}-12-20T00:00:00.000Z`;
  const pool: ForecastPool = {
    season, provider: "NBA Stats", updatedAt, complete: true,
    players: ["101", "102", "103"].map((id, i) => ({
      id, name: `Player ${i}`, eligibilitySource: "NBA Stats rookie eligibility register",
      verifiedAt: updatedAt, remainingGames: 52, expectedMinutes: 30, availability: 0.9,
      uncertainty: 0.5,
      preseason: { minutes: 30, points: 17 - i * 3, rebounds: 5, assists: 4, steals: 1, blocks: 1, role: "Starter" },
    })),
  };
  const snapshot: RookieSnapshot = {
    season, updatedAt, source: "snapshot", scheduledGames: 82,
    sourceMetadata: { provider: "NBA Stats", seasonType: "Regular Season", endpoints: ["fixture"], warnings: [] },
    rookies: pool.players.slice(0, 2).map((player, i) => ({
      id: player.id, name: `Different display name ${i}`, team: "Test", teamCode: "TST",
      position: "Guard", number: 1, age: 21, draftPick: 1, color: "#123456",
      stats: {
        gamesPlayed: 30, points: 20 - 5 * i, rebounds: 5, assists: 4, steals: 1, blocks: 1,
        fieldGoalPct: 0.5, threePointPct: 0.35, freeThrowPct: 0.8,
      },
      games: Array.from({ length: 10 }, (_, day) => ({
        date: `${year}-12-${String(day + 1).padStart(2, "0")}T00:00:00.000Z`,
        opponent: "TST", points: 20, rebounds: 5, assists: 4,
      })),
    })),
  };
  return { pool, snapshot, winnerId: "101", outcomeAt: `${year + 1}-06-20T00:00:00.000Z` };
}

const clone = <T,>(value: T): T => structuredClone(value);

function comebackFixture(): HistoricalRace {
  const race = fixture();
  race.pool.players[0].outlook = {
    status: "out", source: "Synthetic team injury report; not a real player outlook",
    reviewedAt: race.pool.updatedAt,
    returnPlan: {
      early: { date: "2024-12-21T00:00:00.000Z", missedGames: 2 },
      expected: { date: "2025-01-01T00:00:00.000Z", missedGames: 6 },
      delayed: { date: "2025-02-01T00:00:00.000Z", missedGames: 15 },
      rampUpGames: 4, rampUpMinutes: 15,
    },
  };
  return race;
}

test("sourced return plans validate chronology, review dates, opportunities and ramp-up", () => {
  assert.equal(validateForecastPool(comebackFixture().pool).players[0].outlook?.status, "out");
  const mutations: ((p: ForecastPool) => void)[] = [
    (p) => { p.players[0].outlook!.source = " "; },
    (p) => { p.players[0].outlook!.status = "active"; },
    (p) => { p.players[0].outlook!.reviewedAt = "2024-12-21T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.reviewedAt = "2023-12-20T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.returnPlan!.early.date = "2024-12-19T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.returnPlan!.expected.date = "2025-02-30T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.returnPlan!.delayed.date = "2025-08-01T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.returnPlan!.delayed.date = "2024-12-25T00:00:00.000Z"; },
    (p) => { p.players[0].outlook!.returnPlan!.expected.missedGames = 1; },
    (p) => { p.players[0].outlook!.returnPlan!.delayed.missedGames = 53; },
    (p) => { p.players[0].outlook!.returnPlan!.early.missedGames = -1; },
    (p) => { p.players[0].outlook!.returnPlan!.early.missedGames = 0.5; },
    (p) => { p.players[0].outlook!.returnPlan!.rampUpGames = -1; },
    (p) => { p.players[0].outlook!.returnPlan!.rampUpMinutes = 31; },
    (p) => { p.players[0].outlook!.returnPlan!.rampUpMinutes = NaN; },
  ];
  for (const mutate of mutations) {
    const { pool } = comebackFixture();
    mutate(pool);
    assert.throws(() => validateForecastPool(pool));
  }
});

test("comeback scenarios preserve actuals, reduce opportunities and ramp both prior and observed rates", () => {
  const { pool, snapshot } = comebackFixture();
  const before = JSON.stringify({ pool, snapshot });
  const result = forecastRace(pool, snapshot);
  assert.deepEqual(result, forecastRace(pool, snapshot));
  assert.equal(JSON.stringify({ pool, snapshot }), before);
  const player = result.players.find((p) => p.id === "101")!;
  const rate = 17 * 0.4 + 20 * 0.6;
  assert.equal(player.projectedGames, 30 + (52 - 6) * 0.9);
  assert.ok(Math.abs(player.projectedPoints - (600 + rate * ((52 - 6) * 0.9 - 4 * 0.9 * 0.5))) < 1e-10);
  const [early, expected, delayed] = player.returnScenarios!;
  assert.ok(early.projectedGames > expected.projectedGames && expected.projectedGames > delayed.projectedGames);
  assert.ok(early.projectedPoints > expected.projectedPoints && expected.projectedPoints > delayed.projectedPoints);
  assert.ok(early.probability > expected.probability && expected.probability > delayed.probability);
  assert.equal(expected.probability, player.probability);
  assert.equal(expected.projectedPoints, player.projectedPoints);
  for (const scenario of ["early", "expected", "delayed"]) {
    const estimates = result.players.map((p) => p.returnScenarios!.find((s) => s.scenario === scenario)!);
    assert.ok(Math.abs(estimates.reduce((sum, p) => sum + p.probability, 0) - 1) < 1e-12);
    for (const [index, estimate] of estimates.entries()) {
      assert.ok(estimate.probability >= result.players[index].lower && estimate.probability <= result.players[index].upper);
      assert.equal(fairOdds(estimate.probability).decimal, 1 / estimate.probability);
    }
  }
  assert.ok(result.warnings.some((warning) => warning.includes("no likelihood")));
  assert.ok(result.players.find((p) => p.id === "102")!.returnScenarios![0].probability <
    result.players.find((p) => p.id === "102")!.returnScenarios![2].probability);
});

test("return chronology compares UTC instants across optional millisecond formats", () => {
  const { pool } = comebackFixture();
  pool.updatedAt = "2024-12-20T00:00:00Z";
  const plan = pool.players[0].outlook!.returnPlan!;
  plan.early.date = "2024-12-20T00:00:00.000Z";
  assert.equal(validateForecastPool(pool), pool);
  plan.early.date = "2024-12-20T00:00:00.500Z";
  plan.expected.date = "2024-12-20T00:00:00Z";
  assert.throws(() => validateForecastPool(pool), /returnPlan.expected.date/);
});

test("return plans handle no return, zero minutes, zero availability and a ramp longer than the season", () => {
  for (const mode of ["no-return", "zero-minutes", "zero-availability", "long-ramp"] as const) {
    const { pool, snapshot } = comebackFixture();
    const player = pool.players[0];
    const plan = player.outlook!.returnPlan!;
    if (mode === "no-return") for (const key of ["early", "expected", "delayed"] as const) plan[key].missedGames = 52;
    if (mode === "zero-minutes") { player.expectedMinutes = 0; plan.rampUpMinutes = 0; plan.rampUpGames = 82; }
    if (mode === "zero-availability") player.availability = 0;
    if (mode === "long-ramp") { plan.rampUpGames = 82; plan.rampUpMinutes = 0; }
    const result = forecastRace(pool, snapshot).players.find((p) => p.id === player.id)!;
    assert.equal(result.projectedPoints, 600);
    assert.equal(result.projectedGames, mode === "no-return" || mode === "zero-availability" ? 30 : 30 + 46 * 0.9);
    assert.ok(result.returnScenarios!.every((s) => Number.isFinite(s.probability) && s.projectedPoints === 600));
  }
});

test("awaiting-debut return plans project impact without creating observed stats", () => {
  const { pool, snapshot } = comebackFixture();
  pool.players[2].outlook = clone(pool.players[0].outlook!);
  pool.players[2].outlook!.status = "awaiting-debut";
  delete pool.players[0].outlook;
  const result = forecastRace(pool, snapshot).players.find((p) => p.id === "103")!;
  assert.equal(result.observedWeight, 0);
  assert.ok(result.projectedPoints > 0 && result.probability > 0);
  assert.equal(snapshot.rookies.length, 2);
  delete pool.players[2].outlook;
  assert.ok(forecastRace(pool, snapshot).players.every((p) => p.returnScenarios === undefined));
});

test("pool validates real UTC dates, bounded priors, numeric unique IDs and assumptions", () => {
  const { pool } = fixture();
  assert.equal(validateForecastPool(pool), pool);
  const mutations: ((value: ForecastPool) => void)[] = [
    (p) => { p.season = "2024-26"; },
    (p) => { p.updatedAt = "2024-02-30T00:00:00.000Z"; },
    (p) => { p.updatedAt = "2099-12-20T00:00:00.000Z"; },
    (p) => { p.players[0].verifiedAt = "2025-01-01T00:00:00.000Z"; },
    (p) => { p.players[0].id = "demo-1"; },
    (p) => { p.players[0].id = "0101"; },
    (p) => { p.players[0].id = p.players[1].id; },
    (p) => { p.players[0].name = " "; },
    (p) => { p.players[0].eligibilitySource = ""; },
    (p) => { p.players[0].preseason.role = ""; },
    (p) => { p.players[0].preseason.minutes = 49; },
    (p) => { p.players[0].preseason.points = Infinity; },
    (p) => { p.players[0].preseason.minutes = 0; },
    (p) => { p.players[0].remainingGames = 1.5; },
    (p) => { p.players[0].remainingGames = 83; },
    (p) => { p.players[0].expectedMinutes = -1; },
    (p) => { p.players[0].availability = 1.1; },
    (p) => { p.players[0].uncertainty = 0; },
    (p) => { p.players[0].uncertainty = NaN; },
  ];
  for (const mutate of mutations) {
    const bad = clone(pool);
    mutate(bad);
    assert.throws(() => validateForecastPool(bad));
  }
});

test("whole-field probabilities are deterministic, normalized, ID-joined and include debut priors", () => {
  const { pool, snapshot } = fixture();
  const before = JSON.stringify({ pool, snapshot });
  const result = forecastRace(pool, snapshot);
  assert.deepEqual(result, forecastRace(pool, snapshot));
  assert.equal(JSON.stringify({ pool, snapshot }), before);
  assert.equal(result.status, "experimental");
  assert.ok(Math.abs(result.players.reduce((sum, p) => sum + p.probability, 0) - 1) < 1e-12);
  for (const player of result.players) {
    assert.ok(player.probability >= player.lower && player.probability <= player.upper);
    assert.ok(player.lower >= 0 && player.upper <= 1);
    assert.ok(player.projectedGames >= 0 && player.projectedGames <= 82);
  }
  assert.equal(result.players.find((p) => p.id === "101")?.observedWeight, 0.6);
  const debut = result.players.find((p) => p.id === "103")!;
  assert.equal(debut.observedWeight, 0);
  assert.ok(debut.projectedPoints > 0 && debut.probability > 0);
  assert.ok(result.warnings.some((warning) => warning.includes("not calibrated")));
  const reordered = clone(snapshot);
  reordered.rookies.reverse();
  assert.deepEqual(forecastRace(pool, reordered), result);
});

test("entire field awaiting debut has no fabricated observations and retains metadata validation", () => {
  const { pool, snapshot } = fixture();
  snapshot.rookies = [];
  pool.players.forEach((player) => { player.remainingGames = 82; });
  const result = forecastRace(pool, snapshot);
  assert.equal(result.players.length, pool.players.length);
  assert.ok(result.players.every((player) => player.observedWeight === 0 && player.projectedPoints > 0));
  assert.ok(Math.abs(result.players.reduce((sum, player) => sum + player.probability, 0) - 1) < 1e-12);
  assert.deepEqual(snapshot.rookies, []);
  for (const mutate of [
    (value: RookieSnapshot) => { value.source = "demo"; },
    (value: RookieSnapshot) => { value.scheduledGames = 81; },
    (value: RookieSnapshot) => { value.sourceMetadata = undefined; },
    (value: RookieSnapshot) => { value.sourceMetadata!.endpoints = []; },
    (value: RookieSnapshot) => { value.updatedAt = "2024-02-30T00:00:00.000Z"; },
  ]) {
    const invalid = clone(snapshot);
    mutate(invalid);
    assert.throws(() => forecastRace(pool, invalid));
  }
});

test("player ID provider is explicit and independent from official eligibility evidence", () => {
  const { pool, snapshot } = fixture();
  pool.provider = "BALLDONTLIE";
  snapshot.sourceMetadata!.provider = "BALLDONTLIE";
  pool.players.forEach((player) => {
    player.eligibilitySource = "https://www.nba.com/news/rookie-eligibility";
  });
  assert.equal(forecastRace(pool, snapshot).players.length, pool.players.length);
  pool.provider = "NBA Stats";
  assert.throws(() => forecastRace(pool, snapshot), /provider mismatch/);
  assert.throws(() => validateForecastPool({ ...pool, provider: undefined }), /pool.provider/);
});

test("outlook review may predate collection but must cover every recorded observation", () => {
  const { pool, snapshot } = fixture();
  pool.updatedAt = "2024-12-15T00:00:00.000Z";
  pool.players.forEach((player) => { player.verifiedAt = pool.updatedAt; });
  assert.equal(forecastRace(pool, snapshot).players.length, pool.players.length);
  assert.ok(forecastRace(pool, snapshot).warnings.some((warning) => warning.includes("calendar dates")));
  assert.equal(pool.updatedAt, "2024-12-15T00:00:00.000Z");
  snapshot.rookies[1].games[9].date = "2024-12-16T00:00:00.000Z";
  assert.throws(() => forecastRace(pool, snapshot), /observed game after outlook review/);
});

test("future production blends rate priors, expected minutes, actual appearances and availability", () => {
  const { pool, snapshot } = fixture();
  pool.players[0].expectedMinutes = 15;
  pool.players[0].availability = 0.5;
  const player = forecastRace(pool, snapshot).players.find((p) => p.id === "101")!;
  assert.equal(player.projectedGames, 56);
  assert.ok(Math.abs(player.projectedPoints - (600 + (17 * 0.5 * 0.4 + 20 * 0.6) * 26)) < 1e-10);
  const fewer = clone(snapshot);
  fewer.rookies[0].stats.gamesPlayed = 10;
  assert.ok(forecastRace(pool, fewer).players.find((p) => p.id === "101")!.observedWeight < player.observedWeight);
  pool.players[0].availability = 0;
  const injured = forecastRace(pool, snapshot).players.find((p) => p.id === "101")!;
  assert.equal(injured.projectedPoints, 600);
  assert.equal(injured.projectedGames, 30);
  assert.ok(injured.probability > 0);
  assert.ok(injured.probability < player.probability);
});

test("uncertainty changes deterministic sensitivity ranges without altering central production", () => {
  const { pool, snapshot } = fixture();
  pool.players[0].uncertainty = 0.01;
  const narrow = forecastRace(pool, snapshot).players.find((p) => p.id === "101")!;
  pool.players[0].uncertainty = 1;
  const wide = forecastRace(pool, snapshot).players.find((p) => p.id === "101")!;
  assert.equal(wide.projectedPoints, narrow.projectedPoints);
  assert.ok(wide.upper - wide.lower > narrow.upper - narrow.lower);
  assert.notEqual(wide.probability, narrow.probability);
});

test("rejects incomplete field, demo, mismatched provider/seasons and future/leaking context", () => {
  const mutations: ((race: HistoricalRace) => void)[] = [
    (r) => { r.pool.complete = false; },
    (r) => { r.snapshot.source = "demo"; },
    (r) => { r.snapshot.season = "2023-24"; },
    (r) => { r.snapshot.sourceMetadata!.provider = "BALLDONTLIE"; },
    (r) => { r.pool.players = r.pool.players.slice(1); },
    (r) => { r.pool.updatedAt = "2024-12-09T00:00:00.000Z"; r.pool.players.forEach((p) => { p.verifiedAt = r.pool.updatedAt; }); },
    (r) => { r.snapshot.updatedAt = "2099-12-20T00:00:00.000Z"; },
    (r) => { r.snapshot.rookies[0].games[0].date = "2023-12-01T00:00:00.000Z"; },
    (r) => { r.pool.players[0].remainingGames = 53; },
  ];
  for (const mutate of mutations) {
    const race = fixture();
    mutate(race);
    assert.throws(() => forecastRace(race.pool, race.snapshot));
  }
});

test("extreme valid priors and zero-minute awaiting debut keep all outputs finite", () => {
  const { pool, snapshot } = fixture();
  const debut = pool.players[2];
  debut.preseason = { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, role: "Unknown" };
  debut.expectedMinutes = 48;
  pool.players[0].preseason.minutes = 0.01;
  pool.players[0].expectedMinutes = 48;
  pool.players[0].uncertainty = 1;
  for (const player of forecastRace(pool, snapshot).players) {
    assert.ok(Object.values(player).filter((v) => typeof v === "number").every(Number.isFinite));
  }
  pool.players[0].preseason.minutes = Number.MIN_VALUE;
  pool.players[0].expectedMinutes = 0;
  for (const player of forecastRace(pool, snapshot).players) {
    assert.ok(Object.values(player).filter((v) => typeof v === "number").every(Number.isFinite));
  }
  pool.players[0].expectedMinutes = 48;
  assert.ok(Number.isFinite(forecastRace(pool, snapshot).players[0].projectedPoints));
});

function history(count = 6) {
  return Array.from({ length: count }, (_, index) => fixture(2015 + index));
}

test("historical validation requires complete pre-outcome records and real winner labels", () => {
  assert.equal(validateHistoricalRace(fixture()).winnerId, "101");
  const mutations: ((race: HistoricalRace) => void)[] = [
    (r) => { r.outcomeAt = r.pool.updatedAt; },
    (r) => { r.snapshot.updatedAt = "2025-06-21T00:00:00.000Z"; },
    (r) => { r.outcomeAt = "2024-12-25T00:00:00.000Z"; },
    (r) => { r.outcomeAt = "2099-06-20T00:00:00.000Z"; },
    (r) => { r.winnerId = "999"; },
    (r) => { r.pool.complete = false; },
  ];
  for (const mutate of mutations) {
    const race = fixture();
    mutate(race);
    assert.throws(() => validateHistoricalRace(race));
  }
  assert.throws(() => trainForecastModel(history(5)));
  const duplicate = history();
  duplicate[1] = clone(duplicate[0]);
  assert.throws(() => trainForecastModel(duplicate));
  const leakage = history();
  leakage[0].outcomeAt = "2020-12-21T00:00:00.000Z";
  assert.throws(() => trainForecastModel(leakage));
});

test("training is chronological, serializable, reproducible and reports proper out-of-time metrics", () => {
  const races = history(7);
  const first = trainForecastModel(races.slice(0, 6));
  assert.equal(validateForecastModel(JSON.parse(JSON.stringify(first))).version, 1);
  assert.deepEqual(trainForecastModel(races.slice(0, 6).reverse()), first);
  assert.equal(first.validation.seasonCount, 2);
  assert.deepEqual(first.validation.seasons, ["2019-20", "2020-21"]);
  const target = races[6];
  target.winnerId = "102";
  const prediction = forecastRace(target.pool, target.snapshot, first);
  assert.equal(prediction.status, "backtested");
  const brier = prediction.players.reduce((sum, player) =>
    sum + (player.probability - Number(player.id === target.winnerId)) ** 2, 0);
  const logLoss = -Math.log(prediction.players.find((p) => p.id === target.winnerId)!.probability);
  const next = trainForecastModel(races);
  assert.ok(Math.abs(next.validation.brier - (first.validation.brier * 2 + brier) / 3) < 1e-12);
  assert.ok(Math.abs(next.validation.logLoss - (first.validation.logLoss * 2 + logLoss) / 3) < 1e-12);
  const sameSeason = fixture(2020);
  assert.throws(() => forecastRace(sameSeason.pool, sameSeason.snapshot, first));
  for (const mutate of [
    (model: typeof first) => { model.temperature = 0; },
    (model: typeof first) => { model.featureWeights.points = NaN; },
    (model: typeof first) => { model.validation.brier = 3; },
    (model: typeof first) => { model.validation.logLoss = -1; },
    (model: typeof first) => { model.validation.seasons.reverse(); },
    (model: typeof first) => { model.trainingSeasonCount = 2; },
  ]) {
    const invalid = clone(first);
    mutate(invalid);
    assert.throws(() => validateForecastModel(invalid));
  }
});

test("training CLI publishes validated JSON and preserves it on safe validation failure", () => {
  const input = `.forecast-cli-input-${process.pid}.json`;
  const output = `.forecast-cli-output-${process.pid}.json`;
  writeFileSync(input, JSON.stringify(history()), { flag: "wx" });
  try {
    const run = () => spawnSync(process.execPath, [
      "--experimental-strip-types", "scripts/train-forecast.ts", "--input", input, "--output", output,
    ], { encoding: "utf8" });
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    const original = readFileSync(output, "utf8");
    assert.equal(validateForecastModel(JSON.parse(original)).version, 1);
    writeFileSync(input, '{"private":"do-not-echo-this-payload"');
    const failure = run();
    assert.equal(failure.status, 1);
    assert.ok(!failure.stderr.includes("do-not-echo-this-payload"));
    assert.equal(readFileSync(output, "utf8"), original);
  } finally {
    unlinkSync(input);
    try { unlinkSync(output); } catch { /* Publication may have failed before creating output. */ }
  }
});
