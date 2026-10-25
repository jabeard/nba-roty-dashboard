import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { apiId, apiObject, hasAppearance, regularSeasonGame } from "../src/lib/balldontlie.ts";
import { rookieProvider } from "../src/lib/data.ts";
import { loadForecastDashboard } from "../src/lib/forecast-provider.ts";
import { validateSeason } from "../src/lib/nba-stats.ts";
import { createBallDontLieClient, statPages } from "./collect-balldontlie.ts";

export async function auditPlayerRecords(
  season: string,
  search = "Dybantsa",
  key = process.env.BALLDONTLIE_API_KEY,
  fetcher: typeof fetch = fetch,
) {
  validateSeason(season);
  if (!key?.trim()) return { status: "unverified", reason: "BALLDONTLIE_API_KEY is not configured; provider records were not queried.", players: [] };
  if (!search.trim() || search.length > 100) throw new Error("Player search must contain 1–100 characters.");
  const url = new URL("https://api.balldontlie.io/nba/v1/players");
  url.search = new URLSearchParams({ search, per_page: "100" }).toString();
  let payload;
  try {
    const response = await fetcher(url, {
      headers: { Authorization: key.trim(), Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Provider search unavailable.");
    }
    payload = apiObject(await response.json());
  } catch {
    throw new Error("BALLDONTLIE player search failed; check credentials, subscription, and network. No provider record was verified.");
  }
  if (!Array.isArray(payload.data) || payload.data.length > 10 ||
      (apiObject(payload.meta).next_cursor !== undefined && apiObject(payload.meta).next_cursor !== null)) {
    throw new Error("Player search is invalid or ambiguous; use a more specific name.");
  }
  const request = createBallDontLieClient(key, fetcher);
  const year = Number(season.slice(0, 4));
  const players = [];
  for (const value of payload.data) {
    const player = apiObject(value);
    const id = apiId(player.id);
    if (typeof player.first_name !== "string" || typeof player.last_name !== "string") {
      throw new Error("Provider returned an invalid player identity.");
    }
    let completedAppearances = 0;
    const current = new URLSearchParams({ "player_ids[]": String(id), "seasons[]": String(year), postseason: "false", per_page: "100" });
    for await (const page of statPages(request, current)) {
      for (const row of page) {
        if (apiObject(row.player).id !== id) throw new Error("Provider player mismatch.");
        const game = regularSeasonGame(row, year);
        if (game.status === "Final" && hasAppearance(row)) completedAppearances++;
      }
    }
    let priorAppearance = false;
    if (year > 1946) {
      const history = new URLSearchParams({ "player_ids[]": String(id), postseason: "false", per_page: "100" });
      for (let previous = 1946; previous < year; previous++) history.append("seasons[]", String(previous));
      for await (const page of statPages(request, history)) {
        for (const row of page) {
          const game = apiObject(row.game);
          if (apiObject(row.player).id !== id || typeof game.season !== "number" ||
              !Number.isInteger(game.season) || game.season < 1946 || game.season >= year || game.postseason !== false) {
            throw new Error("Provider returned invalid history.");
          }
          if (hasAppearance(row)) { priorAppearance = true; break; }
        }
        if (priorAppearance) break;
      }
    }
    players.push({
      id: String(id), name: `${player.first_name} ${player.last_name}`, completedAppearances,
      priorAppearance,
      eligibility: "Not officially verified by this audit; absence of provider history is not an NBA eligibility ruling.",
    });
  }
  return {
    status: players.length ? "provider-records-checked" : "no-provider-match",
    reason: players.length ? "Provider records queried successfully; independently review official award eligibility." : "No matching player record was returned. This does not prove ineligibility.",
    players,
  };
}

async function deployedCoverage() {
  try {
    const response = await fetch("https://nba-roty-dashboard.vercel.app/api/coverage", {
      redirect: "error", signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "unverified", reason: "Deployment did not return the coverage endpoint; it may not include this release." };
    }
    const payload = apiObject(await response.json());
    const coverage = apiObject(payload.coverage);
    validateSeason(String(coverage.season));
    if (typeof coverage.updatedAt !== "string" || !Number.isFinite(Date.parse(coverage.updatedAt)) ||
        !["demo", "snapshot", "live"].includes(String(coverage.source))) throw new Error("Invalid deployment report.");
    return {
      status: "checked", url: "https://nba-roty-dashboard.vercel.app",
      season: coverage.season, source: coverage.source, provider: coverage.provider,
      updatedAt: coverage.updatedAt, dybantsa: coverage.dybantsa,
    };
  } catch {
    return { status: "unverified", reason: "Deployment is unreachable or returned invalid coverage data; no deployed season or timestamp was verified." };
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    season: { type: "string", default: "2026-27" },
    player: { type: "string", default: "Dybantsa" },
    "skip-deployed": { type: "boolean", default: false },
  } });
  validateSeason(values.season!);
  const [local, deployed, provider] = await Promise.all([
    loadForecastDashboard(await rookieProvider.getSnapshot()),
    values["skip-deployed"] ? Promise.resolve({ status: "not-requested" }) : deployedCoverage(),
    auditPlayerRecords(values.season!, values.player),
  ]);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), requestedSeason: values.season,
    local: local.coverage, notices: local.notices, deployed, provider,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Coverage audit failed. No eligibility or provider completeness has been verified; check configuration and retry.");
    process.exitCode = 1;
  });
}
