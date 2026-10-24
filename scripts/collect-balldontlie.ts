import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import {
  apiId, apiObject, hasAppearance, normalizeBallDontLieRookie, regularSeasonGame,
} from "../src/lib/balldontlie.ts";
import type { ApiRow } from "../src/lib/balldontlie.ts";
import type { RookieSnapshot } from "../src/lib/models.ts";
import { validateSeason } from "../src/lib/nba-stats.ts";
import { validateSnapshot } from "../src/lib/snapshot.ts";
import { SNAPSHOT_PATH } from "../src/lib/snapshot-provider.ts";

type Request = (endpoint: "stats" | "teams", params: URLSearchParams) => Promise<unknown>;

export function createBallDontLieClient(
  key = process.env.BALLDONTLIE_API_KEY,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<unknown> = sleep,
): Request {
  if (!key?.trim()) throw new Error("Set BALLDONTLIE_API_KEY to an NBA ALL-STAR (or higher) API key.");
  return async (endpoint, params) => {
    const url = new URL(`https://api.balldontlie.io/nba/v1/${endpoint}`);
    url.search = params.toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(1_100);
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Authorization: key.trim(), Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
          redirect: "error",
        });
      } catch {
        // Do not log transport errors: they can include request headers and credentials.
        if (attempt === 2) throw new Error(`${endpoint}: network/timeout failure after 3 attempts.`);
        await wait(6_000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        try { return await response.json() as unknown; }
        catch { throw new Error(`${endpoint}: expected valid JSON.`); }
      }
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${endpoint}: HTTP ${response.status}; check BALLDONTLIE_API_KEY and NBA ALL-STAR subscription access.`);
      }
      if ((response.status !== 429 && response.status < 500) || attempt === 2) {
        throw new Error(`${endpoint}: HTTP ${response.status}; collection stopped.`);
      }
      const header = response.headers.get("retry-after");
      const retryAfter = header === null ? 0 : /^\d+$/.test(header)
        ? Number(header) * 1_000 : Date.parse(header) - Date.now();
      if (retryAfter > 120_000) throw new Error(`${endpoint}: long Retry-After; try again later.`);
      await wait(Math.max(6_000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0));
    }
    throw new Error(`${endpoint}: retries exhausted.`);
  };
}

export async function* statPages(request: Request, params: URLSearchParams) {
  const query = new URLSearchParams(params);
  const seen = new Set<number>();
  for (let page = 0; page < 10_000; page++) {
    const payload = apiObject(await request("stats", query));
    if (!Array.isArray(payload.data)) throw new Error("stats: missing data array.");
    const meta = apiObject(payload.meta);
    const next = meta.next_cursor;
    if (next !== undefined && next !== null &&
        (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0 || seen.has(next))) {
      throw new Error("stats: invalid or repeated pagination cursor.");
    }
    yield payload.data.map(apiObject);
    if (next === undefined || next === null) return;
    if (!payload.data.length) throw new Error("stats: empty page with a next cursor.");
    seen.add(next as number);
    query.set("cursor", String(next));
  }
  throw new Error("stats: pagination limit exceeded.");
}

export async function collectBallDontLieSnapshot(
  season: string,
  request: Request = createBallDontLieClient(),
): Promise<RookieSnapshot> {
  validateSeason(season);
  const year = Number(season.slice(0, 4));
  if (year < 1946 || year > new Date().getUTCFullYear() + 1) {
    throw new Error("Season must be between 1946 and next year.");
  }
  const teamPayload = apiObject(await request("teams", new URLSearchParams()));
  if (!Array.isArray(teamPayload.data) || !teamPayload.data.length) throw new Error("teams: missing teams.");
  const teams = new Map(teamPayload.data.map((value) => {
    const team = apiObject(value);
    return [apiId(team.id), team] as const;
  }));
  const players = new Map<number, ApiRow[]>();
  const params = new URLSearchParams({ "seasons[]": String(year), postseason: "false", per_page: "100" });
  for await (const page of statPages(request, params)) {
    for (const row of page) {
      const game = regularSeasonGame(row, year);
      if (game.status !== "Final" || !hasAppearance(row)) continue;
      const id = apiId(apiObject(row.player).id);
      const rows = players.get(id) ?? [];
      rows.push(row);
      players.set(id, rows);
    }
  }
  if (!players.size) throw new Error(`No completed regular-season appearances for ${season}; no snapshot replaced.`);
  const rookies = [];
  for (const [id, rows] of players) {
    const history = new URLSearchParams({ "player_ids[]": String(id), postseason: "false", per_page: "1" });
    for (let previous = 1946; previous < year; previous++) history.append("seasons[]", String(previous));
    let veteran = false;
    if (year > 1946) {
      for await (const page of statPages(request, history)) {
        for (const row of page) {
          const game = apiObject(row.game);
          if (apiObject(row.player).id !== id || typeof game.season !== "number" ||
              game.season < 1946 || game.season >= year || game.postseason !== false) {
            throw new Error(`stats: invalid historical response for player ${id}.`);
          }
          if (hasAppearance(row)) { veteran = true; break; }
        }
        if (veteran) break;
      }
    }
    if (!veteran) rookies.push(normalizeBallDontLieRookie(rows, teams));
  }
  if (!rookies.length) throw new Error(`No first-season players found for ${season}; no snapshot replaced.`);
  return validateSnapshot({
    season, updatedAt: new Date().toISOString(), source: "snapshot", scheduledGames: 82, rookies,
    sourceMetadata: {
      provider: "BALLDONTLIE", seasonType: "Regular Season",
      endpoints: ["/nba/v1/teams", "/nba/v1/stats"],
      warnings: [
        "BALLDONTLIE snapshot, not a live feed. Confirm your plan permits public redistribution.",
        "Rookies are players with no prior regular-season appearances in BALLDONTLIE history, not an official NBA eligibility list. Historical gaps can misclassify players.",
        "Only completed regular-season games are included. Team is the latest appearance; age is unavailable.",
        "Availability uses the full 82-game season, not team games played to date.",
      ],
    },
  });
}

export async function saveBallDontLieSnapshot(
  season: string, output: string, request: Request = createBallDontLieClient(),
) {
  const snapshot = await collectBallDontLieSnapshot(season, request);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return snapshot;
}

async function main() {
  const { values } = parseArgs({
    options: { season: { type: "string", default: "2026-27" }, output: { type: "string", default: SNAPSHOT_PATH } },
  });
  console.log(`Collecting BALLDONTLIE regular-season stats for ${values.season}; history checks may take several minutes.`);
  const snapshot = await saveBallDontLieSnapshot(values.season!, resolve(values.output!));
  console.log(`Saved ${snapshot.rookies.length} first-season players at ${snapshot.updatedAt}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Collection failed; no snapshot replaced. ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  });
}
