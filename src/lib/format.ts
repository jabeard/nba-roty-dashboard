import type { GameLog } from "./models.ts";

export const formatStat = (value: number) => value.toFixed(1);
export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

export function recentAverages(games: GameLog[]) {
  const recent = games.slice(-10);
  if (!recent.length) return null;
  return {
    points: recent.reduce((sum, game) => sum + game.points, 0) / recent.length,
    rebounds: recent.reduce((sum, game) => sum + game.rebounds, 0) / recent.length,
    assists: recent.reduce((sum, game) => sum + game.assists, 0) / recent.length,
    count: recent.length,
  };
}
