# Rookie Radar

A responsive NBA Rookie of the Year dashboard built with Next.js App Router,
TypeScript, Tailwind CSS, and Recharts. Independent and unofficial; not affiliated
with the NBA.

**This is a demo, not a current-season feed.** The 12 rookies, season averages, and
last-ten game logs form an illustrative 2024–25 snapshot dated February 1, 2025.
Stats and logs are synthetic examples, not official historical results.

## Run locally

Requires Node.js **22.18+** and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. No API keys, external fonts, or environment variables
are required.

```sh
npm test           # Built-in Node test runner; no additional test dependency
npm run lint       # ESLint / Next.js rules
npm run typecheck  # Generate route types and run TypeScript
npm run build     # Production build
npm start         # Serve the production build
```

Deploy to a Next.js-compatible host using `npm run build` and `npm start`, or import
the repository into Vercel. GitHub Pages deployment is **not configured**; it would
require Next.js static export and a Pages deployment workflow. A static export
would need rebuilds for refreshed server-loaded snapshots.

## Dashboard

- Summary cards: leading contender, rookies tracked, and snapshot timestamp (UTC).
- Top-three contender cards with season averages and recent scoring form.
- Searchable leaderboard, position filters, and ascending/descending sorting on
  every stat, player name, and team. Default order: ROTY Score descending.
- Select a player from a card or leaderboard to update their spotlight panel:
  bio, season averages, last-ten averages, points trend vs season average, and
  expandable game log.
- Scoring methodology with weights and reference targets visible in the UI.
- Responsive desktop/tablet/mobile layouts, keyboard controls, screen-reader
  chart description and game table, reduced-motion support, and loading, empty,
  and error states.

On narrow screens the leaderboard scrolls horizontally to preserve all stats.
Selecting a player moves focus to the spotlight and scrolls it into view.

## Architecture

```text
src/app/                 Server entry point, metadata, loading/error boundaries, CSS
src/components/          Dashboard, leaderboard, player panel, lazy-loaded Recharts chart
src/data/rookies.ts      Deterministic demo profiles and ten chronological logs each
src/lib/models.ts        Typed rookies, stats, logs, snapshots, provider interface
src/lib/data.ts          Provider selection (server-side integration seam)
src/lib/scoring.ts       Configurable formula, breakdown, immutable ranking
src/lib/format.ts        Percentage/date formatting and recent averages
src/lib/scoring.test.ts  Formula, ranking, seed integrity, and formatting tests
```

The server page loads a `RookieSnapshot` through `RookieDataProvider`, then passes
serializable data to interactive client components. Charts load separately from
the main dashboard. No database or backend credentials are needed for the demo.
Dates use UTC to avoid hydration differences between server and client.

## ROTY Score

The score is a transparent **0–100 index**, not an award probability. Each ratio
below is clamped to `[0, 1]`, then the dimensions are combined with normalized
weights:

| Dimension | Default weight | Formula |
| --- | --- | --- |
| Scoring | 35% | PPG / 25 |
| Efficiency | 20% | 0.5 × (FG% / 60%) + 0.3 × (3P% / 45%) + 0.2 × (FT% / 90%) |
| All-around | 20% | 0.5 × (RPG / 10) + 0.5 × (APG / 8) |
| Defense | 15% | 0.6 × (SPG / 2) + 0.4 × (BPG / 2) |
| Availability | 10% | Games played / team games scheduled (50 in the seed snapshot) |

`score = Σ(dimension × weight / total weight) × 100`.

Change **`SCORE_WEIGHTS` in `src/lib/scoring.ts`** to tune the model; the UI reads
from the same configuration. Weights must be finite and non-negative, with at
least one positive value. They need not sum to 100. `computeRotyScore` also accepts
optional custom weights. Reference targets and descriptions live in that module.

Shooting percentages are stored as fractions (`0.429`, not `42.9`). Scores retain
full precision for sorting and are rounded to one decimal only for display.
Ties are broken alphabetically. Last-ten form provides context but does not enter
the score.

**Limitations:** no attempt-volume adjustment, minutes threshold, pace adjustment,
team impact, or opponent strength. Non-shooters can be penalized for zero 3P%.
The fixed availability denominator suits this seed dataset only. The score is
intentionally simple and should not be interpreted as total player value.

## Integrating live NBA data

1. Implement `RookieDataProvider.getSnapshot()` and select it in `src/lib/data.ts`
   (see the integration TODO comments).
2. Fetch only from a licensed/public source permitted for your use. Keep any
   credentials server-side in ignored environment files; never in client props.
3. Validate upstream payloads, rookie eligibility, stable player IDs, dates, and
   percentages. Sort game logs chronologically, oldest first; the UI uses the
   last ten. Supply an actual update timestamp and set `source: "live"`.
4. Extend the model to carry each team's actual scheduled games for availability
   scoring; teams do not always have identical schedules.
5. Add caching/revalidation, timeouts, rate-limit handling, and stale-snapshot
   fallback. Avoid returning an apparently fresh timestamp for stale data.
6. Add provider contract tests, monitoring, and appropriate source attribution
   before presenting the dashboard as a live tracker.

The demo provider is asynchronous so this replacement does not require changing
the dashboard components.
