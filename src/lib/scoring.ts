import type { Rookie, SeasonStats } from "./models.ts";

export const SCORE_WEIGHTS = {
  scoring: 35,
  efficiency: 20,
  allAround: 20,
  defense: 15,
  availability: 10,
} as const;

export type ScoreWeights = Record<keyof typeof SCORE_WEIGHTS, number>;

export const SCORE_DIMENSIONS = {
  scoring: { label: "Scoring", description: "Points per game / 25" },
  efficiency: {
    label: "Efficiency",
    description: "50% × FG% / 60% + 30% × 3P% / 45% + 20% × FT% / 90%",
  },
  allAround: {
    label: "All-around",
    description: "50% × rebounds / 10 + 50% × assists / 8",
  },
  defense: {
    label: "Defense",
    description: "60% × steals / 2 + 40% × blocks / 2",
  },
  availability: { label: "Availability", description: "Games played / team games scheduled" },
} as const;

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function normalizeScoreWeights(weights: ScoreWeights = SCORE_WEIGHTS): ScoreWeights {
  const totalWeight = Object.values(weights).reduce((sum, value) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Score weights must be finite and non-negative.");
    }
    return sum + value;
  }, 0);
  if (totalWeight <= 0) throw new RangeError("At least one score weight must be positive.");
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, (value / totalWeight) * 100]),
  ) as ScoreWeights;
}

export function scoreBreakdown(
  stats: SeasonStats,
  scheduledGames: number,
  weights: ScoreWeights = SCORE_WEIGHTS,
) {
  const normalizedWeights = normalizeScoreWeights(weights);
  const dimensions: ScoreWeights = {
    scoring: clamp(stats.points / 25),
    efficiency:
      0.5 * clamp(stats.fieldGoalPct / 0.6) +
      0.3 * clamp(stats.threePointPct / 0.45) +
      0.2 * clamp(stats.freeThrowPct / 0.9),
    allAround: 0.5 * clamp(stats.rebounds / 10) + 0.5 * clamp(stats.assists / 8),
    defense: 0.6 * clamp(stats.steals / 2) + 0.4 * clamp(stats.blocks / 2),
    availability: scheduledGames > 0 ? clamp(stats.gamesPlayed / scheduledGames) : 0,
  };

  return (Object.keys(dimensions) as (keyof ScoreWeights)[]).map((key) => ({
    key,
    ...SCORE_DIMENSIONS[key],
    weight: normalizedWeights[key],
    contribution: dimensions[key] * normalizedWeights[key],
  }));
}

export function computeRotyScore(
  stats: SeasonStats,
  scheduledGames: number,
  weights: ScoreWeights = SCORE_WEIGHTS,
): number {
  return scoreBreakdown(stats, scheduledGames, weights).reduce(
    (sum, dimension) => sum + dimension.contribution,
    0,
  );
}

export function rankRookies(rookies: Rookie[], scheduledGames: number) {
  return rookies
    .map((rookie) => ({ ...rookie, score: computeRotyScore(rookie.stats, scheduledGames) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((rookie, index) => ({ ...rookie, rank: index + 1 }));
}

export type RankedRookie = ReturnType<typeof rankRookies>[number];
