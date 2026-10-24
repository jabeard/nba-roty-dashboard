import type { Rookie } from "./models.ts";

export type ApiRow = Record<string, unknown>;

export function apiObject(value: unknown): ApiRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BALLDONTLIE: expected an object.");
  }
  return value as ApiRow;
}

export function apiNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`BALLDONTLIE: invalid ${field}.`);
  }
  return value;
}

export function apiId(value: unknown): number {
  const id = apiNumber(value, "ID");
  if (!id) throw new Error("BALLDONTLIE: ID must be positive.");
  return id;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("BALLDONTLIE: missing text field.");
  return value.trim();
}

export function apiDate(value: unknown): string {
  const date = text(value).slice(0, 10);
  const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new Error("BALLDONTLIE: invalid game date.");
  }
  return new Date(time).toISOString();
}

export function hasAppearance(row: ApiRow): boolean {
  const production = ["pts", "reb", "ast", "stl", "blk", "fga", "fta", "turnover", "pf"]
    .some((field) => typeof row[field] === "number" && Number(row[field]) > 0);
  if (row.min === null || row.min === "") return production;
  if (typeof row.min !== "string" || !/^\d+(?::[0-5]\d)?$/.test(row.min)) {
    throw new Error("BALLDONTLIE: invalid minutes; cannot determine appearance.");
  }
  // A sub-minute appearance may be rounded to zero; recorded production still counts.
  return row.min.split(":").some((part) => Number(part) > 0) || production;
}

export function regularSeasonGame(row: ApiRow, year: number): ApiRow {
  const game = apiObject(row.game);
  if (game.season !== year || game.postseason !== false) {
    throw new Error("BALLDONTLIE: unexpected season or postseason game.");
  }
  apiId(game.id);
  apiDate(game.date);
  return game;
}

export function normalizeBallDontLieRookie(rows: ApiRow[], teams: Map<number, ApiRow>): Rookie {
  const sorted = [...rows].sort((a, b) => apiDate(apiObject(a.game).date)
    .localeCompare(apiDate(apiObject(b.game).date)));
  if (!sorted.length) throw new Error("BALLDONTLIE: no appearances.");
  const latest = sorted.at(-1)!;
  const player = apiObject(latest.player);
  const id = apiId(player.id);
  const team = apiObject(latest.team);
  const positionCode = text(player.position).split("-")[0];
  const position = { G: "Guard", F: "Forward", C: "Center" }[positionCode];
  if (!position) throw new Error(`BALLDONTLIE: unknown position for player ${id}.`);
  const seen = new Set<number>();
  const totals: Record<string, number> = {};
  const fields = ["pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];
  for (const row of sorted) {
    if (apiObject(row.player).id !== id) throw new Error("BALLDONTLIE: mismatched player ID.");
    const gameId = apiId(apiObject(row.game).id);
    if (seen.has(gameId)) throw new Error(`BALLDONTLIE: duplicate game for player ${id}.`);
    seen.add(gameId);
    for (const field of fields) totals[field] = (totals[field] ?? 0) + apiNumber(row[field], field);
    for (const [made, attempted] of [["fgm", "fga"], ["fg3m", "fg3a"], ["ftm", "fta"]]) {
      if (Number(row[made]) > Number(row[attempted])) throw new Error("BALLDONTLIE: makes exceed attempts.");
    }
  }
  const average = (field: string) => totals[field] / sorted.length;
  const percentage = (made: string, attempted: string) => totals[attempted] ? totals[made] / totals[attempted] : 0;
  const optionalInteger = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  return {
    id: String(id),
    name: `${text(player.first_name)} ${text(player.last_name)}`,
    team: text(team.full_name),
    teamCode: text(team.abbreviation),
    position,
    number: typeof player.jersey_number === "string" && /^\d+$/.test(player.jersey_number)
      ? Number(player.jersey_number) : null,
    age: null,
    draftPick: optionalInteger(player.draft_number),
    color: "#a5b4c6",
    stats: {
      gamesPlayed: sorted.length,
      points: average("pts"), rebounds: average("reb"), assists: average("ast"),
      steals: average("stl"), blocks: average("blk"),
      fieldGoalPct: percentage("fgm", "fga"),
      threePointPct: percentage("fg3m", "fg3a"),
      freeThrowPct: percentage("ftm", "fta"),
    },
    games: sorted.slice(-10).map((row) => {
      const game = apiObject(row.game);
      const teamId = apiId(apiObject(row.team).id);
      const home = apiId(game.home_team_id ?? apiObject(game.home_team).id);
      const visitor = apiId(game.visitor_team_id ?? apiObject(game.visitor_team).id);
      if (home === visitor || (teamId !== home && teamId !== visitor)) {
        throw new Error("BALLDONTLIE: box-score team does not match game.");
      }
      const opponent = teams.get(teamId === home ? visitor : home);
      if (!opponent) throw new Error("BALLDONTLIE: missing opponent team.");
      return {
        date: apiDate(game.date),
        opponent: `${teamId === home ? "vs." : "@"} ${text(opponent.abbreviation)}`,
        points: apiNumber(row.pts, "pts"), rebounds: apiNumber(row.reb, "reb"),
        assists: apiNumber(row.ast, "ast"),
      };
    }),
  };
}
