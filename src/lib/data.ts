import { mockRookieProvider } from "../data/rookies.ts";
import type { RookieDataProvider } from "./models.ts";
import { createSnapshotProvider } from "./snapshot-provider.ts";

export function selectRookieProvider(source = process.env.DATA_SOURCE ?? "demo", snapshotProvider = createSnapshotProvider()): RookieDataProvider {
  if (source === "demo") return mockRookieProvider;
  return {
    async getSnapshot() {
      try {
        if (source !== "snapshot") throw new Error("Invalid DATA_SOURCE; use demo or snapshot.");
        return await snapshotProvider.getSnapshot();
      } catch (error) {
        console.warn("[Rookie Radar]", error instanceof Error ? error.message : String(error));
        return {
          ...await mockRookieProvider.getSnapshot(),
          notice: source === "snapshot"
            ? "Provider snapshot is missing or invalid. Showing demo data instead. Generate and validate a snapshot locally, then restart or rebuild the app."
            : "Unrecognized DATA_SOURCE. Showing demo data; use demo or snapshot.",
        };
      }
    },
  };
}

export const rookieProvider = selectRookieProvider();
