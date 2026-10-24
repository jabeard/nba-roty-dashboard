import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRotyScore, normalizeScoreWeights, rankRookies, scoreBreakdown } from "./scoring.ts";
import { formatPercent, recentAverages } from "./format.ts";
import { mockRookieProvider, rookies } from "../data/rookies.ts";
import type { SeasonStats } from "./models.ts";

const ideal: SeasonStats = {
  gamesPlayed: 50, points: 25, rebounds: 10, assists: 8, steals: 2, blocks: 2,
  fieldGoalPct: .6, threePointPct: .45, freeThrowPct: .9,
};

test("default formula awards 100 at reference targets and zero for no production", () => {
  assert.equal(computeRotyScore(ideal, 50), 100);
  const zero = Object.fromEntries(Object.keys(ideal).map((key) => [key, 0])) as unknown as SeasonStats;
  assert.equal(computeRotyScore(zero, 50), 0);
  assert.equal(computeRotyScore({ ...ideal, points: 12.5 }, 50), 82.5);
});

test("availability rewards games played without dividing by zero", () => {
  assert.equal(computeRotyScore({ ...ideal, gamesPlayed: 25 }, 50), 95);
  assert.equal(computeRotyScore(ideal, 0), 90);
});

test("configurable weights are normalized and invalid weights rejected", () => {
  const weights = { scoring: 1, efficiency: 0, allAround: 0, defense: 0, availability: 0 };
  assert.equal(computeRotyScore({ ...ideal, points: 12.5 }, 50, weights), 50);
  assert.deepEqual(normalizeScoreWeights(weights), { ...weights, scoring: 100 });
  for (const scoring of [-1, NaN, Infinity]) {
    assert.throws(() => computeRotyScore(ideal, 50, { ...weights, scoring }), RangeError);
  }
  assert.throws(() => computeRotyScore(ideal, 50, { ...weights, scoring: 0 }), RangeError);
});

test("outlying and non-finite stat inputs cannot escape score bounds", () => {
  assert.equal(computeRotyScore({ ...ideal, points: 100, fieldGoalPct: 2 }, 50), 100);
  assert.equal(computeRotyScore({ ...ideal, points: -10 }, 50), 65);
  assert.equal(computeRotyScore({ ...ideal, points: NaN }, 50), 65);
  assert.equal(scoreBreakdown(ideal, 50).reduce((sum, item) => sum + item.weight, 0), 100);
});

test("ranking is descending, deterministic, and does not mutate provider data", () => {
  const before = rookies.map((rookie) => rookie.id);
  const ranked = rankRookies(rookies, 50);
  assert.deepEqual(rookies.map((rookie) => rookie.id), before);
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked.every((rookie, i) => i === 0 || ranked[i - 1].score >= rookie.score));
  const tied = rankRookies([{ ...rookies[0], name: "Z" }, { ...rookies[0], name: "A" }], 50);
  assert.equal(tied[0].name, "A");
  assert.deepEqual(rankRookies([], 50), []);
});

test("demo snapshot includes unique rookies with ten chronological games each", async () => {
  const snapshot = await mockRookieProvider.getSnapshot();
  assert.ok(snapshot.rookies.length >= 10);
  assert.equal(new Set(snapshot.rookies.map((rookie) => rookie.id)).size, snapshot.rookies.length);
  assert.equal(snapshot.source, "demo");
  for (const rookie of snapshot.rookies) {
    assert.equal(rookie.games.length, 10);
    assert.ok(rookie.games.every((game, i) => i === 0 || game.date > rookie.games[i - 1].date));
    assert.ok(rookie.games.every((game) => game.date < snapshot.updatedAt));
    for (const percent of [rookie.stats.fieldGoalPct, rookie.stats.threePointPct, rookie.stats.freeThrowPct]) {
      assert.ok(percent >= 0 && percent <= 1);
    }
  }
});

test("formatting and recent form handle zero and empty logs", () => {
  assert.equal(formatPercent(.429), "42.9%");
  assert.equal(formatPercent(0), "0.0%");
  assert.equal(recentAverages([]), null);
  const games = Array.from({ length: 11 }, (_, i) => ({
    date: "", opponent: "", points: i, rebounds: 2, assists: 3,
  }));
  assert.deepEqual(recentAverages(games), { points: 5.5, rebounds: 2, assists: 3, count: 10 });
});
