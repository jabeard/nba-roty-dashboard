"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RookieSnapshot } from "@/lib/models";
import { formatDate, formatStat, recentAverages } from "@/lib/format";
import { normalizeScoreWeights, rankRookies, SCORE_DIMENSIONS, SCORE_WEIGHTS } from "@/lib/scoring";
import { Arrow, Basketball, PlayerAvatar } from "./icons";
import { Leaderboard } from "./leaderboard";
import { PlayerDetail } from "./player-detail";

export function Dashboard({ snapshot }: { snapshot: RookieSnapshot }) {
  const ranked = useMemo(() => rankRookies(snapshot.rookies, snapshot.scheduledGames), [snapshot]);
  const [selectedId, setSelectedId] = useState(ranked[0]?.id);
  const detailRef = useRef<HTMLDivElement>(null);
  const selected = ranked.find((rookie) => rookie.id === selectedId);
  const leader = ranked[0];
  const weights = normalizeScoreWeights();
  function selectPlayer(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1199px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    detailRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to dashboard</a>
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Rookie Radar home"><span className="brand-mark"><Basketball /></span><span>ROOKIE<span className="brand-sub">RADAR</span></span></a>
        <span className="nav-label">THE GAME, BY THE NUMBERS</span>
        <nav aria-label="Main navigation">
          <a href="#overview" className="nav-item nav-active"><span aria-hidden="true">▦</span> Overview <span className="nav-dot" /></a>
          <a href="#leaderboard" className="nav-item"><span aria-hidden="true">☷</span> Rookie leaderboard</a>
          <a href="#methodology" className="nav-item"><span aria-hidden="true">◉</span> The scoring model</a>
        </nav>
        <div className="sidebar-bottom"><span className="season-label">ON THE RADAR</span><div className="season-value">{snapshot.season} <span>SEASON</span></div><p>A new class.<br />A race worth watching.</p><Basketball className="sidebar-ball" /><div className="independent-label">Independent. Unofficial. All hoops.</div></div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div><span className="breadcrumb">NBA</span><span className="slash">/</span>Rookie of the Year</div><div className="topbar-right"><span className="status-indicator" />{snapshot.source === "demo" ? "DEMO DATA" : snapshot.source === "snapshot" ? `${snapshot.sourceMetadata?.provider === "BALLDONTLIE" ? "BALLDONTLIE" : "NBA STATS"} SNAPSHOT` : "LIVE SNAPSHOT"}<span className="season-chip">{snapshot.season}</span></div></header>
        <main id="main">
          <section id="overview" className="overview">
            <div className="page-heading"><div><p className="eyebrow"><span /> THE NEXT GENERATION</p><h1>The rookie race<span className="lime">.</span></h1><p className="page-description">Fresh talent. Real impact. Follow the NBA Rookie of the Year conversation.</p></div><a className="outline-button" href="#methodology">How we rank <Arrow /></a></div>
            <div className="demo-notice"><span className="demo-badge">{snapshot.source === "demo" ? "DEMO" : "SNAPSHOT"}</span><p>{snapshot.source === "demo" ? "An illustrative 2024–25 snapshot. All stats and game logs are seeded examples, not live NBA data." : "An independent statistical snapshot. ROTY Score is not an official NBA metric."}</p></div>
            {snapshot.notice && <div className="demo-notice" role="status"><p>{snapshot.notice}</p></div>}
            {snapshot.sourceMetadata?.warnings.map((warning) => <div className="demo-notice" key={warning}><p>{warning}</p></div>)}
            <div className="summary-grid">
              <div className="summary-card"><span className="summary-label">CURRENT FRONTRUNNER <span aria-hidden="true">↗</span></span><div className="summary-primary">{leader?.name ?? "Race opens soon"}<span className="small-score">{leader ? `${formatStat(leader.score)} SCORE` : "—"}</span></div><p>{leader?.team ?? "Awaiting the first rookie snapshot"}</p></div>
              <div className="summary-card"><span className="summary-label">ROOKIES ON THE RADAR <span aria-hidden="true">◎</span></span><div className="summary-primary numeric">{ranked.length.toString().padStart(2, "0")}<span className="summary-unit">players</span></div><p>One class. Every contribution counts.</p></div>
              <div className="summary-card"><span className="summary-label">SNAPSHOT UPDATED <span aria-hidden="true">◷</span></span><div className="summary-primary"><time dateTime={snapshot.updatedAt}>{formatDate(snapshot.updatedAt)}</time></div><p>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(snapshot.updatedAt))} UTC <span className="muted-dot">·</span> {snapshot.source === "demo" ? "Seed dataset" : "Provider snapshot"}</p></div>
            </div>
          </section>

          <section aria-labelledby="contenders-heading" className="contenders-section">
            <div className="section-heading"><div><span className="section-line" /><h2 id="contenders-heading">Leading the conversation</h2><span className="section-subtitle">The top three, right now</span></div><span className="quiet-label">RANKED BY ROTY SCORE</span></div>
            <div className="contender-grid">
              {ranked.slice(0, 3).map((rookie) => {
                const recent = recentAverages(rookie.games);
                const difference = recent ? recent.points - rookie.stats.points : 0;
                return <button key={rookie.id} className={`contender-card contender-${rookie.rank}`} onClick={() => selectPlayer(rookie.id)} aria-label={`View ${rookie.name}, ranked ${rookie.rank}`} aria-controls="player-detail" style={{ "--team-color": rookie.color } as CSSProperties}>
                  <div className="contender-top"><span className={`contender-rank rank-${rookie.rank}`}>0{rookie.rank} <span>{rookie.rank === 1 ? "THE FRONTRUNNER" : "IN THE CHASE"}</span></span><Arrow /></div>
                  <span className="jersey-number" aria-hidden="true">{rookie.number === null ? "—" : String(rookie.number).padStart(2, "0")}</span>
                  <div className="contender-identity"><PlayerAvatar name={rookie.name} color={rookie.color} large /><div><p>{rookie.teamCode} <span>· {rookie.position}</span></p><h3>{rookie.name}</h3></div></div>
                  <div className="contender-stats"><div><strong>{formatStat(rookie.stats.points)}</strong><span>PPG</span></div><div><strong>{formatStat(rookie.stats.rebounds)}</strong><span>RPG</span></div><div><strong>{formatStat(rookie.stats.assists)}</strong><span>APG</span></div><div className="contender-score"><strong>{formatStat(rookie.score)}</strong><span>ROTY SCORE</span></div></div>
                  <div className="contender-footer"><span className={difference >= 0 ? "trend-up" : "trend-down"}>{difference >= 0 ? "↗ +" : "↘ "}{formatStat(difference)} PPG</span><span>last 10 vs season</span></div>
                </button>;
              })}
              {!ranked.length && <div className="panel empty-state">Contenders will appear once rookie data is available.</div>}
            </div>
          </section>

          <section id="leaderboard" aria-labelledby="leaderboard-heading">
            <div className="section-heading"><div><span className="section-line" /><h2 id="leaderboard-heading">The rookie leaderboard</h2><span className="count-badge">{ranked.length}</span></div><span className="quiet-label">EVERY STAT TELLS A STORY</span></div>
            <div className="dashboard-grid">
              <div className="leaderboard-column"><Leaderboard rookies={ranked} selectedId={selectedId} onSelect={selectPlayer} /><div className="stat-note"><span aria-hidden="true">ⓘ</span><p>Per-game season averages. Shooting percentages use a 0–100 scale. Rankings reflect our custom model, not official award voting.</p></div><div className="watch-note"><Basketball /><div><span className="eyebrow">BEYOND THE BOX SCORE</span><h3>Big moments. Small margins.</h3><p>Recent form adds context. The ROTY Score looks at the full season, balancing production, efficiency, and showing up.</p></div></div></div>
              <div id="player-detail" ref={detailRef} tabIndex={-1} className="detail-wrapper"><PlayerDetail rookie={selected} /></div>
            </div>
          </section>

          <section id="methodology" className="panel methodology" aria-labelledby="methodology-heading">
            <div className="methodology-intro"><p className="eyebrow">NO BLACK BOX</p><h2 id="methodology-heading">A score you can see through.</h2><p>ROTY Score is our custom, unofficial 0–100 index. Five dimensions. One weighted score. No predictions, no award odds.</p><span className="formula-chip">Σ (normalized dimension × weight)</span></div>
            <div className="weights">{(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((key) => <div className="weight-row" key={key}><div><span>{SCORE_DIMENSIONS[key].label}</span><strong>{Number(weights[key].toFixed(1))}%</strong></div><div className="weight-track"><span style={{ width: `${weights[key]}%` }} /></div><p>{SCORE_DIMENSIONS[key].description}</p></div>)}</div>
            <p className="methodology-footnote">Each ratio is capped at 0–1 before weighting; the final score is shown to one decimal. Availability uses {snapshot.scheduledGames} scheduled games{snapshot.source === "demo" ? " in this demo" : " for the full season, not team games played to date"}. Shooting percentages aren’t adjusted for attempt volume. This simple model is a conversation starter, not a measure of total player value.</p>
          </section>
          <footer className="footer"><a href="#" className="footer-brand"><Basketball /> ROOKIE RADAR</a><p>Built for the next generation of the game.</p><span>Not affiliated with the NBA.</span></footer>
        </main>
      </div>
    </div>
  );
}
