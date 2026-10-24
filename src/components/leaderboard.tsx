"use client";

import { useState } from "react";
import { formatPercent, formatStat } from "@/lib/format";
import type { SeasonStats } from "@/lib/models";
import type { RankedRookie } from "@/lib/scoring";
import { PlayerAvatar } from "./icons";

type SortKey = "name" | "teamCode" | "score" | keyof SeasonStats;
const columns: { key: SortKey; label: string; title: string }[] = [
  { key: "name", label: "PLAYER", title: "Player name" },
  { key: "teamCode", label: "TEAM", title: "Team" },
  { key: "gamesPlayed", label: "GP", title: "Games played" },
  { key: "points", label: "PPG", title: "Points per game" },
  { key: "rebounds", label: "RPG", title: "Rebounds per game" },
  { key: "assists", label: "APG", title: "Assists per game" },
  { key: "steals", label: "SPG", title: "Steals per game" },
  { key: "blocks", label: "BPG", title: "Blocks per game" },
  { key: "fieldGoalPct", label: "FG%", title: "Field goal percentage" },
  { key: "threePointPct", label: "3P%", title: "Three point percentage" },
  { key: "freeThrowPct", label: "FT%", title: "Free throw percentage" },
  { key: "score", label: "SCORE", title: "ROTY Score" },
];

const sortValue = (rookie: RankedRookie, key: SortKey) =>
  key === "name" || key === "teamCode" || key === "score" ? rookie[key] : rookie.stats[key];

export function Leaderboard({
  rookies, selectedId, onSelect,
}: { rookies: RankedRookie[]; selectedId: string | undefined; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("All positions");
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "score", ascending: false });
  const filtered = rookies.filter((rookie) =>
    `${rookie.name} ${rookie.team}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (position === "All positions" || rookie.position === position),
  ).sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return (sort.ascending ? result : -result) || a.rank - b.rank;
  });

  function sortBy(key: SortKey) {
    setSort({ key, ascending: sort.key === key ? !sort.ascending : key === "name" || key === "teamCode" });
  }

  return (
    <div className="panel leaderboard">
      <div className="leaderboard-toolbar">
        <label className="search-field"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" /></svg><span className="sr-only">Search rookies or teams</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team…" /></label>
        <label><span className="sr-only">Filter by position</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{["All positions", "Guard", "Forward", "Center"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="table-scroll" role="region" aria-label="Sortable rookie leaderboard" tabIndex={0}>
        <table className="rookie-table">
          <caption className="sr-only">Rookie leaderboard. Select a player for details. Column buttons change sorting.</caption>
          <thead><tr><th scope="col" className="rank-cell">#</th>{columns.map((column) => <th scope="col" key={column.key} aria-sort={sort.key === column.key ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => sortBy(column.key)} title={column.title} aria-label={`Sort by ${column.title}`}>{column.label}<span className={sort.key === column.key ? "sort-active" : "sort-icon"} aria-hidden="true">{sort.key === column.key ? sort.ascending ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead>
          <tbody>{filtered.map((rookie) => (
            <tr key={rookie.id} className={selectedId === rookie.id ? "selected-row" : ""}>
              <td className="rank-cell"><span className={rookie.rank <= 3 ? `rank-medal rank-${rookie.rank}` : "rank-number"}>{String(rookie.rank).padStart(2, "0")}</span></td>
              <th scope="row"><button className="player-button" onClick={() => onSelect(rookie.id)} aria-controls="player-detail" aria-pressed={selectedId === rookie.id}><PlayerAvatar name={rookie.name} color={rookie.color} /><span>{rookie.name}<small>{rookie.position}</small></span></button></th>
              <td className="team-cell">{rookie.teamCode}</td>
              <td>{rookie.stats.gamesPlayed}</td>
              <td className="points-cell">{formatStat(rookie.stats.points)}</td>
              <td>{formatStat(rookie.stats.rebounds)}</td><td>{formatStat(rookie.stats.assists)}</td><td>{formatStat(rookie.stats.steals)}</td><td>{formatStat(rookie.stats.blocks)}</td>
              <td>{formatPercent(rookie.stats.fieldGoalPct)}</td><td>{formatPercent(rookie.stats.threePointPct)}</td><td>{formatPercent(rookie.stats.freeThrowPct)}</td>
              <td><span className="score-pill">{formatStat(rookie.score)}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!filtered.length && <div className="empty-state"><strong>{rookies.length ? "No rookies match your search" : "The rookie race hasn’t started yet"}</strong><p>{rookies.length ? "Try another name, team, or position." : "Check back when the first snapshot is available."}</p>{rookies.length > 0 && <button className="text-button" onClick={() => { setQuery(""); setPosition("All positions"); }}>Clear filters</button>}</div>}
      <div className="table-footer"><span aria-live="polite">Showing {filtered.length} of {rookies.length} rookies</span><span>Click a player to explore <span aria-hidden="true">↗</span></span></div>
    </div>
  );
}
