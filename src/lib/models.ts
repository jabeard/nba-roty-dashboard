export interface SeasonStats {
  gamesPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fieldGoalPct: number;
  threePointPct: number;
  freeThrowPct: number;
}

export interface GameLog {
  date: string;
  opponent: string;
  points: number;
  rebounds: number;
  assists: number;
}

export interface Rookie {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  position: string;
  number: number | null;
  age: number | null;
  draftPick: number | null;
  color: string;
  stats: SeasonStats;
  games: GameLog[];
}

export interface RookieSnapshot {
  season: string;
  updatedAt: string;
  source: "demo" | "live" | "snapshot";
  scheduledGames: number;
  rookies: Rookie[];
  notice?: string;
  sourceMetadata?: {
    provider: "NBA Stats" | "BALLDONTLIE";
    seasonType: "Regular Season";
    endpoints: string[];
    warnings: string[];
  };
}

export interface RookieDataProvider {
  getSnapshot(): Promise<RookieSnapshot>;
}
