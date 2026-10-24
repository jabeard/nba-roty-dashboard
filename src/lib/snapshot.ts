import type { RookieSnapshot } from "./models.ts";
import { validateSeason } from "./nba-stats.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a snapshot object.");
  return value as Record<string, unknown>;
}

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid snapshot field: ${field}.`);
}

const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown) => number(value) && Number.isInteger(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateSnapshot(value: unknown): RookieSnapshot {
  const snapshot = record(value);
  requireValue(typeof snapshot.season === "string", "season");
  validateSeason(snapshot.season);
  requireValue(timestamp(snapshot.updatedAt), "updatedAt (UTC ISO timestamp)");
  requireValue(snapshot.source === "snapshot", "source");
  requireValue(snapshot.notice === undefined || typeof snapshot.notice === "string", "notice");
  requireValue(snapshot.scheduledGames === 82, "scheduledGames (82)");
  requireValue(Array.isArray(snapshot.rookies) && snapshot.rookies.length > 0, "rookies (nonempty)");
  const metadata = record(snapshot.sourceMetadata);
  requireValue(metadata.provider === "NBA Stats" && metadata.seasonType === "Regular Season", "sourceMetadata");
  requireValue(Array.isArray(metadata.endpoints) && metadata.endpoints.length > 0 &&
    metadata.endpoints.every(nonempty), "sourceMetadata.endpoints");
  requireValue(Array.isArray(metadata.warnings) && metadata.warnings.every(nonempty), "sourceMetadata.warnings");
  const ids = new Set<string>();
  for (const item of snapshot.rookies) {
    const rookie = record(item);
    for (const field of ["id", "name", "team", "teamCode", "position"]) {
      requireValue(nonempty(rookie[field]), `rookie.${field}`);
    }
    requireValue(typeof rookie.id === "string" && /^\d+$/.test(rookie.id) &&
      !ids.has(rookie.id), "rookie.id (unique NBA ID)");
    ids.add(rookie.id);
    requireValue(["Guard", "Forward", "Center"].includes(String(rookie.position)), "rookie.position");
    requireValue(typeof rookie.color === "string" && /^#[0-9a-f]{6}$/i.test(rookie.color), "rookie.color");
    requireValue(number(rookie.age) && rookie.age > 0, "rookie.age");
    for (const field of ["number", "draftPick"]) {
      requireValue(rookie[field] === null || integer(rookie[field]), `rookie.${field}`);
    }
    const stats = record(rookie.stats);
    requireValue(integer(stats.gamesPlayed) && Number(stats.gamesPlayed) > 0 &&
      Number(stats.gamesPlayed) <= 82, "stats.gamesPlayed");
    for (const field of ["points", "rebounds", "assists", "steals", "blocks"]) {
      requireValue(number(stats[field]), `stats.${field}`);
    }
    for (const field of ["fieldGoalPct", "threePointPct", "freeThrowPct"]) {
      requireValue(number(stats[field]) && Number(stats[field]) <= 1, `stats.${field} (0–1 fraction)`);
    }
    requireValue(Array.isArray(rookie.games) &&
      rookie.games.length === Math.min(10, Number(stats.gamesPlayed)), "rookie.games (last ten appearances)");
    let previous = "";
    for (const item of rookie.games) {
      const game = record(item);
      requireValue(timestamp(game.date) && game.date > previous &&
        game.date <= snapshot.updatedAt, "game.date (unique, chronological, not after collection)");
      previous = game.date;
      requireValue(nonempty(game.opponent), "game.opponent");
      for (const field of ["points", "rebounds", "assists"]) {
        requireValue(integer(game[field]), `game.${field}`);
      }
    }
  }
  return value as RookieSnapshot;
}
