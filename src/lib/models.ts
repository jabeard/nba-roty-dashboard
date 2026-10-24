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
  number: number;
  age: number;
  draftPick: number;
  color: string;
  stats: SeasonStats;
  games: GameLog[];
}

export interface RookieSnapshot {
  season: string;
  updatedAt: string;
  source: "demo" | "live";
  scheduledGames: number;
  rookies: Rookie[];
}

export interface RookieDataProvider {
  getSnapshot(): Promise<RookieSnapshot>;
}
