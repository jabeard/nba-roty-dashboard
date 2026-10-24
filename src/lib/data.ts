import { mockRookieProvider } from "../data/rookies";
import type { RookieDataProvider } from "./models";

// TODO: Replace with a server-only live provider implementing RookieDataProvider.
// Validate upstream data, normalize shooting percentages to 0–1, and add caching,
// rate-limit handling, and per-team scheduled games before enabling a live source.
export const rookieProvider: RookieDataProvider = mockRookieProvider;
