import { rookieProvider } from "../../../lib/data";
import { loadForecastDashboard } from "../../../lib/forecast-provider";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const data = await loadForecastDashboard(await rookieProvider.getSnapshot());
  return Response.json({
    checkedAt: data.asOf,
    coverage: data.coverage,
    forecastStatus: data.forecast?.status ?? "unavailable",
    notices: data.notices,
  }, { headers: { "Cache-Control": "no-store" } });
}
