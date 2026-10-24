import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createSnapshot, normalizeRookie, resultRows, validateSeason } from "../src/lib/nba-stats.ts";
import { validateSnapshot } from "../src/lib/snapshot.ts";
import { SNAPSHOT_PATH } from "../src/lib/snapshot-provider.ts";

export function createNbaClient(
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<unknown> = sleep,
) {
  return async (endpoint: string, params: Record<string, string>) => {
    const url = new URL(`https://stats.nba.com/stats/${endpoint}`);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      // Sequential callers wait at least three seconds before every request.
      await wait(3_000);
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; RookieRadar-local-feasibility/1.0)",
            Referer: "https://www.nba.com/",
          },
          signal: AbortSignal.timeout(20_000),
          redirect: "error",
        });
      } catch (error) {
        if (attempt === 2) throw new Error(`${endpoint}: network/timeout failure after 3 attempts (${String(error)}). NBA Stats may block this IP; try locally later.`);
        await wait(6_000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        try {
          return await response.json() as unknown;
        } catch {
          throw new Error(`${endpoint}: expected JSON but received an invalid response. NBA Stats may be blocking this IP.`);
        }
      }
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`${endpoint}: HTTP ${response.status}. Access may be blocked; do not bypass access controls.`);
      }
      if (attempt === 2) throw new Error(`${endpoint}: HTTP ${response.status} after 3 attempts. Try locally later.`);
      const header = response.headers.get("retry-after");
      const retryAfter = header === null ? 0 : /^\d+$/.test(header)
        ? Number(header) * 1_000 : Date.parse(header) - Date.now();
      if (retryAfter > 120_000) throw new Error(`${endpoint}: server requested a long Retry-After; stop and try later.`);
      await wait(Math.max(6_000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0));
    }
    throw new Error(`${endpoint}: retries exhausted.`);
  };
}

export async function collectSnapshot(
  season: string,
  request = createNbaClient(),
) {
  validateSeason(season);
  const leaderboard = await request("leaguedashplayerstats", {
    College: "", Conference: "", Country: "", DateFrom: "", DateTo: "", Division: "",
    DraftPick: "", DraftYear: "", GameScope: "", GameSegment: "", Height: "",
    LastNGames: "0", LeagueID: "00", Location: "", MeasureType: "Base", Month: "0",
    OpponentTeamID: "0", Outcome: "", PORound: "0", PaceAdjust: "N", PerMode: "PerGame",
    Period: "0", PlayerExperience: "Rookie", PlayerPosition: "", PlusMinus: "N",
    Rank: "N", Season: season, SeasonSegment: "", SeasonType: "Regular Season",
    ShotClockRange: "", StarterBench: "", TeamID: "0", TwoWay: "", VsConference: "", VsDivision: "", Weight: "",
  });
  const rows = resultRows(leaderboard, "LeagueDashPlayerStats");
  if (!rows.length) {
    throw new Error(`No rookie regular-season data for ${season}. The season may not have started or NBA Stats may not have published data yet.`);
  }
  const rookies = [];
  for (const row of rows) {
    try {
      if (typeof row.PLAYER_ID !== "number" || !Number.isInteger(row.PLAYER_ID) || row.PLAYER_ID <= 0) {
        throw new Error("Missing or invalid PLAYER_ID.");
      }
      console.log(`Collecting ${row.PLAYER_NAME} (${row.PLAYER_ID})…`);
      const info = await request("commonplayerinfo", { PlayerID: String(row.PLAYER_ID), LeagueID: "00" });
      const logs = await request("playergamelog", {
        PlayerID: String(row.PLAYER_ID), Season: season, SeasonType: "Regular Season",
        LeagueID: "00", DateFrom: "", DateTo: "",
      });
      rookies.push(normalizeRookie(row, info, logs));
    } catch (error) {
      throw new Error(`Incomplete collection for ${String(row.PLAYER_NAME)} (${String(row.PLAYER_ID)}); ${rookies.length}/${rows.length} players completed. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return validateSnapshot(createSnapshot(season, rookies, new Date().toISOString()));
}

async function main() {
  const { values } = parseArgs({
    options: { season: { type: "string", default: "2026-27" }, output: { type: "string", default: SNAPSHOT_PATH } },
  });
  const output = resolve(values.output!);
  console.log(`Local NBA Stats feasibility collection for ${values.season}. Confirm permissions before redistribution.`);
  const snapshot = await collectSnapshot(values.season!);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Saved ${snapshot.rookies.length} rookies to ${output} at ${snapshot.updatedAt}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Collection failed; no snapshot replaced. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
