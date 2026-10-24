"use client";

import dynamic from "next/dynamic";
import { formatPercent, formatStat, recentAverages } from "@/lib/format";
import type { RankedRookie } from "@/lib/scoring";
import { PlayerAvatar } from "./icons";

const PointsChart = dynamic(() => import("./points-chart"), {
  ssr: false,
  loading: () => <div className="points-chart skeleton" role="status" aria-label="Loading points chart" />,
});

export function PlayerDetail({ rookie }: { rookie: RankedRookie | undefined }) {
  if (!rookie) return <div className="panel empty-state">Select a rookie to explore their game.</div>;
  const recent = recentAverages(rookie.games);
  const change = recent ? recent.points - rookie.stats.points : 0;
  return (
    <article className="panel player-detail" aria-labelledby="player-name">
      <div className="section-kicker"><span>PLAYER SPOTLIGHT</span><span className="mini-tag">RANK #{rookie.rank}</span></div>
      <div className="player-bio">
        <PlayerAvatar name={rookie.name} color={rookie.color} large />
        <div><h3 id="player-name" aria-live="polite">{rookie.name}</h3><p>{rookie.team}</p><span>{rookie.position} <span aria-hidden="true">·</span> {rookie.number === null ? "—" : `#${rookie.number}`}</span></div>
      </div>
      <div className="bio-meta"><span>AGE <b>{rookie.age ?? "—"}</b></span><span>DRAFT PICK <b>{rookie.draftPick === null ? "—" : `#${rookie.draftPick}`}</b></span><span>ROTY SCORE <b className="lime">{formatStat(rookie.score)}</b></span></div>
      <div className="detail-section-title"><h4>Season at a glance</h4><span>{rookie.stats.gamesPlayed} games</span></div>
      <dl className="season-stats">
        {([
          ["PPG", formatStat(rookie.stats.points)], ["RPG", formatStat(rookie.stats.rebounds)],
          ["APG", formatStat(rookie.stats.assists)], ["SPG", formatStat(rookie.stats.steals)],
          ["BPG", formatStat(rookie.stats.blocks)], ["FG%", formatPercent(rookie.stats.fieldGoalPct)],
          ["3P%", formatPercent(rookie.stats.threePointPct)], ["FT%", formatPercent(rookie.stats.freeThrowPct)],
        ]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="detail-section-title trend-title"><h4>Finding their rhythm</h4><span>Last {recent?.count ?? 0} games</span></div>
      {recent ? (
        <>
          <div className="recent-headline"><strong>{formatStat(recent.points)} <small>PPG</small></strong><span className={change >= 0 ? "trend-up" : "trend-down"}>{change >= 0 ? "↗ +" : "↘ "}{formatStat(change)} <small>vs season</small></span></div>
          <p className="recent-secondary">{formatStat(recent.rebounds)} RPG <span>·</span> {formatStat(recent.assists)} APG across the last {recent.count} games</p>
        </>
      ) : <p className="empty-state">Recent form will appear when game logs are available.</p>}
      <PointsChart rookie={rookie} />
      <div className="chart-legend"><span><i /> Game points</span><span><i className="dashed" /> Season avg ({formatStat(rookie.stats.points)})</span></div>
      <details className="game-log">
        <summary>View game log <span aria-hidden="true">+</span></summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${rookie.name} game log`}>
          <table><caption className="sr-only">Recent game statistics</caption><thead><tr><th scope="col">Date</th><th scope="col">Opp</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th></tr></thead>
            <tbody>{rookie.games.slice(-10).map((game) => <tr key={game.date}><td>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(game.date))}</td><td>{game.opponent}</td><td>{game.points}</td><td>{game.rebounds}</td><td>{game.assists}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
