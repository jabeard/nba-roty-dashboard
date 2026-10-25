import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectCoverage } from "./coverage.ts";
import { forecastRace, validateForecastModel, validateForecastPool } from "./forecast.ts";
import type { ForecastModel, ForecastPool } from "./forecast.ts";
import type { RookieSnapshot } from "./models.ts";
import { validateOddsSnapshot } from "./odds.ts";

export const FORECAST_FILES = {
  pool: "data/rookie-pool.json",
  model: "data/forecast-model.json",
  odds: "data/odds-snapshot.json",
} as const;

async function readForecastFile(name: keyof typeof FORECAST_FILES) {
  if (name === "pool") {
    return readFile(resolve(process.cwd(), "data/rookie-pool.json"), "utf8");
  }
  if (name === "model") {
    return readFile(resolve(process.cwd(), "data/forecast-model.json"), "utf8");
  }
  return readFile(resolve(process.cwd(), "data/odds-snapshot.json"), "utf8");
}

export async function loadForecastDashboard(
  snapshot: RookieSnapshot,
  read: (name: keyof typeof FORECAST_FILES) => Promise<string> = readForecastFile,
  now = Date.now(),
) {
  const notices: string[] = [];
  async function optional<T>(name: keyof typeof FORECAST_FILES, validate: (value: unknown) => T) {
    try {
      return validate(JSON.parse(await read(name)));
    } catch (error) {
      notices.push((error as NodeJS.ErrnoException).code === "ENOENT"
        ? `${FORECAST_FILES[name]} is missing. ${name === "pool" ? "Supply an eligibility-reviewed pool to enable forecasts." : name === "model" ? "No trained model is available; any forecasts are experimental." : "No sportsbook prices are available."}`
        : `${FORECAST_FILES[name]} is invalid or unreadable; it has not been used.`);
      return undefined;
    }
  }
  const [poolValue, modelValue, oddsValue] = await Promise.all([
    optional("pool", validateForecastPool),
    optional("model", validateForecastModel),
    optional("odds", validateOddsSnapshot),
  ]);
  let pool: ForecastPool | undefined = poolValue;
  const model: ForecastModel | undefined = modelValue;
  if (pool && (pool.season !== snapshot.season || pool.provider !== snapshot.sourceMetadata?.provider ||
      Date.parse(pool.updatedAt) > now ||
      pool.players.some((player) => Date.parse(player.verifiedAt) > now))) {
    notices.push("The reviewed pool has a different season, provider ID namespace, or future-dated review and has not been used.");
    pool = undefined;
  }
  let forecast: ReturnType<typeof forecastRace> | null = null;
  if (pool && snapshot.source !== "demo" && Date.parse(snapshot.updatedAt) <= now) {
    try {
      forecast = forecastRace(pool, snapshot, model);
    } catch {
      notices.push("Forecast withheld: verify full-field eligibility, season alignment, remaining games, and historical model dates.");
    }
  } else if (snapshot.source === "demo") {
    notices.push("Forecasts and sportsbook comparisons are disabled for illustrative demo data.");
  } else if (Date.parse(snapshot.updatedAt) > now) {
    notices.push("Forecast withheld: snapshot collection time is in the future.");
  }
  const odds = oddsValue && oddsValue.season === snapshot.season &&
    oddsValue.playerProvider === snapshot.sourceMetadata?.provider &&
    Date.parse(oddsValue.collectedAt) <= now && snapshot.source !== "demo" ? oddsValue : null;
  if (oddsValue && !odds) notices.push("Odds have a different season or player ID namespace, a future collection time, or demo-only observations; prices are withheld.");
  const forecastStale = now - Date.parse(snapshot.updatedAt) > 48 * 60 * 60 * 1_000 ||
    Boolean(pool && (now - Date.parse(pool.updatedAt) > 48 * 60 * 60 * 1_000 ||
      pool.players.some((player) => player.outlook &&
        now - Date.parse(player.outlook.reviewedAt) > 48 * 60 * 60 * 1_000)));
  if (forecast && forecastStale) notices.push("Stats or outlook are older than 48 hours. Forecasts are historical estimates; expected-value comparisons are withheld until refreshed.");
  return {
    coverage: inspectCoverage(snapshot, pool), forecast, odds, notices,
    asOf: new Date(now).toISOString(),
    model, forecastStale,
  };
}

export type ForecastDashboardData = Awaited<ReturnType<typeof loadForecastDashboard>>;
