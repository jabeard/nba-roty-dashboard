import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  compareOdds, DEFAULT_ODDS_MAX_AGE_MS, fairOdds, validateOddsSnapshot,
} from "./odds.ts";
import type { OddsSnapshot } from "./odds.ts";
import { collectLicensedOdds, saveLicensedOdds } from "../../scripts/collect-odds.ts";

const timestamp = "2026-10-24T12:00:00.000Z";
const now = Date.parse(timestamp);
function snapshot(): OddsSnapshot {
  return {
    season: "2026-27", collectedAt: timestamp, provider: "Licensed test fixture",
    playerProvider: "BALLDONTLIE",
    market: "nba_roty", completeBooks: ["DraftKings"],
    quotes: [
      { bookmaker: "DraftKings", playerId: "1", decimal: 2, updatedAt: timestamp },
      { bookmaker: "DraftKings", playerId: "2", decimal: 2, updatedAt: timestamp },
    ],
  };
}

test("fair decimal/American prices include safe zero and one boundaries", () => {
  assert.deepEqual(fairOdds(0), { decimal: null, american: null });
  assert.deepEqual(fairOdds(1), { decimal: 1, american: null });
  assert.deepEqual(fairOdds(0.5), { decimal: 2, american: 100 });
  assert.deepEqual(fairOdds(0.25), { decimal: 4, american: 300 });
  assert.deepEqual(fairOdds(0.8), { decimal: 1.25, american: -400 });
  assert.deepEqual(fairOdds(Number.MIN_VALUE), { decimal: null, american: null });
  for (const p of [-1, 2, NaN, Infinity]) assert.throws(() => fairOdds(p));
});

test("strict normalized imports reject invalid IDs, seasons, dates, prices and prototypes", () => {
  assert.deepEqual(validateOddsSnapshot(snapshot()), snapshot());
  const { playerProvider: omittedProvider, ...missingProvider } = snapshot();
  assert.equal(omittedProvider, "BALLDONTLIE");
  assert.throws(() => validateOddsSnapshot(missingProvider), /Invalid odds object/);
  assert.throws(() => validateOddsSnapshot({ ...snapshot(), playerProvider: "unknown" }), /player provider/);
  assert.equal(validateOddsSnapshot({ ...snapshot(), playerProvider: "NBA Stats" }).playerProvider, "NBA Stats");
  for (const season of ["2026-28", "26-27", "2026-27x"]) {
    assert.throws(() => validateOddsSnapshot({ ...snapshot(), season }));
  }
  for (const collectedAt of ["2026-02-30T12:00:00Z", "2026-10-24", "nonsense"]) {
    assert.throws(() => validateOddsSnapshot({ ...snapshot(), collectedAt }));
  }
  for (const playerId of ["0", "01", "-1", "__proto__", "9007199254740992"]) {
    const value = snapshot();
    value.quotes[0].playerId = playerId;
    assert.throws(() => validateOddsSnapshot(value));
  }
  for (const decimal of [1, 0, -1, NaN, Infinity, 1_000_001]) {
    const value = snapshot();
    value.quotes[0].decimal = decimal;
    assert.throws(() => validateOddsSnapshot(value));
  }
  const value = snapshot();
  value.quotes.push(value.quotes[0]);
  assert.throws(() => validateOddsSnapshot(value), /Duplicate/);
  assert.throws(() => validateOddsSnapshot(Object.assign(Object.create({ injected: true }), snapshot())));
  assert.throws(() => validateOddsSnapshot(JSON.parse(
    JSON.stringify(snapshot()).replace('"season":', '"__proto__":{},"season":'),
  )));
  assert.throws(() => validateOddsSnapshot({ ...snapshot(), completeBooks: ["Unknown"] }));
  assert.throws(() => validateOddsSnapshot({ ...snapshot(), completeBooks: ["DraftKings", "DraftKings"] }));
  const future = snapshot();
  future.quotes[0].updatedAt = "2026-10-24T12:00:01Z";
  assert.throws(() => validateOddsSnapshot(future), /newer than collection/);
});

test("overround normalization requires exact explicitly complete full pool", () => {
  const value = snapshot();
  value.quotes[0].decimal = 1.5;
  const [result] = compareOdds(0.8, "1", value, ["1", "2"], now);
  assert.equal(result.impliedProbability, 2 / 3);
  assert.ok(Math.abs(result.noVigProbability! - 4 / 7) < 1e-12);
  assert.ok(Math.abs(result.expectedValue! - 0.2) < 1e-12);
  assert.equal(result.incomplete, false);
  for (const pool of [["1"], ["1", "2", "3"]]) {
    const [result] = compareOdds(0.8, "1", value, pool, now);
    assert.equal(result.incomplete, true);
    assert.equal(result.noVigProbability, null);
  }
  value.completeBooks = [];
  assert.equal(compareOdds(0.8, "1", value, ["1", "2"], now)[0].noVigProbability, null);
  assert.throws(() => compareOdds(0.8, "1", value, ["1", "1"], now));
});

test("stale and future quotes suppress EV; any stale peer prevents no-vig", () => {
  const value = snapshot();
  assert.equal(compareOdds(0.6, "1", value, ["1", "2"], now + DEFAULT_ODDS_MAX_AGE_MS)[0].stale, false);
  const [stale] = compareOdds(0.6, "1", value, ["1", "2"], now + DEFAULT_ODDS_MAX_AGE_MS + 1);
  assert.equal(stale.stale, true);
  assert.equal(stale.expectedValue, null);
  assert.equal(stale.noVigProbability, null);
  assert.equal(compareOdds(0.6, "1", value, ["1", "2"], now + 1_000, 500)[0].stale, true);
  assert.equal(compareOdds(0.6, "1", value, ["1", "2"], now - 1)[0].expectedValue, null);
  value.quotes[1].updatedAt = "2026-10-22T12:00:00Z";
  const [fresh] = compareOdds(0.6, "1", value, ["1", "2"], now);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.noVigProbability, null);
  assert.notEqual(fresh.expectedValue, null);
});

const aliases = {
  playerProvider: "BALLDONTLIE",
  players: [{ playerId: "1", name: "First Rookie", aliases: ["F. Rookie"] },
    { playerId: "2", name: "Second Rookie", aliases: [] }],
};
const sport = {
  key: "basketball_nba_rookie_of_the_year", title: "NBA Rookie of the Year",
  description: "NBA Rookie of the Year award", has_outrights: true,
};
function event() {
  return {
    id: "fixture", sport_key: sport.key, sport_title: sport.title,
    commence_time: "2027-06-01T00:00:00Z",
    bookmakers: ["DraftKings", "FanDuel"].map((title) => ({
      key: title.toLowerCase(), title, last_update: timestamp,
      markets: [{ key: "outrights", outcomes: [
        { name: "F. Rookie", price: 2.5 }, { name: "Second Rookie", price: 1.8 },
      ] }],
    })),
  };
}
function fetchFixture(payloads: unknown[], inspect?: (url: URL, init?: RequestInit) => void): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    inspect?.(new URL(String(input)), init);
    return new Response(JSON.stringify(payloads.shift()), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
const options = { season: "2026-27", redistributionApproved: true, aliases, apiKey: "fixture-secret", now: () => now };

test("collector gates licensing, supports offline imports, validates season and future time", async () => {
  await assert.rejects(collectLicensedOdds({ ...options, redistributionApproved: false }), /permission/);
  assert.deepEqual(await collectLicensedOdds({ ...options, input: snapshot() }), snapshot());
  await assert.rejects(collectLicensedOdds({ ...options, season: "2025-26", input: snapshot() }), /does not match/);
  await assert.rejects(collectLicensedOdds({ ...options, now: () => now - 1, input: snapshot() }), /does not match/);
  await assert.rejects(collectLicensedOdds({ ...options, input: { ...snapshot(), market: "championship" } }));
});

test("discovery must explicitly list NBA ROTY; championship is never substituted", async () => {
  let requests = 0;
  const fetcher = fetchFixture([[
    { ...sport, key: "basketball_nba_championship_winner", title: "NBA Championship Winner",
      description: "NBA Championship Winner" },
  ]], () => { requests++; });
  await assert.rejects(collectLicensedOdds({ ...options, fetcher }), /not uniquely listed/);
  assert.equal(requests, 1);
});

test("fixed-origin discovery and reviewed aliases preserve sportsbook labels without claiming completeness", async () => {
  const urls: URL[] = [];
  const fetcher = fetchFixture([[sport], [event()]], (url, init) => {
    urls.push(url);
    assert.equal(url.origin, "https://api.the-odds-api.com");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal(url.searchParams.get("apiKey"), "fixture-secret");
  });
  const result = await collectLicensedOdds({ ...options, fetcher });
  assert.equal(urls[0].pathname, "/v4/sports/");
  assert.equal(urls[0].searchParams.get("all"), "true");
  assert.equal(urls[1].pathname, `/v4/sports/${sport.key}/odds/`);
  assert.equal(urls[1].searchParams.get("markets"), "outrights");
  assert.deepEqual(result.completeBooks, []);
  assert.equal(result.playerProvider, "BALLDONTLIE");
  assert.equal(result.quotes.length, 4);
  assert.deepEqual([...new Set(result.quotes.map((quote) => quote.bookmaker))], ["DraftKings", "FanDuel"]);
  assert.deepEqual(result.quotes.map((quote) => quote.playerId), ["1", "2", "1", "2"]);
});

test("collector refuses ambiguous events, wrong sport/season, markets and unresolved aliases", async () => {
  const wrongSport = { ...event(), sport_key: "basketball_nba" };
  const wrongYear = { ...event(), commence_time: "2028-06-01T00:00:00Z" };
  const unknown = event();
  unknown.bookmakers[0].markets[0].outcomes[0].name = "Unreviewed Name";
  const wrongMarket = event();
  wrongMarket.bookmakers[0].markets[0].key = "h2h";
  for (const events of [[event(), event()], [wrongSport], [wrongYear], [unknown], [wrongMarket]]) {
    await assert.rejects(collectLicensedOdds({ ...options, fetcher: fetchFixture([[sport], events]) }));
  }
  await assert.rejects(collectLicensedOdds({
    ...options, aliases: { ...aliases, players: [
      ...aliases.players, { playerId: "3", name: "F. Rookie", aliases: [] },
    ] },
  }), /Ambiguous/);
  await assert.rejects(collectLicensedOdds({
    ...options, fetcher: fetchFixture([[{ ...sport, key: "../../evil?apiKey=stolen" }]]),
  }), /sport key/);
});

test("reviewed alias envelopes preserve player namespaces and reject unscoped aliases", async () => {
  for (const playerProvider of ["NBA Stats", "BALLDONTLIE"]) {
    const result = await collectLicensedOdds({
      ...options, aliases: { ...aliases, playerProvider }, fetcher: fetchFixture([[sport], [event()]]),
    });
    assert.equal(result.playerProvider, playerProvider);
  }
  for (const unscoped of [aliases.players, { players: aliases.players },
    { ...aliases, playerProvider: "unknown" }]) {
    await assert.rejects(collectLicensedOdds({ ...options, aliases: unscoped }));
  }
  const { playerProvider: omittedProvider, ...unscopedImport } = snapshot();
  assert.equal(omittedProvider, "BALLDONTLIE");
  await assert.rejects(collectLicensedOdds({ ...options, input: unscopedImport }));
});

test("request failures redact transport credentials and response bodies and bound payloads", async () => {
  for (const fetcher of [
    (async () => { throw new Error("https://example.test/?apiKey=fixture-secret"); }) as typeof fetch,
    (async () => new Response("fixture-secret", { status: 401 })) as typeof fetch,
    (async () => new Response("fixture-secret")) as typeof fetch,
    (async () => new Response("x".repeat(2_000_001))) as typeof fetch,
    (async () => new Response(null, { status: 302, headers: { Location: "https://example.test" } })) as typeof fetch,
  ]) {
    await assert.rejects(collectLicensedOdds({ ...options, fetcher }), (error: Error) => {
      assert.match(error.message, /request failed/);
      assert.doesNotMatch(error.message, /fixture-secret|example\.test|apiKey=/);
      return true;
    });
  }
});

test("atomic publication preserves existing snapshot on validation or collection failure", async () => {
  const directory = `.odds-test-${randomUUID()}`;
  const output = `${directory}/odds.json`;
  await mkdir(directory);
  try {
    await writeFile(output, "previous");
    await assert.rejects(saveLicensedOdds({ ...options, input: { invalid: true } }, output));
    assert.equal(await readFile(output, "utf8"), "previous");
    await saveLicensedOdds({ ...options, input: snapshot() }, output);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), snapshot());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
