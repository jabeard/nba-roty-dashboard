import { Dashboard } from "@/components/dashboard";
import { rookieProvider } from "@/lib/data";
import { loadForecastDashboard } from "@/lib/forecast-provider";
import { ForecastPanel } from "@/components/forecast-panel";
import type { RookieSnapshot } from "@/lib/models";
import { Suspense } from "react";
import { connection } from "next/server";

async function ForecastInsights({ snapshot }: { snapshot: RookieSnapshot }) {
  await connection();
  const forecastData = await loadForecastDashboard(snapshot);
  return <ForecastPanel data={forecastData} />;
}

export default async function Home() {
  const snapshot = await rookieProvider.getSnapshot();
  return <Dashboard snapshot={snapshot} insights={
    <Suspense fallback={<section id="forecasts" className="panel forecast-panel"><p>Checking forecast coverage and price freshness…</p></section>}>
      <ForecastInsights snapshot={snapshot} />
    </Suspense>
  } />;
}
