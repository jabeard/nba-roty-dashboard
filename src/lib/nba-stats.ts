import type { GameLog, Rookie, RookieSnapshot } from "./models.ts";

type Row = Record<string, unknown>;

function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an NBA Stats object.");
  }
  return value as Row;
}

export function resultRows(payload: unknown, name: string): Row[] {
  const sets = object(payload).resultSets;
  if (!Array.isArray(sets)) throw new Error("NBA Stats response is missing resultSets.");
  const set = sets.map(object).find((item) => item.name === name);
  if (!set || !Array.isArray(set.headers) || !Array.isArray(set.rowSet) ||
      !set.headers.every((header) => typeof header === "string") ||
      new Set(set.headers).size !== set.headers.length) {
    throw new Error(`NBA Stats response is missing a valid ${name} table.`);
  }
  const headers = set.headers as string[];
  return set.rowSet.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) {
      throw new Error(`Malformed row in ${name}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing or invalid ${field}.`);
  return value.trim();
}

function numeric(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Missing or invalid ${field}.`);
  }
  return value;
}

export function normalizePercentage(value: unknown): number {
  // NBA Stats returns fractions. Reject other scales instead of silently guessing.
  const fraction = numeric(value, "shooting percentage");
  if (fraction > 1) throw new Error("NBA Stats shooting percentage must be a 0–1 fraction.");
  return fraction;
}

export function validateSeason(season: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
    throw new Error("Season must use consecutive years, e.g. 2026-27.");
  }
  return season;
}

export function normalizeGameLogs(payload: unknown, playerId?: number): GameLog[] {
  const games = resultRows(payload, "PlayerGameLog").map((row) => {
    if (playerId !== undefined && row.Player_ID !== playerId) {
      throw new Error("Game log player ID does not match leaderboard.");
    }
    const rawDate = text(row.GAME_DATE, "GAME_DATE");
    const english = /^([A-Z]{3}) (\d{1,2}), (\d{4})$/i.exec(rawDate);
    const month = english ? ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
      .indexOf(english[1].toUpperCase()) + 1 : 0;
    // NBA's calendar dates have no timezone. Reject impossible dates rather than rolling them forward.
    const date = english && month
      ? `${english[3]}-${String(month).padStart(2, "0")}-${english[2].padStart(2, "0")}` : rawDate;
    const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
      throw new Error(`Invalid GAME_DATE: ${rawDate}.`);
    }
    return {
      date: new Date(time).toISOString(),
      opponent: text(row.MATCHUP, "MATCHUP"),
      points: numeric(row.PTS, "PTS"),
      rebounds: numeric(row.REB, "REB"),
      assists: numeric(row.AST, "AST"),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(games.map((game) => game.date)).size !== games.length) {
    throw new Error("Duplicate game dates in PlayerGameLog.");
  }
  return games.slice(-10);
}

function optionalInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export function normalizeRookie(row: Row, infoPayload: unknown, logPayload: unknown): Rookie {
  const info = resultRows(infoPayload, "CommonPlayerInfo")[0];
  if (!info || info.PERSON_ID !== row.PLAYER_ID) throw new Error("Player bio ID does not match leaderboard.");
  const id = numeric(row.PLAYER_ID, "PLAYER_ID");
  if (!Number.isInteger(id) || id === 0) throw new Error("Invalid PLAYER_ID.");
  const gamesPlayed = numeric(row.GP, "GP");
  if (!Number.isInteger(gamesPlayed) || gamesPlayed < 1 || gamesPlayed > 82) throw new Error("Invalid GP.");
  const games = normalizeGameLogs(logPayload, id);
  if (games.length < Math.min(10, gamesPlayed)) {
    throw new Error(`Incomplete game logs: expected ${Math.min(10, gamesPlayed)}, received ${games.length}.`);
  }
  const teamCode = text(row.TEAM_ABBREVIATION, "TEAM_ABBREVIATION");
  const position = text(info.POSITION, "POSITION").split("-")[0];
  if (!["Guard", "Forward", "Center"].includes(position)) throw new Error(`Unknown position: ${position}.`);
  return {
    id: String(id),
    name: text(row.PLAYER_NAME, "PLAYER_NAME"),
    team: info.TEAM_ABBREVIATION === teamCode
      ? `${text(info.TEAM_CITY, "TEAM_CITY")} ${text(info.TEAM_NAME, "TEAM_NAME")}` : teamCode,
    teamCode,
    position,
    number: optionalInteger(info.JERSEY),
    age: numeric(row.AGE, "AGE"),
    draftPick: optionalInteger(info.DRAFT_NUMBER),
    color: "#a5b4c6",
    stats: {
      gamesPlayed,
      points: numeric(row.PTS, "PTS"),
      rebounds: numeric(row.REB, "REB"),
      assists: numeric(row.AST, "AST"),
      steals: numeric(row.STL, "STL"),
      blocks: numeric(row.BLK, "BLK"),
      fieldGoalPct: normalizePercentage(row.FG_PCT),
      threePointPct: normalizePercentage(row.FG3_PCT),
      freeThrowPct: normalizePercentage(row.FT_PCT),
    },
    games,
  };
}

export function createSnapshot(season: string, rookies: Rookie[], updatedAt: string): RookieSnapshot {
  return {
    season: validateSeason(season),
    updatedAt,
    source: "snapshot",
    scheduledGames: 82,
    rookies,
    sourceMetadata: {
      provider: "NBA Stats",
      seasonType: "Regular Season",
      endpoints: ["leaguedashplayerstats", "commonplayerinfo", "playergamelog"],
      warnings: [
        "Local feasibility snapshot, not a live feed. Public redistribution permissions must be confirmed.",
        "Availability uses the full 82-game season, not team games played to date.",
        "Rookie eligibility is NBA Stats' classification; verify it before public use.",
      ],
    },
  };
}
