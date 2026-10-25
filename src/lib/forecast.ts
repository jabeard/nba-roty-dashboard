import type { RookieSnapshot } from "./models.ts";
import { validateSeason } from "./nba-stats.ts";
import { validateSnapshot } from "./snapshot.ts";

const returnScenarios = ["early", "expected", "delayed"] as const;
type ReturnScenario = typeof returnScenarios[number];

export interface AvailabilityOutlook {
  status: "active" | "out" | "awaiting-debut";
  source: string;
  reviewedAt: string;
  returnPlan?: {
    early: { date: string; missedGames: number };
    expected: { date: string; missedGames: number };
    delayed: { date: string; missedGames: number };
    rampUpGames: number;
    rampUpMinutes: number;
  };
}

export interface ForecastPlayer {
  id: string;
  name: string;
  eligibilitySource: string;
  verifiedAt: string;
  preseason: {
    minutes: number; points: number; rebounds: number; assists: number;
    steals: number; blocks: number; role: string;
  };
  remainingGames: number;
  expectedMinutes: number;
  availability: number;
  uncertainty: number;
  outlook?: AvailabilityOutlook;
}

export interface ForecastPool {
  season: string;
  provider: "NBA Stats" | "BALLDONTLIE";
  updatedAt: string;
  complete: boolean;
  players: ForecastPlayer[];
}

export interface ForecastModel {
  version: 1;
  featureWeights: {
    points: number; rebounds: number; assists: number; defense: number; games: number;
  };
  temperature: number;
  trainedThrough: string;
  trainingSeasonCount: number;
  validation: {
    method: "chronological-held-out";
    seasonCount: number;
    seasons: string[];
    brier: number;
    logLoss: number;
  };
}

export interface PlayerForecast {
  id: string;
  name: string;
  probability: number;
  lower: number;
  upper: number;
  projectedGames: number;
  projectedPoints: number;
  observedWeight: number;
  expectedMinutes: number;
  availability: number;
  outlook?: AvailabilityOutlook;
  returnScenarios?: {
    scenario: ReturnScenario; probability: number; projectedGames: number; projectedPoints: number;
  }[];
}

export interface HistoricalRace {
  pool: ForecastPool;
  snapshot: RookieSnapshot;
  winnerId: string;
  outcomeAt: string;
}

const features = ["points", "rebounds", "assists", "defense", "games"] as const;
const baseline = [3, 1, 1, 0.75, 0.5];
const limits = { points: 60, rebounds: 30, assists: 25, steals: 10, blocks: 10 };
const MIN_FIT = 2;
const MIN_CALIBRATION = 2;
const MIN_VALIDATION = 2;
const SCENARIOS = 65;

function check(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid forecast field: ${field}.`);
}

function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "object");
  return value as Record<string, unknown>;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number): value is number =>
  bounded(value, min, max) && Number.isInteger(value);

function date(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z");
}

function seasonDate(timestamp: string, season: string): boolean {
  const start = Number(season.slice(0, 4));
  // COVID-delayed seasons extended beyond the ordinary July boundary.
  const endMonth = season === "2019-20" ? "11" : season === "2020-21" ? "08" : "07";
  return timestamp >= `${start}-07-01T00:00:00.000Z` &&
    timestamp < `${start + 1}-${endMonth}-01T00:00:00.000Z`;
}

export function validateForecastPool(value: unknown): ForecastPool {
  const pool = object(value);
  check(typeof pool.season === "string", "pool.season");
  validateSeason(pool.season);
  check(pool.provider === "NBA Stats" || pool.provider === "BALLDONTLIE", "pool.provider");
  check(date(pool.updatedAt) && Date.parse(pool.updatedAt) <= Date.now(), "pool.updatedAt");
  check(seasonDate(pool.updatedAt, pool.season), "pool.updatedAt season");
  check(typeof pool.complete === "boolean", "pool.complete");
  check(Array.isArray(pool.players) && pool.players.length > 0 && pool.players.length <= 1000,
    "pool.players");
  const ids = new Set<string>();
  for (const item of pool.players) {
    const player = object(item);
    check(typeof player.id === "string" && /^[1-9]\d*$/.test(player.id) &&
      Number.isSafeInteger(Number(player.id)) && !ids.has(player.id), "player.id (unique numeric provider ID)");
    ids.add(player.id);
    check(text(player.name) && text(player.eligibilitySource), "player.name/source");
    check(date(player.verifiedAt) &&
      Date.parse(player.verifiedAt) <= Date.parse(pool.updatedAt), "player.verifiedAt");
    check(integer(player.remainingGames, 0, 82), "player.remainingGames");
    check(bounded(player.expectedMinutes, 0, 48), "player.expectedMinutes");
    check(bounded(player.availability, 0, 1), "player.availability");
    check(bounded(player.uncertainty, Number.EPSILON, 1), "player.uncertainty");
    if (player.outlook !== undefined) {
      const outlook = object(player.outlook);
      check(["active", "out", "awaiting-debut"].includes(String(outlook.status)), "outlook.status");
      check(text(outlook.source), "outlook.source");
      check(date(outlook.reviewedAt) && seasonDate(outlook.reviewedAt, pool.season) &&
        Date.parse(outlook.reviewedAt) <= Date.parse(pool.updatedAt), "outlook.reviewedAt");
      if (outlook.returnPlan !== undefined) {
        check(outlook.status !== "active", "active outlook cannot have a return plan");
        const plan = object(outlook.returnPlan);
        let previousDate = pool.updatedAt;
        let previousMissed = 0;
        for (const scenario of returnScenarios) {
          const window = object(plan[scenario]);
          check(date(window.date) && seasonDate(window.date, pool.season) &&
            Date.parse(window.date) >= Date.parse(previousDate), `returnPlan.${scenario}.date`);
          check(integer(window.missedGames, previousMissed, Number(player.remainingGames)),
            `returnPlan.${scenario}.missedGames`);
          previousDate = window.date;
          previousMissed = window.missedGames;
        }
        check(integer(plan.rampUpGames, 0, 82), "returnPlan.rampUpGames");
        check(bounded(plan.rampUpMinutes, 0, Number(player.expectedMinutes)), "returnPlan.rampUpMinutes");
      }
    }
    const prior = object(player.preseason);
    check(bounded(prior.minutes, 0, 48) && text(prior.role), "preseason.minutes/role");
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      check(bounded(prior[key], 0, limits[key]), `preseason.${key}`);
      check(prior.minutes !== 0 || prior[key] === 0, "zero-minute prior production");
    }
  }
  return value as ForecastPool;
}

export function validateForecastModel(value: unknown): ForecastModel {
  const model = object(value);
  check(model.version === 1, "model.version");
  const weights = object(model.featureWeights);
  check(features.every((key) => bounded(weights[key], 0, 20)) &&
    features.some((key) => Number(weights[key]) > 0), "model.featureWeights");
  check(bounded(model.temperature, 0.1, 10), "model.temperature");
  check(typeof model.trainedThrough === "string", "model.trainedThrough");
  validateSeason(model.trainedThrough);
  check(Number(model.trainedThrough.slice(0, 4)) < new Date().getUTCFullYear(),
    "model.trainedThrough (completed season)");
  check(integer(model.trainingSeasonCount, MIN_FIT + MIN_CALIBRATION + MIN_VALIDATION, 200),
    "model.trainingSeasonCount");
  const validation = object(model.validation);
  check(validation.method === "chronological-held-out" &&
    integer(validation.seasonCount, MIN_VALIDATION, Number(model.trainingSeasonCount) - MIN_FIT - MIN_CALIBRATION),
  "model.validation method/count");
  check(Array.isArray(validation.seasons) && validation.seasons.length === validation.seasonCount,
    "model.validation.seasons");
  let previous = "";
  for (const season of validation.seasons) {
    check(typeof season === "string", "model.validation season");
    validateSeason(season);
    check(season > previous && season <= model.trainedThrough, "model.validation chronology");
    previous = season;
  }
  check(bounded(validation.brier, 0, 2) && bounded(validation.logLoss, 0, 35),
    "model.validation metrics");
  return value as ForecastModel;
}

function validateForecastSnapshot(value: unknown): RookieSnapshot {
  const snapshot = object(value);
  if (!Array.isArray(snapshot.rookies) || snapshot.rookies.length > 0) return validateSnapshot(value);
  // An explicitly empty observed field is valid before any eligible player debuts.
  check(typeof snapshot.season === "string", "snapshot.season");
  validateSeason(snapshot.season);
  check(date(snapshot.updatedAt), "snapshot.updatedAt");
  check(snapshot.source === "snapshot" && snapshot.scheduledGames === 82, "snapshot.source/scheduledGames");
  check(snapshot.notice === undefined || typeof snapshot.notice === "string", "snapshot.notice");
  const metadata = object(snapshot.sourceMetadata);
  check(["NBA Stats", "BALLDONTLIE"].includes(String(metadata.provider)) &&
    metadata.seasonType === "Regular Season", "snapshot.sourceMetadata");
  check(Array.isArray(metadata.endpoints) && metadata.endpoints.length > 0 &&
    metadata.endpoints.every(text), "snapshot.sourceMetadata.endpoints");
  check(Array.isArray(metadata.warnings) && metadata.warnings.every(text),
    "snapshot.sourceMetadata.warnings");
  return value as RookieSnapshot;
}

function validateContext(pool: ForecastPool, snapshot: RookieSnapshot) {
  validateForecastPool(pool);
  validateForecastSnapshot(snapshot);
  check(pool.complete, "complete eligible pool required");
  check(pool.season === snapshot.season, "pool/snapshot season mismatch");
  // Collection may follow the review; the latest actual observation must not.
  check(Date.parse(snapshot.updatedAt) <= Date.now(), "snapshot collection in future");
  check(seasonDate(snapshot.updatedAt, pool.season), "snapshot season dates");
  const ids = new Set(pool.players.map((player) => player.id));
  check(pool.provider === snapshot.sourceMetadata?.provider, "pool/snapshot provider mismatch");
  for (const rookie of snapshot.rookies) {
    check(ids.has(rookie.id), "snapshot player absent from eligible pool");
    check(rookie.games.every((game) => seasonDate(game.date, pool.season)), "game outside target season");
    check(rookie.games.every((game) => Date.parse(game.date) <= Date.parse(pool.updatedAt)),
      "observed game after outlook review");
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      check(bounded(rookie.stats[key], 0, limits[key]), `observed.${key}`);
    }
    const player = pool.players.find((entry) => entry.id === rookie.id)!;
    check(rookie.stats.gamesPlayed + player.remainingGames <= 82, "combined games exceed 82");
  }
}

interface Projection {
  player: ForecastPlayer;
  games: number;
  observedWeight: number;
  actual: number[];
  future: number[];
}

function projections(pool: ForecastPool, snapshot: RookieSnapshot): Projection[] {
  const observed = new Map(snapshot.rookies.map((rookie) => [rookie.id, rookie]));
  return pool.players.map((player) => {
    const stats = observed.get(player.id)?.stats;
    const games = stats?.gamesPlayed ?? 0;
    const observedWeight = games / (games + 20);
    const rates = (Object.keys(limits) as (keyof typeof limits)[]).map((key) => {
      const prior = player.preseason.minutes > 0 && player.expectedMinutes > 0
        ? Math.min(limits[key], player.preseason[key] / player.preseason.minutes * player.expectedMinutes)
        : 0;
      return prior * (1 - observedWeight) + (stats?.[key] ?? 0) * observedWeight;
    });
    return {
      player, games, observedWeight,
      actual: [stats?.points ?? 0, stats?.rebounds ?? 0, stats?.assists ?? 0,
        (stats?.steals ?? 0) + (stats?.blocks ?? 0)].map((rate) => rate * games),
      future: [rates[0], rates[1], rates[2], rates[3] + rates[4]],
    };
  });
}

function shock(id: string, scenario: number, dimension: number): number {
  if (scenario === 0) return 0;
  let hash = 2166136261;
  for (const char of `${id}:${Math.ceil(scenario / 2)}:${dimension}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  const value = (hash >>> 0) / 4294967295 * 2 - 1;
  return scenario % 2 === 0 ? -value : value;
}

function remainingProduction(
  player: ForecastPlayer, availability: number, returnScenario: ReturnScenario,
) {
  const plan = player.outlook?.returnPlan;
  const opportunities = Math.max(0, player.remainingGames - (plan?.[returnScenario].missedGames ?? 0));
  const games = opportunities * availability;
  const rampGames = Math.min(opportunities, plan?.rampUpGames ?? 0) * availability;
  const rampFraction = player.expectedMinutes > 0 ? (plan?.rampUpMinutes ?? player.expectedMinutes) / player.expectedMinutes : 0;
  // Rates already reflect expected minutes; ramp-up scales both observed and prior production.
  const productionGames = games - rampGames * (1 - rampFraction);
  return { games, productionGames };
}

function vector(projection: Projection, scenario: number, returnScenario: ReturnScenario = "expected"): number[] {
  const { player, actual, future, games, observedWeight } = projection;
  const availability = Math.max(0, Math.min(1,
    player.availability + shock(player.id, scenario, 0) *
      player.uncertainty * player.availability * (1 - player.availability)));
  const remaining = remainingProduction(player, availability, returnScenario);
  const uncertainty = player.uncertainty * (1 - 0.65 * observedWeight);
  const totals = actual.map((total, index) =>
    total + future[index] * remaining.productionGames * Math.max(0, 1 + shock(player.id, scenario, index + 1) * uncertainty));
  return [totals[0] / 2000, totals[1] / 800, totals[2] / 600,
    totals[3] / 200, (games + remaining.games) / 82];
}

function softmax(vectors: number[][], weights: number[], temperature: number): number[] {
  const scores = vectors.map((row) => row.reduce((sum, value, i) => sum + value * weights[i], 0) / temperature);
  const max = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(Math.max(-700, score - max)));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((value) => value / sum);
}

function probabilities(rows: Projection[], weights: number[], temperature: number, returnScenario: ReturnScenario = "expected") {
  const scenarios = Array.from({ length: SCENARIOS }, (_, index) =>
    softmax(rows.map((row) => vector(row, index, returnScenario)), weights, temperature));
  return rows.map((_, index) => {
    const probability = scenarios.reduce((sum, row) => sum + row[index], 0) / SCENARIOS;
    return {
      probability,
      lower: Math.min(probability, ...scenarios.map((row) => row[index])),
      upper: Math.max(probability, ...scenarios.map((row) => row[index])),
    };
  });
}

export function forecastRace(
  pool: ForecastPool, snapshot: RookieSnapshot, model?: ForecastModel,
): { players: PlayerForecast[]; status: "experimental" | "backtested"; warnings: string[] } {
  validateContext(pool, snapshot);
  if (model) {
    validateForecastModel(model);
    check(model.trainedThrough < pool.season, "model trained on target/future season");
  }
  const rows = projections(pool, snapshot);
  const weights = model ? features.map((key) => model.featureWeights[key]) : baseline;
  const temperature = model?.temperature ?? 0.7;
  const estimates = probabilities(rows, weights, temperature);
  const hasReturnPlans = rows.some((row) => row.player.outlook?.returnPlan);
  const alternatives = hasReturnPlans ? returnScenarios.map((scenario) => ({
    scenario, estimates: scenario === "expected" ? estimates : probabilities(rows, weights, temperature, scenario),
  })) : [];
  const players = rows.map((row, i): PlayerForecast => {
    const remaining = remainingProduction(row.player, row.player.availability, "expected");
    return {
      id: row.player.id, name: row.player.name, ...estimates[i],
      lower: Math.min(estimates[i].lower, ...alternatives.map((item) => item.estimates[i].lower)),
      upper: Math.max(estimates[i].upper, ...alternatives.map((item) => item.estimates[i].upper)),
      projectedGames: row.games + remaining.games,
      projectedPoints: row.actual[0] + row.future[0] * remaining.productionGames,
      observedWeight: row.observedWeight,
      expectedMinutes: row.player.expectedMinutes,
      availability: row.player.availability,
      ...(row.player.outlook ? { outlook: row.player.outlook } : {}),
      ...(hasReturnPlans ? { returnScenarios: alternatives.map(({ scenario, estimates: values }) => {
        const future = remainingProduction(row.player, row.player.availability, scenario);
        return {
          scenario, probability: values[i].probability,
          projectedGames: row.games + future.games,
          projectedPoints: row.actual[0] + row.future[0] * future.productionGames,
        };
      }) } : {}),
    };
  }).sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
  const warnings = [
    "Scenario ranges are deterministic sensitivity ranges, not calibrated confidence intervals.",
    "Eligibility, role, availability and minutes are reviewed assumptions; completeness is curator-attested.",
    "Stats collection and outlook review are separate as-of times. Provider game timestamps are calendar dates, not exact tipoff times; recorded games must not postdate pool.updatedAt. Priors are not observations.",
  ];
  if (!model) warnings.push("Experimental assumptions: no historical calibration or backtest available.");
  else warnings.push(`Small-sample historical backtest: ${model.validation.seasonCount} held-out seasons; not proof of calibration.`);
  if (players.some((player) => player.observedWeight === 0)) warnings.push("Awaiting-debut players use priors only.");
  if (hasReturnPlans) warnings.push("Headline estimates use expected returns. Early/delayed comparisons change all reviewed return plans together, not just one player; no likelihood is assigned to these scenarios. Return assumptions and ramp-up effects are experimental, even with a historically backtested model.");
  return { players, status: model ? "backtested" : "experimental", warnings };
}

export function validateHistoricalRace(value: unknown): HistoricalRace {
  const race = object(value);
  const pool = validateForecastPool(race.pool);
  const snapshot = validateForecastSnapshot(race.snapshot);
  validateContext(pool, snapshot);
  check(date(race.outcomeAt) && Date.parse(race.outcomeAt) <= Date.now() &&
    Date.parse(race.outcomeAt) > Date.parse(pool.updatedAt) &&
    Date.parse(race.outcomeAt) > Date.parse(snapshot.updatedAt), "outcomeAt (after forecast, not future)");
  check(race.outcomeAt >= `${Number(pool.season.slice(0, 4)) + 1}-04-01T00:00:00.000Z`,
    "outcomeAt before award season outcome");
  check(typeof race.winnerId === "string" &&
    pool.players.some((player) => player.id === race.winnerId), "winnerId absent from complete pool");
  return value as HistoricalRace;
}

function loss(probability: number): number {
  return -Math.log(Math.max(1e-15, probability));
}

interface TrainingRow { race: HistoricalRace; rows: Projection[]; winner: number }

function fitWeights(data: TrainingRow[]): number[] {
  const weights = [...baseline];
  for (let iteration = 0; iteration < 200; iteration++) {
    const gradient = weights.map(() => 0);
    for (const { rows, winner } of data) {
      const vectors = rows.map((row) => vector(row, 0));
      const prediction = softmax(vectors, weights, 1);
      for (let j = 0; j < weights.length; j++) {
        gradient[j] += vectors.reduce((sum, row, i) =>
          sum + (prediction[i] - Number(i === winner)) * row[j], 0) / data.length;
      }
    }
    for (let j = 0; j < weights.length; j++) {
      weights[j] = Math.max(0.01, Math.min(20,
        weights[j] - 0.1 * (gradient[j] + 0.03 * (weights[j] - baseline[j]))));
    }
  }
  return weights;
}

function calibrate(data: TrainingRow[], weights: number[]): number {
  let best = 1;
  let bestLoss = Infinity;
  for (const temperature of [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 3, 4]) {
    const score = data.reduce((sum, { rows, winner }) =>
      sum + loss(probabilities(rows, weights, temperature)[winner].probability), 0);
    if (score < bestLoss) { bestLoss = score; best = temperature; }
  }
  return best;
}

/** Expanding chronological folds: fit, then two calibration seasons, then untouched evaluation. */
export function trainForecastModel(history: HistoricalRace[]): ForecastModel {
  check(Array.isArray(history) && history.length >= MIN_FIT + MIN_CALIBRATION + MIN_VALIDATION &&
    history.length <= 200, "history (at least six distinct completed seasons)");
  const races = history.map(validateHistoricalRace).sort((a, b) => a.pool.season.localeCompare(b.pool.season));
  check(new Set(races.map((race) => race.pool.season)).size === races.length, "duplicate historical seasons");
  for (let i = 1; i < races.length; i++) {
    check(races.slice(0, i).every((race) =>
      Date.parse(race.outcomeAt) < Math.min(
        Date.parse(races[i].pool.updatedAt), Date.parse(races[i].snapshot.updatedAt))),
    "prior outcome unavailable at later historical forecast");
  }
  const data: TrainingRow[] = races.map((race) => ({
    race, rows: projections(race.pool, race.snapshot),
    winner: race.pool.players.findIndex((player) => player.id === race.winnerId),
  }));
  let brier = 0;
  let logLoss = 0;
  const seasons: string[] = [];
  for (let i = MIN_FIT + MIN_CALIBRATION; i < data.length; i++) {
    const targetTime = Date.parse(data[i].race.pool.updatedAt);
    check(data.slice(0, i).every(({ race }) => Date.parse(race.outcomeAt) < targetTime),
      "prior outcome unavailable at held-out forecast");
    const weights = fitWeights(data.slice(0, i - MIN_CALIBRATION));
    const temperature = calibrate(data.slice(i - MIN_CALIBRATION, i), weights);
    const predicted = probabilities(data[i].rows, weights, temperature);
    brier += predicted.reduce((sum, item, index) =>
      sum + (item.probability - Number(index === data[i].winner)) ** 2, 0);
    logLoss += loss(predicted[data[i].winner].probability);
    seasons.push(data[i].race.pool.season);
  }
  const weights = fitWeights(data.slice(0, -MIN_CALIBRATION));
  const temperature = calibrate(data.slice(-MIN_CALIBRATION), weights);
  return validateForecastModel({
    version: 1,
    featureWeights: Object.fromEntries(features.map((key, i) => [key, weights[i]])),
    temperature, trainedThrough: races[races.length - 1].pool.season,
    trainingSeasonCount: races.length,
    validation: {
      method: "chronological-held-out", seasonCount: seasons.length, seasons,
      brier: brier / seasons.length, logLoss: logLoss / seasons.length,
    },
  });
}
