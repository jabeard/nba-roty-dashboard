# Rookie Radar

A responsive NBA Rookie of the Year dashboard built with Next.js App Router,
TypeScript, Tailwind CSS, and Recharts. Independent and unofficial; not affiliated
with the NBA.

**This is a demo, not a current-season feed.** The 12 rookies, season averages, and
last-ten game logs form an illustrative 2024–25 snapshot dated February 1, 2025.
Stats and logs are synthetic examples, not official historical results.

> **NBA Stats feasibility only — disabled by default.** No subscription or API key
> is needed, but this does **not** grant a license. Confirm NBA's legal permissions
> for automated access and **public redistribution** before publishing any collected
> data. Attribution alone is not permission. Review the
> [NBA Terms of Use](https://www.nba.com/termsofuse) and
> [Stats FAQ](https://www.nba.com/stats/help/faq).
> NBA Stats can throttle, change, or block requests, especially from cloud/hosting
> IPs. This is an unsupported local experiment, not a production live-data service.

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
src/lib/nba-stats.ts     NBA endpoint transformations and snapshot assembly
src/lib/snapshot.ts      Snapshot runtime validation
src/lib/snapshot-provider.ts  Server-side file reader implementing the provider
scripts/                Manual NBA Stats collector and snapshot validation CLI
.github/workflows/       Manual (workflow_dispatch) collection workflow
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

## Local NBA Stats feasibility path

From the repository root, with Node.js 22.18+:

```sh
npm ci
npm run collect:nba-stats -- --season 2026-27
npm run validate:snapshot
DATA_SOURCE=snapshot npm run dev
```

Open <http://localhost:3000>. The season defaults to `2026-27`, so
`npm run collect:nba-stats` is equivalent. Collection is **manual only**: no cron,
automatic refresh, or NBA requests from the dashboard runtime. For an explicitly
authorized local scheduler, invoke the same collector command; no scheduler is
enabled by this project.

### Manual GitHub Actions collection

`.github/workflows/collect-nba-stats.yml` runs the same collector and validator on
demand. Trigger it from the repository's **Actions** tab or the GitHub mobile app:
**Actions → Collect rookie stats → Run workflow**, optionally changing the season.

- Runs only via `workflow_dispatch`; there is no schedule yet.
- One run at a time (concurrency group), read-only repository permissions,
  45-minute timeout.
- On success the validated snapshot is uploaded as a `live-snapshot-<run id>`
  artifact (kept 7 days) and the run summary lists the rookie count, collection
  time, and top scorers. Download the artifact and save it as
  `data/live-snapshot.json` to use it locally.
- The snapshot is **not committed or deployed**; the Vercel site is unchanged.
  Artifacts of a public repository are visible to signed-in GitHub users, so the
  redistribution caution above still applies.
- NBA Stats frequently throttles or blocks cloud IPs, including GitHub-hosted
  runners. A failed run leaves nothing changed; check the step log and summary.

To return to the original dashboard:

```sh
DATA_SOURCE=demo npm run dev
```

An unset `DATA_SOURCE` also selects demo. PowerShell users can set
`$env:DATA_SOURCE="snapshot"` before running `npm run dev`. This is a server-side
variable, **not** `NEXT_PUBLIC_DATA_SOURCE`.

The collector writes `data/live-snapshot.json` (gitignored to avoid accidentally
redistributing data). It validates the complete result and atomically replaces the
file **only on success**. A failed/partial collection exits nonzero with endpoint
or player context and leaves the last successful snapshot unchanged. Empty
seasons fail clearly rather than overwriting good data. Do not assume 2026–27
data exists yet: availability depends on actual regular-season appearances and
NBA's publication timing. This implementation does not claim verified 2026–27
endpoint access.

Optional alternate local output/validation:

```sh
npm run collect:nba-stats -- --season 2026-27 --output /tmp/rookie-snapshot.json
npm run validate:snapshot -- --file /tmp/rookie-snapshot.json
```

The dashboard intentionally reads only `data/live-snapshot.json`; an alternate
output is for inspection, not automatic provider selection.

### What is collected

- `LeagueDashPlayerStats`: `PlayerExperience=Rookie`, `PerMode=PerGame`,
  `SeasonType=Regular Season`, target season, no team filter.
- `CommonPlayerInfo`: position, team name, jersey, draft pick for each rookie.
- `PlayerGameLog`: the most recent ten appearances, sorted oldest → newest in
  UTC (all appearances if the rookie has played fewer than ten).
- Stable NBA player IDs, complete dashboard season averages, fraction-based
  shooting percentages, collection completion timestamp, endpoint metadata and
  visible feasibility warnings. NBA percentages are already fractions; unexpected
  0–100 scales are rejected instead of guessed.

No new dependencies: the TypeScript scripts use Node's built-in `fetch`, file
APIs, argument parsing, and type stripping. The endpoint shapes follow the
community [`nba_api` documentation](https://github.com/swar/nba_api/tree/master/docs/nba_api/stats/endpoints);
the Python client is not installed or required.

Requests are sequential: at least three seconds between requests, 20-second
request timeout, at most three attempts for network failures, HTTP 429 and 5xx,
with 6/12-second backoff and `Retry-After` honored. A server-requested delay over
two minutes stops the run instead of retrying early. HTTP 4xx other than 429
fails immediately; invalid responses also fail clearly. Expect at least
`1 + 2 × rookie count` requests and a run of several minutes.
Do not run parallel collectors or try to bypass IP blocks/access controls.

### Snapshot mode and limitations

`src/lib/snapshot-provider.ts` reads and validates the local file, implementing
`RookieDataProvider`. `src/lib/data.ts` defaults to the unchanged mock provider.
Missing/malformed snapshots or invalid source configuration produce a server
warning and a **visible demo fallback notice**, not an app startup failure.
Only successful snapshot data uses the `NBA STATS SNAPSHOT` label; timestamps
are never refreshed merely because the file was read.

- No box-score streaming, always-on scraping, credentials, or paid service.
- NBA endpoints are unofficial/unsupported for this use; rate limits, timeouts,
  IP blocks, schema changes, and incomplete bios/logs may prevent collection.
  A cloud/CI failure does not affect demo startup; collect locally if permitted.
- Rookie eligibility follows NBA Stats, not simply the draft class; verify it.
- Hybrid positions use the first listed position for the existing position filter.
  Missing jersey numbers and undrafted/unavailable draft picks display “—”.
  Team colors use a neutral fallback rather than additional asset scraping.
- Availability scoring uses **82 full-season scheduled games**, not the demo's
  50 or each team's games played to date. This can underweight early-season
  availability and is **not production-ready scoring**.
- Snapshots can become stale. The UI shows the actual collection timestamp and
  local-snapshot caution, but there is no freshness SLA or automatic stale alert.
- Next.js can prerender this page at build time. Restart the dev server after
  replacing snapshots; production snapshot builds require the file to be present
  and `DATA_SOURCE=snapshot` during **build**, followed by the same setting at
  start. Rebuild to publish new data or change providers:

  ```sh
  DATA_SOURCE=snapshot npm run build
  DATA_SOURCE=snapshot npm start
  ```

  Keep public production deployments in demo mode until redistribution is
  authorized. A production deployment does not run the collector for you.

### Before production live mode

Confirm automated-access and public-redistribution permissions first. Then verify
real results and eligibility against NBA displays, add per-team games-to-date
availability scoring, reliability hardening (authorized collection host, durable
snapshot storage, freshness policy, caching/revalidation and recovery), monitoring
and alerting for collection failures/staleness/schema drift, and appropriate
attribution. No production live mode or scheduled collection is enabled here;
the GitHub Actions workflow is manual and artifact-only.
