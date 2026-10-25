export interface OddsQuote {
  bookmaker: string;
  playerId: string;
  decimal: number;
  updatedAt: string;
}

export interface OddsSnapshot {
  season: string;
  collectedAt: string;
  provider: string;
  playerProvider: "NBA Stats" | "BALLDONTLIE";
  market: "nba_roty";
  quotes: OddsQuote[];
  completeBooks: string[];
}

export const DEFAULT_ODDS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const MAX_DECIMAL_ODDS = 1_000_000;

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => !keys.includes(key)) ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("Invalid odds object.");
  }
  return value as Record<string, unknown>;
}

function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      value.length > 120 || /[\u0000-\u001f\u007f]/.test(value) ||
      ["__proto__", "constructor", "prototype"].includes(value)) {
    throw new Error("Invalid odds label.");
  }
  return value;
}

export function validateOddsDate(value: unknown): string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error("Invalid odds timestamp; use UTC ISO dates.");
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error("Invalid odds timestamp.");
  }
  return value;
}

export function validateOddsSeason(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value) ||
      Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100 ||
      Number(value.slice(0, 4)) < 1946) {
    throw new Error("Invalid odds season; use consecutive YYYY-YY.");
  }
  return value;
}

export function validateOddsPlayerId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value) ||
      !Number.isSafeInteger(Number(value))) throw new Error("Invalid odds player ID.");
  return value;
}

export function validateOddsSnapshot(value: unknown): OddsSnapshot {
  const row = object(value, ["season", "collectedAt", "provider", "playerProvider", "market", "quotes", "completeBooks"]);
  const season = validateOddsSeason(row.season);
  const collectedAt = validateOddsDate(row.collectedAt);
  const provider = label(row.provider);
  if (row.playerProvider !== "NBA Stats" && row.playerProvider !== "BALLDONTLIE") {
    throw new Error("Invalid odds player provider.");
  }
  const playerProvider = row.playerProvider;
  if (row.market !== "nba_roty" || !Array.isArray(row.quotes) || row.quotes.length > 20_000 ||
      !Array.isArray(row.completeBooks) || row.completeBooks.length > 200) {
    throw new Error("Invalid NBA ROTY odds market.");
  }
  const seen = new Map<string, Set<string>>();
  const quotes = row.quotes.map((value): OddsQuote => {
    const quote = object(value, ["bookmaker", "playerId", "decimal", "updatedAt"]);
    const bookmaker = label(quote.bookmaker);
    const playerId = validateOddsPlayerId(quote.playerId);
    const updatedAt = validateOddsDate(quote.updatedAt);
    if (typeof quote.decimal !== "number" || !Number.isFinite(quote.decimal) ||
        quote.decimal <= 1 || quote.decimal > MAX_DECIMAL_ODDS ||
        Date.parse(updatedAt) > Date.parse(collectedAt)) {
      throw new Error("Invalid odds price or quote newer than collection.");
    }
    const players = seen.get(bookmaker) ?? new Set<string>();
    if (players.has(playerId)) throw new Error("Duplicate bookmaker/player odds.");
    players.add(playerId);
    seen.set(bookmaker, players);
    if (seen.size > 200) throw new Error("Too many odds bookmakers.");
    return { bookmaker, playerId, decimal: quote.decimal, updatedAt };
  });
  const completeBooks = row.completeBooks.map(label);
  if (new Set(completeBooks).size !== completeBooks.length ||
      completeBooks.some((book) => !seen.has(book))) {
    throw new Error("Invalid explicit complete bookmakers.");
  }
  return { season, collectedAt, provider, playerProvider, market: "nba_roty", quotes, completeBooks };
}

function validateProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Probability must be between zero and one.");
  }
}

export function fairOdds(probability: number): { decimal: number | null; american: number | null } {
  validateProbability(probability);
  if (probability === 0) return { decimal: null, american: null };
  const decimal = 1 / probability;
  const american = probability === 1 ? null : probability <= 0.5
    ? 100 * (1 - probability) / probability : -100 * probability / (1 - probability);
  return {
    decimal: Number.isFinite(decimal) ? decimal : null,
    american: american !== null && Number.isFinite(american) ? Math.round(american) : null,
  };
}

export function compareOdds(
  probability: number, playerId: string, odds: OddsSnapshot, poolIds: string[], now: number,
  maxAgeMs = DEFAULT_ODDS_MAX_AGE_MS,
): {
  bookmaker: string; decimal: number; updatedAt: string; stale: boolean; incomplete: boolean;
  impliedProbability: number; noVigProbability: number | null; expectedValue: number | null;
}[] {
  validateProbability(probability);
  validateOddsPlayerId(playerId);
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("Invalid odds freshness configuration.");
  }
  const snapshot = validateOddsSnapshot(odds);
  const pool = new Set(poolIds.map(validateOddsPlayerId));
  if (!pool.size || pool.size !== poolIds.length || !pool.has(playerId)) {
    throw new Error("Invalid comparison player pool.");
  }
  const fresh = (quote: OddsQuote) => {
    const timestamp = Date.parse(quote.updatedAt);
    return timestamp <= now && now - timestamp <= maxAgeMs &&
      Date.parse(snapshot.collectedAt) <= now;
  };
  const books = new Map<string, OddsQuote[]>();
  for (const quote of snapshot.quotes) {
    const rows = books.get(quote.bookmaker) ?? [];
    rows.push(quote);
    books.set(quote.bookmaker, rows);
  }
  return snapshot.quotes.filter((quote) => quote.playerId === playerId).map((quote) => {
    const rows = books.get(quote.bookmaker)!;
    const incomplete = !snapshot.completeBooks.includes(quote.bookmaker) ||
      rows.length !== pool.size || rows.some((row) => !pool.has(row.playerId));
    const stale = !fresh(quote);
    const impliedProbability = 1 / quote.decimal;
    return {
      bookmaker: quote.bookmaker, decimal: quote.decimal, updatedAt: quote.updatedAt,
      stale, incomplete, impliedProbability,
      noVigProbability: !incomplete && rows.every(fresh)
        ? impliedProbability / rows.reduce((sum, row) => sum + 1 / row.decimal, 0) : null,
      expectedValue: stale ? null : probability * quote.decimal - 1,
    };
  });
}
