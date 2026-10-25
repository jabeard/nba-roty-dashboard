import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  validateOddsDate, validateOddsPlayerId, validateOddsSeason, validateOddsSnapshot,
} from "../src/lib/odds.ts";
import type { OddsQuote, OddsSnapshot } from "../src/lib/odds.ts";

const MAX_BYTES = 2_000_000;
export interface OddsAlias { playerId: string; name: string; aliases: string[] }
export interface OddsAliases {
  playerProvider: OddsSnapshot["playerProvider"];
  players: OddsAlias[];
}
export interface LicensedOddsOptions {
  season: string;
  aliases?: unknown;
  input?: unknown;
  apiKey?: string;
  redistributionApproved?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error("Invalid licensed odds response.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid licensed odds text.");
  return value.trim();
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid licensed odds list.");
  return value;
}

function aliasMap(value: unknown) {
  const envelope = row(value);
  if (Object.keys(envelope).some((key) => !["playerProvider", "players"].includes(key)) ||
      (envelope.playerProvider !== "NBA Stats" && envelope.playerProvider !== "BALLDONTLIE")) {
    throw new Error("Reviewed aliases require an NBA Stats or BALLDONTLIE player provider.");
  }
  const playerProvider = envelope.playerProvider;
  const map = new Map<string, string>();
  const ids = new Set<string>();
  for (const item of array(envelope.players, 1_000)) {
    const alias = row(item);
    if (Object.keys(alias).some((key) => !["playerId", "name", "aliases"].includes(key))) {
      throw new Error("Invalid reviewed aliases.");
    }
    const id = validateOddsPlayerId(alias.playerId);
    if (ids.has(id)) throw new Error("Duplicate alias player ID.");
    ids.add(id);
    for (const name of [text(alias.name), ...array(alias.aliases, 30).map(text)]) {
      const normalized = name.toLocaleLowerCase("en-US");
      if (map.has(normalized) && map.get(normalized) !== id) {
        throw new Error("Ambiguous reviewed player alias.");
      }
      map.set(normalized, id);
    }
  }
  if (!map.size) throw new Error("Supply reviewed player aliases.");
  return { map, playerProvider };
}

function isNbaRoty(value: string): boolean {
  return /\b(?:nba|national basketball association)\b/i.test(value) &&
    /\brookie\s+of\s+the\s+year\b/i.test(value) &&
    !/\b(?:wnba|women|championship|finals|conference|division|most valuable)\b/i.test(value);
}

async function getJson(path: string, params: URLSearchParams, key: string, fetcher: typeof fetch) {
  // Only internally constructed paths on this fixed origin are ever requested.
  const url = new URL(`https://api.the-odds-api.com/v4/${path}`);
  url.search = params.toString();
  url.searchParams.set("apiKey", key);
  try {
    const response = await fetcher(url, {
      redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" },
    });
    if (!response.ok || response.redirected || !response.body) {
      await response.body?.cancel();
      throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) throw new Error();
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    // Never expose transport errors, response bodies, URLs, or query credentials.
    throw new Error("Licensed odds request failed (network, access, timeout, or invalid response).");
  }
}

export async function collectLicensedOdds(options: LicensedOddsOptions): Promise<OddsSnapshot> {
  if (typeof window !== "undefined") throw new Error("Licensed odds collection is server-only.");
  if (!(options.redistributionApproved ?? (process.env.ODDS_REDISTRIBUTION_APPROVED === "true"))) {
    throw new Error("Confirm redistribution permission with ODDS_REDISTRIBUTION_APPROVED=true.");
  }
  const season = validateOddsSeason(options.season);
  const now = (options.now ?? Date.now)();
  if (!Number.isFinite(now)) throw new Error("Invalid odds collection clock.");
  if (options.input !== undefined) {
    const snapshot = validateOddsSnapshot(options.input);
    if (snapshot.season !== season || Date.parse(snapshot.collectedAt) > now) {
      throw new Error("Imported odds season or collection time does not match.");
    }
    return snapshot;
  }
  const aliases = aliasMap(options.aliases);
  const key = options.apiKey ?? process.env.ODDS_API_KEY;
  if (!key?.trim()) throw new Error("Set server-only ODDS_API_KEY.");
  const fetcher = options.fetcher ?? fetch;
  const sports = array(await getJson("sports/", new URLSearchParams({ all: "true" }), key, fetcher), 2_000);
  const candidates = sports.map(row).filter((sport) =>
    typeof sport.title === "string" && typeof sport.description === "string" &&
    isNbaRoty(`${sport.title} ${sport.description}`) && sport.has_outrights === true);
  if (candidates.length !== 1) {
    throw new Error("NBA Rookie of the Year is not uniquely listed by the provider. Use a licensed normalized --input; no championship fallback.");
  }
  const sport = candidates[0];
  if (typeof sport.key !== "string" || !/^[a-z0-9_]{1,100}$/.test(sport.key)) {
    throw new Error("Invalid discovered NBA ROTY sport key.");
  }
  const events = array(await getJson(`sports/${sport.key}/odds/`, new URLSearchParams({
    regions: "us", markets: "outrights", oddsFormat: "decimal",
  }), key, fetcher), 100);
  if (events.length !== 1) throw new Error("Expected exactly one NBA ROTY event; collection stopped.");
  const event = row(events[0]);
  const eventTime = Date.parse(validateOddsDate(event.commence_time));
  const year = Number(season.slice(0, 4));
  if (event.sport_key !== sport.key || !isNbaRoty(text(event.sport_title)) ||
      eventTime < Date.UTC(year, 6, 1) || eventTime >= Date.UTC(year + 1, 9, 1)) {
    throw new Error("NBA ROTY event identity or season does not match.");
  }
  const quotes: OddsQuote[] = [];
  const bookKeys = new Set<string>();
  for (const value of array(event.bookmakers, 200)) {
    const book = row(value);
    const bookKey = text(book.key);
    if (bookKeys.has(bookKey)) throw new Error("Duplicate provider bookmaker.");
    bookKeys.add(bookKey);
    const bookmaker = text(book.title);
    const markets = array(book.markets, 20).map(row);
    if (markets.length !== 1 || markets[0].key !== "outrights") {
      throw new Error("Unexpected or ambiguous NBA ROTY market.");
    }
    const market = markets[0];
    const updatedAt = validateOddsDate(market.last_update ?? book.last_update);
    const outcomes = array(market.outcomes, 1_000);
    if (!outcomes.length) throw new Error("Empty NBA ROTY outcomes.");
    for (const value of outcomes) {
      const outcome = row(value);
      const playerId = aliases.map.get(text(outcome.name).toLocaleLowerCase("en-US"));
      if (!playerId) throw new Error("Unresolved NBA ROTY outcome; update reviewed aliases. No snapshot replaced.");
      quotes.push({ bookmaker, playerId, decimal: outcome.price as number, updatedAt });
    }
  }
  if (!quotes.length) throw new Error("No licensed NBA ROTY odds available.");
  // The documented API has no explicit full-field completeness guarantee.
  return validateOddsSnapshot({
    season, collectedAt: new Date(now).toISOString(), provider: "The Odds API",
    playerProvider: aliases.playerProvider,
    market: "nba_roty", quotes, completeBooks: [],
  });
}

async function readJson(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > MAX_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > MAX_BYTES) throw new Error();
    return JSON.parse(buffer.subarray(0, size).toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid or oversized licensed odds input file.");
  } finally {
    await handle.close();
  }
}

export async function saveLicensedOdds(options: LicensedOddsOptions, output: string) {
  const snapshot = await collectLicensedOdds(options);
  await mkdir(dirname(output), { recursive: true });
  const staged = `${output}.${randomUUID()}.stage`;
  try {
    const handle = await open(staged, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(staged, output);
  } finally {
    await rm(staged, { force: true });
  }
  return snapshot;
}

async function main() {
  const { values } = parseArgs({ options: {
    season: { type: "string" }, aliases: { type: "string" }, input: { type: "string" },
    output: { type: "string", default: "data/odds-snapshot.json" },
  } });
  if (!values.season || Boolean(values.input) === Boolean(values.aliases)) {
    throw new Error("Supply --season YYYY-YY and exactly one of --input or --aliases.");
  }
  const snapshot = await saveLicensedOdds({
    season: values.season,
    ...(values.input ? { input: await readJson(resolve(values.input)) }
      : { aliases: await readJson(resolve(values.aliases!)) }),
  }, resolve(values.output!));
  console.log(`Saved ${snapshot.quotes.length} licensed NBA ROTY quotes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Licensed odds collection failed; no snapshot replaced. Check permission, configuration, input, and provider ROTY availability.");
    process.exitCode = 1;
  });
}
