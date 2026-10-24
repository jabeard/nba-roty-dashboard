"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Rookie } from "@/lib/models";

export default function PointsChart({ rookie }: { rookie: Rookie }) {
  if (!rookie.games.length) return <p className="empty-state">Game logs aren’t available yet.</p>;
  const data = rookie.games.slice(-10).map((game) => ({
    ...game,
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(game.date)),
  }));
  return (
    <div className="points-chart" role="img" aria-label={`${rookie.name}, last ${data.length} games: ${data.map((game) => `${game.label}, ${game.points} points vs ${game.opponent}`).join("; ")}. Season average ${rookie.stats.points} points.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 220 }}>
        <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -28 }}>
          <defs>
            <linearGradient id="points-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcf46b" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#bcf46b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#293038" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="label" tick={{ fill: "#9da6b2", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} dy={8} />
          <YAxis tick={{ fill: "#9da6b2", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ background: "#1a2026", border: "1px solid #414b56", borderRadius: 10, color: "#f4f6f8", fontSize: 12 }} labelFormatter={(_, payload) => payload[0] ? `${payload[0].payload.label} · vs ${payload[0].payload.opponent}` : ""} formatter={(value) => [`${value} PTS`, "Points"]} />
          <ReferenceLine y={rookie.stats.points} stroke="#a5acb6" strokeDasharray="5 5" />
          <Area type="monotone" dataKey="points" stroke="#bcf46b" strokeWidth={2.5} fill="url(#points-fill)" isAnimationActive={false} activeDot={{ r: 5, stroke: "#101419", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
