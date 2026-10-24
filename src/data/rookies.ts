import type { GameLog, Rookie, RookieDataProvider, SeasonStats } from "../lib/models.ts";

// Illustrative 2024–25 snapshot, not official NBA statistics.
const profiles: {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  position: string;
  number: number;
  age: number;
  draftPick: number;
  color: string;
  line: [number, number, number, number, number, number, number, number, number];
}[] = [
  { id: "stephon-castle", name: "Stephon Castle", team: "San Antonio Spurs", teamCode: "SAS", position: "Guard", number: 5, age: 20, draftPick: 4, color: "#a5b4c6", line: [48, 14.2, 3.4, 4.1, 1.0, 0.3, .429, .285, .738] },
  { id: "jaylen-wells", name: "Jaylen Wells", team: "Memphis Grizzlies", teamCode: "MEM", position: "Forward", number: 0, age: 21, draftPick: 39, color: "#93b5ee", line: [50, 11.8, 3.2, 1.8, 0.7, 0.2, .438, .382, .831] },
  { id: "zach-edey", name: "Zach Edey", team: "Memphis Grizzlies", teamCode: "MEM", position: "Center", number: 14, age: 22, draftPick: 9, color: "#93b5ee", line: [39, 9.8, 7.6, 1.0, 0.5, 1.2, .591, .333, .681] },
  { id: "alex-sarr", name: "Alex Sarr", team: "Washington Wizards", teamCode: "WAS", position: "Center", number: 20, age: 19, draftPick: 2, color: "#ff879b", line: [43, 11.6, 6.6, 2.2, 0.7, 1.6, .405, .312, .681] },
  { id: "zaccharie-risacher", name: "Zaccharie Risacher", team: "Atlanta Hawks", teamCode: "ATL", position: "Forward", number: 10, age: 19, draftPick: 1, color: "#ff9b82", line: [45, 11.2, 3.5, 1.2, 0.8, 0.5, .442, .337, .712] },
  { id: "yves-missi", name: "Yves Missi", team: "New Orleans Pelicans", teamCode: "NOP", position: "Center", number: 21, age: 20, draftPick: 21, color: "#e0c895", line: [47, 8.8, 8.1, 1.4, 0.5, 1.4, .563, 0, .614] },
  { id: "bub-carrington", name: "Bub Carrington", team: "Washington Wizards", teamCode: "WAS", position: "Guard", number: 8, age: 19, draftPick: 14, color: "#ff879b", line: [49, 9.3, 4.2, 4.5, 0.9, 0.3, .398, .335, .792] },
  { id: "isaiah-collier", name: "Isaiah Collier", team: "Utah Jazz", teamCode: "UTA", position: "Guard", number: 8, age: 20, draftPick: 29, color: "#bba1f6", line: [38, 8.2, 3.2, 6.1, 1.0, 0.2, .443, .251, .722] },
  { id: "matas-buzelis", name: "Matas Buzelis", team: "Chicago Bulls", teamCode: "CHI", position: "Forward", number: 14, age: 20, draftPick: 11, color: "#ff879b", line: [48, 7.4, 3.0, 0.7, 0.4, 0.9, .452, .347, .763] },
  { id: "dalton-knecht", name: "Dalton Knecht", team: "Los Angeles Lakers", teamCode: "LAL", position: "Forward", number: 4, age: 23, draftPick: 17, color: "#d0b2ff", line: [46, 9.1, 2.8, 0.9, 0.4, 0.1, .457, .365, .811] },
  { id: "ron-holland", name: "Ron Holland II", team: "Detroit Pistons", teamCode: "DET", position: "Forward", number: 0, age: 19, draftPick: 5, color: "#87b7fa", line: [49, 6.8, 2.8, 1.0, 0.6, 0.2, .472, .241, .781] },
  { id: "ryan-dunn", name: "Ryan Dunn", team: "Phoenix Suns", teamCode: "PHX", position: "Forward", number: 0, age: 22, draftPick: 28, color: "#e4a2fb", line: [44, 7.2, 3.3, 0.8, 0.7, 0.6, .442, .318, .632] },
];

const opponents = ["DEN", "MIL", "BOS", "DAL", "OKC", "HOU", "MIN", "LAC", "SAC", "NYK"];
const pointOffsets = [-3, 2, -1, 5, -4, 1, 7, -2, 4, 6];

export const rookies: Rookie[] = profiles.map(({ line, ...bio }, index) => {
  const [gamesPlayed, points, rebounds, assists, steals, blocks, fieldGoalPct, threePointPct, freeThrowPct] = line;
  const stats: SeasonStats = { gamesPlayed, points, rebounds, assists, steals, blocks, fieldGoalPct, threePointPct, freeThrowPct };
  const games: GameLog[] = pointOffsets.map((offset, game) => ({
    date: new Date(Date.UTC(2025, 0, 13 + game * 2)).toISOString(),
    opponent: opponents[(game + index) % opponents.length],
    points: Math.max(0, Math.round(points + offset + (index % 3) - 1)),
    rebounds: Math.max(0, Math.round(rebounds + ((game + index) % 5) - 2)),
    assists: Math.max(0, Math.round(assists + ((game + index) % 3) - 1)),
  }));
  return { ...bio, stats, games };
});

export const mockRookieProvider: RookieDataProvider = {
  async getSnapshot() {
    return {
      season: "2024–25",
      updatedAt: "2025-02-01T12:00:00.000Z",
      source: "demo",
      scheduledGames: 50,
      rookies,
    };
  },
};
