import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RookieDataProvider } from "./models.ts";
import { validateSnapshot } from "./snapshot.ts";

export const SNAPSHOT_PATH = resolve(process.cwd(), "data/live-snapshot.json");

export function createSnapshotProvider(
  readSnapshot = () => readFile(SNAPSHOT_PATH, "utf8"),
): RookieDataProvider {
  return {
    async getSnapshot() {
      try {
        return validateSnapshot(JSON.parse(await readSnapshot()));
      } catch (error) {
        throw new Error(
          `Cannot load NBA Stats snapshot at ${SNAPSHOT_PATH}: ${error instanceof Error ? error.message : String(error)} Run npm run collect:nba-stats locally.`,
        );
      }
    },
  };
}
