import type { RookieSnapshot } from "./models.ts";
import type { ForecastPool } from "./forecast.ts";

export interface CoverageReport {
  season: string;
  source: RookieSnapshot["source"];
  provider: string;
  updatedAt: string;
  reviewedAt: string | null;
  complete: boolean;
  players: { id: string; name: string; eligibilitySource: string; appearance: "recorded" | "not-in-snapshot" }[];
  unreviewed: { id: string; name: string }[];
  dybantsa: string;
}

export function inspectCoverage(snapshot: RookieSnapshot, pool?: ForecastPool): CoverageReport {
  const matching = pool && pool.season === snapshot.season &&
    pool.provider === snapshot.sourceMetadata?.provider && snapshot.source !== "demo" ? pool : undefined;
  const observed = new Set(snapshot.rookies.map((player) => player.id));
  const reviewed = new Set(matching?.players.map((player) => player.id));
  const unreviewed = snapshot.rookies.filter((player) => !reviewed.has(player.id))
    .map(({ id, name }) => ({ id, name }));
  const target = matching?.players.find((player) => /\bdybantsa\b/i.test(player.name));
  const recorded = snapshot.rookies.find((player) => /\bdybantsa\b/i.test(player.name));
  return {
    season: snapshot.season,
    source: snapshot.source,
    provider: snapshot.sourceMetadata?.provider ?? "Seed dataset",
    updatedAt: snapshot.updatedAt,
    reviewedAt: matching?.updatedAt ?? null,
    complete: Boolean(matching?.complete && !unreviewed.length),
    players: matching?.players.map(({ id, name, eligibilitySource }) => ({
      id, name, eligibilitySource, appearance: observed.has(id) ? "recorded" : "not-in-snapshot",
    })) ?? [],
    unreviewed,
    dybantsa: snapshot.source === "demo"
      ? "AJ Dybantsa is not in the illustrative 2024–25 demo. This is not evidence about current NBA eligibility."
      : recorded
        ? `AJ Dybantsa has ${recorded.stats.gamesPlayed} recorded appearance(s) in this snapshot.`
        : target
          ? "AJ Dybantsa is in the reviewed pool but has no appearance in this snapshot. Awaiting debut and missing provider data must be distinguished with a provider audit."
          : "AJ Dybantsa is absent from this snapshot and has no matching reviewed eligibility record. His eligibility and provider records remain unverified.",
  };
}
