import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import {
  apiDate, apiId, apiObject, hasAppearance, normalizeBallDontLieRookie, regularSeasonGame,
} from "../src/lib/balldontlie.ts";
import type { ApiRow } from "../src/lib/balldontlie.ts";
import type { RookieSnapshot } from "../src/lib/models.ts";
import { validateSeason } from "../src/lib/nba-stats.ts";
import { validateSnapshot } from "../src/lib/snapshot.ts";
import { SNAPSHOT_PATH } from "../src/lib/snapshot-provider.ts";

export type Request = (endpoint: "stats" | "teams", params: URLSearchParams) => Promise<unknown>;

export interface CollectionMetrics {
  requests: { teams: number; season: number; history: number };
  retries: number;
  eligibilityHits: number;
  cache: "disabled" | "miss" | "hit" | "full-refresh";
  timingsMs: { teams: number; season: number; history: number; total: number };
}

export function createCollectionMetrics(): CollectionMetrics {
  return {
    requests: { teams: 0, season: 0, history: 0 }, retries: 0, eligibilityHits: 0,
    cache: "disabled", timingsMs: { teams: 0, season: 0, history: 0, total: 0 },
  };
}

export interface CollectionOptions {
  cache?: string;
  fullRefresh?: boolean;
  refreshDays?: number;
  concurrency?: number;
  requestsPerMinute?: number;
  now?: () => number;
  diagnostic?: (message: string) => void;
  metrics?: CollectionMetrics;
}

function bounded(value: number, name: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function configuration(season: string, options: CollectionOptions) {
  validateSeason(season);
  const year = Number(season.slice(0, 4));
  if (year < 1946 || year > new Date().getUTCFullYear() + 1) {
    throw new Error("Season must be between 1946 and next year.");
  }
  return {
    year,
    refreshDays: bounded(options.refreshDays ?? 7, "refresh-days", 366),
    concurrency: bounded(options.concurrency ?? 4, "concurrency", 16),
    requestsPerMinute: bounded(options.requestsPerMinute ?? 60, "requests-per-minute", 600),
  };
}

export function createBallDontLieClient(
  key = process.env.BALLDONTLIE_API_KEY,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<unknown> = sleep,
  options: Pick<CollectionOptions, "requestsPerMinute" | "now" | "metrics"> = {},
): Request {
  const rpm = bounded(options.requestsPerMinute ?? 60, "requests-per-minute", 600);
  if (!key?.trim()) throw new Error("Set BALLDONTLIE_API_KEY to an NBA ALL-STAR (or higher) API key.");
  const now = options.now ?? Date.now;
  const spacing = 66_000 / rpm;
  let logicalTime = now();
  const clock = () => Math.max(now(), logicalTime);
  let nextStart = clock() + spacing;
  let cooldown = 0;
  let blocked: Error | undefined;
  let queue = Promise.resolve();
  const admit = () => {
    const admission = queue.then(async () => {
      if (blocked) throw blocked;
      // Recheck after sleeping: another in-flight request may have received a 429.
      while (clock() < Math.max(nextStart, cooldown)) {
        const deadline = Math.max(nextStart, cooldown);
        await wait(deadline - clock());
        logicalTime = Math.max(logicalTime, deadline);
        if (blocked) throw blocked;
      }
      nextStart = clock() + spacing;
    });
    queue = admission.catch(() => {});
    return admission;
  };
  return async (endpoint, params) => {
    const url = new URL(`https://api.balldontlie.io/nba/v1/${endpoint}`);
    url.search = params.toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      await admit();
      if (attempt > 0 && options.metrics) options.metrics.retries++;
      if (options.metrics) {
        options.metrics.requests[endpoint === "teams" ? "teams"
          : params.has("player_ids[]") ? "history" : "season"]++;
      }
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
        cooldown = Math.max(cooldown, clock() + 6_000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        try { return await response.json() as unknown; }
        catch { throw new Error(`${endpoint}: expected valid JSON.`); }
      }
      const transient = response.status === 429 || response.status >= 500;
      if (transient) {
        const header = response.headers.get("retry-after");
        const retryAfter = header === null ? 0 : /^\d+$/.test(header)
          ? Number(header) * 1_000 : Date.parse(header) - clock();
        if (retryAfter > 120_000) {
          blocked = new Error(`${endpoint}: long Retry-After; try again later.`);
        } else {
          cooldown = Math.max(cooldown, clock() +
            Math.max(6_000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0));
        }
      }
      // Publish the cooldown before awaiting body cancellation so queued starts cannot bypass it.
      try { await response.body?.cancel(); } catch { /* The status is sufficient to handle this response safely. */ }
      if (blocked) throw blocked;
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${endpoint}: HTTP ${response.status}; check BALLDONTLIE_API_KEY and NBA ALL-STAR subscription access.`);
      }
      if (!transient || attempt === 2) {
        throw new Error(`${endpoint}: HTTP ${response.status}; collection stopped.`);
      }
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

interface SeasonCache {
  version: 1;
  season: string;
  collectedAt: string;
  eligibility: Record<string, boolean>;
  rows: ApiRow[];
}

function rowKey(row: ApiRow): string {
  return `${apiId(apiObject(row.player).id)}:${apiId(apiObject(row.game).id)}`;
}

function validateCache(value: unknown, season: string, year: number, now: number,
  teams: Map<number, ApiRow>): SeasonCache {
  const cache = apiObject(value);
  if (cache.version !== 1 || cache.season !== season ||
      typeof cache.collectedAt !== "string" ||
      !Number.isFinite(Date.parse(cache.collectedAt)) ||
      new Date(cache.collectedAt).toISOString() !== cache.collectedAt ||
      Date.parse(cache.collectedAt) > now || !Array.isArray(cache.rows) || !cache.rows.length) {
    throw new Error("Invalid cache envelope.");
  }
  const eligibility = apiObject(cache.eligibility);
  for (const [id, rookie] of Object.entries(eligibility)) {
    if (String(apiId(Number(id))) !== id || typeof rookie !== "boolean") {
      throw new Error("Invalid cached eligibility.");
    }
  }
  const seen = new Set<string>();
  for (const value of cache.rows) {
    const row = apiObject(value);
    const game = regularSeasonGame(row, year);
    const key = rowKey(row);
    if (game.status !== "Final" || !hasAppearance(row) || seen.has(key) ||
        typeof eligibility[String(apiId(apiObject(row.player).id))] !== "boolean") {
      throw new Error("Invalid cached appearance.");
    }
    seen.add(key);
    normalizeBallDontLieRookie([row], teams);
  }
  return cache as unknown as SeasonCache;
}

async function readCache(path: string, season: string, year: number, now: number,
  teams: Map<number, ApiRow>, diagnostic: (message: string) => void) {
  try {
    return validateCache(JSON.parse(await readFile(path, "utf8")), season, year, now, teams);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Never include cache contents, paths, or parser errors in diagnostics.
      diagnostic("BALLDONTLIE cache invalid or unreadable; using a full season/history scan.");
    }
    return undefined;
  }
}

async function collect(
  season: string, suppliedRequest: Request | undefined, options: CollectionOptions,
): Promise<{ snapshot: RookieSnapshot; cache: SeasonCache }> {
  const { year, refreshDays, concurrency } = configuration(season, options);
  const now = options.now ?? Date.now;
  const metrics = options.metrics ?? createCollectionMetrics();
  const started = now();
  const request = suppliedRequest ?? createBallDontLieClient(undefined, undefined, undefined,
    { ...options, metrics });
  // The real client counts attempts; injected clients count request starts here.
  const counted: Request = suppliedRequest ? async (endpoint, params) => {
    metrics.requests[endpoint === "teams" ? "teams" : params.has("player_ids[]") ? "history" : "season"]++;
    return request(endpoint, params);
  } : request;
  let phase = now();
  let teamPayload: ApiRow;
  try {
    teamPayload = apiObject(await counted("teams", new URLSearchParams()));
  } finally {
    metrics.timingsMs.teams = now() - phase;
    metrics.timingsMs.total = now() - started;
  }
  if (!Array.isArray(teamPayload.data) || !teamPayload.data.length) throw new Error("teams: missing teams.");
  const teams = new Map(teamPayload.data.map((value) => {
    const team = apiObject(value);
    return [apiId(team.id), team] as const;
  }));
  metrics.timingsMs.teams = now() - phase;
  let cached: SeasonCache | undefined;
  metrics.cache = options.fullRefresh ? "full-refresh" : options.cache ? "miss" : "disabled";
  if (options.cache && !options.fullRefresh) {
    cached = await readCache(options.cache, season, year, now(), teams, options.diagnostic ?? console.warn);
    if (cached) metrics.cache = "hit";
  }
  const startDate = cached
    ? new Date(Date.parse(cached.collectedAt) - refreshDays * 86_400_000).toISOString().slice(0, 10)
    : undefined;
  const eligibility: Record<string, boolean> = { ...cached?.eligibility };
  const merged = new Map<string, ApiRow>();
  for (const row of cached?.rows ?? []) {
    if (apiDate(apiObject(row.game).date).slice(0, 10) < startDate!) merged.set(rowKey(row), row);
  }
  const players = new Map<number, ApiRow[]>();
  const params = new URLSearchParams({ "seasons[]": String(year), postseason: "false", per_page: "100" });
  if (startDate) params.set("start_date", startDate);
  const seen = new Set<string>();
  phase = now();
  try {
    for await (const page of statPages(counted, params)) {
      for (const row of page) {
        const game = regularSeasonGame(row, year);
        const key = rowKey(row);
        if (seen.has(key)) throw new Error("stats: duplicate player/game in season response.");
        seen.add(key);
        if (startDate && apiDate(game.date).slice(0, 10) < startDate) {
          throw new Error("stats: response outside requested refresh window.");
        }
        if (game.status !== "Final" || !hasAppearance(row)) continue;
        // Validate veterans too: incomplete rows must never poison a persistent cache.
        normalizeBallDontLieRookie([row], teams);
        merged.set(key, row);
      }
    }
  } finally {
    metrics.timingsMs.season = now() - phase;
    metrics.timingsMs.total = now() - started;
  }
  for (const row of merged.values()) {
    const id = apiId(apiObject(row.player).id);
    const rows = players.get(id) ?? [];
    rows.push(row);
    players.set(id, rows);
  }
  if (!players.size) throw new Error(`No completed regular-season appearances for ${season}; no snapshot replaced.`);
  phase = now();
  const ids = [...players.keys()];
  let next = 0;
  let historyFailed = false;
  let firstHistoryError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    try {
      while (!historyFailed && next < ids.length) {
        const id = ids[next++];
        if (typeof eligibility[id] === "boolean") {
          metrics.eligibilityHits++;
          continue;
        }
        const history = new URLSearchParams({ "player_ids[]": String(id), postseason: "false", per_page: "100" });
        for (let previous = 1946; previous < year; previous++) history.append("seasons[]", String(previous));
        let veteran = false;
        if (year > 1946) {
          for await (const page of statPages(counted, history)) {
            if (historyFailed) break;
            for (const row of page) {
              const game = apiObject(row.game);
              if (apiObject(row.player).id !== id || typeof game.season !== "number" ||
                  !Number.isSafeInteger(game.season) ||
                  game.season < 1946 || game.season >= year || game.postseason !== false) {
                throw new Error(`stats: invalid historical response for player ${id}.`);
              }
              if (hasAppearance(row)) { veteran = true; break; }
            }
            if (veteran) break;
          }
        }
        eligibility[id] = !veteran;
      }
    } catch (error) {
      if (!historyFailed) {
        historyFailed = true;
        firstHistoryError = error;
      }
    }
  });
  await Promise.all(workers);
  metrics.timingsMs.history = now() - phase;
  metrics.timingsMs.total = now() - started;
  if (historyFailed) throw firstHistoryError;
  const rookies = [...players].sort(([left], [right]) => left - right).filter(([id]) => eligibility[id])
    .map(([, rows]) => normalizeBallDontLieRookie(rows, teams));
  if (!rookies.length) throw new Error(`No first-season players found for ${season}; no snapshot replaced.`);
  const collectedAt = new Date(now()).toISOString();
  const snapshot = validateSnapshot({
    season, updatedAt: collectedAt, source: "snapshot", scheduledGames: 82, rookies,
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
  metrics.timingsMs.total = now() - started;
  return { snapshot, cache: { version: 1, season, collectedAt, eligibility, rows: [...merged.values()] } };
}

export async function collectBallDontLieSnapshot(
  season: string, request?: Request, options: CollectionOptions = {},
): Promise<RookieSnapshot> {
  return (await collect(season, request, options)).snapshot;
}

export async function saveBallDontLieSnapshot(
  season: string, output: string, request?: Request, options: CollectionOptions = {},
) {
  configuration(season, options);
  if (options.cache && resolve(output) === resolve(options.cache)) {
    throw new Error("Cache and snapshot paths must be different.");
  }
  const { snapshot, cache } = await collect(season, request, options);
  const files = [{ path: output, value: snapshot },
    ...(options.cache ? [{ path: options.cache, value: cache }] : [])];
  const staged: string[] = [];
  const token = randomUUID();
  const backup = `${output}.${token}.previous`;
  let previous: string | undefined;
  let published = false;
  try {
    if (options.cache) {
      try { previous = await readFile(output, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      const temporary = `${file.path}.${token}.tmp`;
      staged.push(temporary);
      await writeFile(temporary, `${JSON.stringify(file.value, null, 2)}\n`, { flag: "wx" });
    }
    if (previous !== undefined) await writeFile(backup, previous, { flag: "wx" });
    await rename(staged[0], output);
    published = true;
    if (options.cache) await rename(staged[1], options.cache);
  } catch (error) {
    // A failed cache publication must not leave a newer snapshot paired with old state.
    if (published && options.cache) {
      if (previous !== undefined) await rename(backup, output);
      else await rm(output, { force: true });
    }
    throw error;
  } finally {
    await Promise.all(staged.map((path) => rm(path, { force: true })));
    if (previous !== undefined) await rm(backup, { force: true });
  }
  return snapshot;
}

async function main() {
  const { values } = parseArgs({
    options: {
      season: { type: "string", default: "2026-27" }, output: { type: "string", default: SNAPSHOT_PATH },
      cache: { type: "string" }, "full-refresh": { type: "boolean", default: false },
      "refresh-days": { type: "string", default: "7" }, concurrency: { type: "string", default: "4" },
      "requests-per-minute": { type: "string", default: "60" },
    },
  });
  const metrics = createCollectionMetrics();
  const options: CollectionOptions = {
    cache: resolve(values.cache ?? `.cache/balldontlie/${values.season}.json`),
    fullRefresh: values["full-refresh"], refreshDays: Number(values["refresh-days"]),
    concurrency: Number(values.concurrency), requestsPerMinute: Number(values["requests-per-minute"]), metrics,
  };
  configuration(values.season!, options);
  console.log(`Collecting BALLDONTLIE regular-season stats for ${values.season}; history checks may take several minutes.`);
  const started = Date.now();
  try {
    const snapshot = await saveBallDontLieSnapshot(values.season!, resolve(values.output!), undefined, options);
    console.log(`Saved ${snapshot.rookies.length} first-season players at ${snapshot.updatedAt}.`);
  } finally {
    metrics.timingsMs.total = Date.now() - started;
    console.log(`Collection metrics: ${JSON.stringify(metrics)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Collection failed; no snapshot replaced. ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  });
}
