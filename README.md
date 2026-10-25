# Rookie Radar

A responsive NBA Rookie of the Year dashboard built with Next.js App Router,
TypeScript, Tailwind CSS, and Recharts. Independent and unofficial; not affiliated
with the NBA.

**Demo by default, with optional manually collected snapshots.** The 12 seeded rookies, season averages, and
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
src/lib/balldontlie.ts   BALLDONTLIE box-score transformations and aggregation
src/lib/snapshot.ts      Snapshot runtime validation
src/lib/snapshot-provider.ts  Server-side file reader implementing the provider
scripts/                Manual provider collectors and snapshot validation CLI
.github/workflows/       Manual collection workflows; BALLDONTLIE also deploys to Vercel
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

**Does 58/100 mean an average rookie?** No. It is neither a percentile, a letter
grade, nor a 58% award probability. In provider snapshots, availability contributes
`10 × games played / 82`; it grows with appearances, but adds at most ten points
over the whole season. The other 90 points depend on per-game production and can
rise or fall. A player is not expected to approach 100 as the season progresses.

## Eligibility coverage, forecasts, and sportsbook comparisons

The **Forecasts & odds** section is separate from ROTY Score. It shows the selected
season, source, collection time, reviewed field, and an explicit AJ Dybantsa
coverage explanation. Missing records do **not** establish ineligibility or prove
a player has not debuted. The default demo is still the seeded 2024–25 dataset;
demo observations never produce forecasts or sportsbook comparisons.

### Audit the actual data

```bash
npm run audit:coverage -- --season 2026-27 --player Dybantsa
```

This reports the local selection, checks the repository homepage's
`/api/coverage` endpoint, and, when `BALLDONTLIE_API_KEY` is configured, searches
player records and examines completed current-season appearances and prior
regular-season history. It never treats an empty history as official eligibility.
`--skip-deployed` avoids the deployment request. API access requires the applicable
provider subscription. Credentials and transport errors are not printed.

The deployed endpoint becomes available only after deploying this release.
Implementation-time checks could not resolve the homepage
`https://nba-roty-dashboard.vercel.app`; no local live snapshot or provider
credentials were available. Therefore **neither the deployed season/timestamp nor
Dybantsa's provider records were verified**, and no official player ID or
eligibility has been invented.

### Supply a reviewed pool and outlook

Create the local, gitignored `data/rookie-pool.json` before building:

- Top-level fields: `season` (consecutive `YYYY-YY`), `provider` (`BALLDONTLIE` or
  `NBA Stats`, identifying the **player ID namespace**), `updatedAt` (UTC ISO
  review/as-of time), `complete` (boolean curator attestation), and `players`.
- Each player: `id` (unique numeric provider ID as a string), `name`,
  `eligibilitySource` (official eligibility evidence/reference), `verifiedAt`
  (UTC ISO review time), and `preseason`.
- `preseason` contains projected per-game `minutes`, `points`, `rebounds`,
  `assists`, `steals`, `blocks`, and a nonempty `role` description. These must be
  genuine as-of expectations, not eventual season results. Role is explanatory
  context; its quantitative effect is represented by minutes and production.
- Each player also needs `remainingGames` (integer remaining team opportunities,
  0–82), `expectedMinutes` (0–48 per appearance), `availability` (expected fraction
  of remaining opportunities played, 0–1, incorporating injury outlook), and
  `uncertainty` (scenario sensitivity, greater than zero through one).

Include **every officially eligible player**, including players with no recorded
appearance. Official evidence is separate from the stats provider ID namespace.
`complete: true` is an auditable curator assertion, not an automated NBA ruling.
All observed players must be reconciled with the reviewed pool before forecasting;
omitting observed participants or marking the pool incomplete withholds estimates.
The review must cover the latest observed game date, be within the target season,
and not be in the future; it can predate the snapshot's later collection time.
Game dates have provider calendar-date granularity, not exact completion times.
Refresh remaining opportunities and injury outlook when refreshing stats.
Observed plus remaining games cannot exceed 82.

There is no fabricated default pool. Missing or malformed files produce visible
notices while preserving the original statistical dashboard.

### Projections, training, and historical validation

Observed weight is `games played / (games played + 20)`. Remaining-season rates
blend observed per-game production with preseason production adjusted from prior
minutes to expected minutes. Played production is retained; remaining opportunities
are multiplied by expected availability. Player-specific deterministic scenarios
vary remaining production and availability, with less uncertainty as observations
accumulate. Injury risk does not erase production already recorded. Expected
final totals, including projected games, drive a separate softmax award model.

Without a model artifact, the estimates are prominently **experimental,
uncalibrated**. Probabilities sum to one only across an attested complete field.
Scenario ranges are sensitivity ranges, **not calibrated confidence intervals**.
These estimates do not imply the model has learned voting preferences.

```bash
npm run train:forecast -- --input /absolute/path/to/historical-races.json
```

The input is an array of historical races, each with `pool`, `snapshot`, `winnerId`,
and `outcomeAt` (the UTC timestamp of the known award outcome). Pools use the
contract above; snapshots use the existing snapshot contract. Use contemporaneous
snapshots and outlooks **before** the award outcome; retrospective final stats or
revised priors introduce leakage that timestamps alone cannot detect. There must
be at least six distinct completed seasons, with one consistently timed forecast
origin per season. A no-appearance historical snapshot may use `rookies: []` in
the forecast-specific contract; the ordinary collector snapshot validator remains
unchanged and still rejects empty data.

Training fits production/games coefficients, calibrates temperature on later
seasons, and evaluates subsequent seasons using expanding chronological folds.
Each evaluated fold uses only earlier known outcomes. The serialized
`data/forecast-model.json` records training seasons and held-out multiclass Brier
score/log loss, displayed in the dashboard. The final model must predate the
forecast season. Small-sample historical results are **not proof of calibration**.
No licensed historical training corpus or fitted production model is bundled;
real training and empirical calibration require those inputs.

### Licensed odds and price comparison

No sportsbook pages are scraped. Confirm your feed license permits public display
and redistribution, then set server-only `ODDS_REDISTRIBUTION_APPROVED=true`.
Two ingestion paths are supported:

```bash
# Import a normalized snapshot from an authorized licensed source:
npm run collect:odds -- --season 2026-27 --input /absolute/path/to/licensed-odds.json

# Discover an explicitly offered ROTY market through The Odds API:
# Requires server-only ODDS_API_KEY and a reviewed player-alias mapping.
npm run collect:odds -- --season 2026-27 --aliases /absolute/path/to/aliases.json
```

An alias file is an object with `playerProvider` (`BALLDONTLIE` or `NBA Stats`)
and `players`, an array of `{ "playerId": "123", "name": "Provider name",
"aliases": ["Alternative book spelling"] }` records. IDs must match the reviewed
pool's provider namespace; unknown or ambiguous outcomes stop publication.
The API adapter first discovers an unambiguous **NBA Rookie of the Year outright**
sport listing and verifies the event and season. If unavailable, it fails rather
than substituting NBA championship odds. **Live ROTY availability, FanDuel and
DraftKings inclusion, and account access are not confirmed**; check your licensed
provider's actual market/bookmaker coverage. Other authorized providers can supply
the normalized import instead. The discovery adapter does not claim completeness
because the feed does not explicitly guarantee a full eligible field.

Normalized odds contract (`data/odds-snapshot.json`, written atomically):

- `season`, `collectedAt` (UTC ISO), `provider` (licensed feed name),
  `playerProvider` (`BALLDONTLIE` or `NBA Stats`, the player ID namespace),
  `market: "nba_roty"`. Cross-namespace prices are withheld, even when IDs overlap.
- `quotes`: array of `bookmaker`, `playerId`, `decimal` (>1), `updatedAt` (UTC ISO).
  One quote per bookmaker/player; a quote cannot postdate collection.
- `completeBooks`: names of bookmakers whose source **explicitly attests**
  complete-field coverage; use an empty array when this is unknown.

The dashboard shows probability, projected GP/PPG, fair decimal/American odds,
each available book's decimal quote and timestamp, implied probability, and
expected value per unit (`probability × decimal price − 1`). Fair odds exclude
margin. Quotes older than 24 hours or in the future cannot supply EV.
EV comparisons also require a current forecast: stats or outlook older than 48
hours are labeled historical and suppress EV even when quotes are fresh. No-vig
probabilities require explicit completeness, an **exact** match to all reviewed
IDs (no missing or extra outcomes), and fresh quotes across the entire book.
Incomplete markets remain labeled and unnormalized. Prices and EV are estimates,
not executable-price guarantees or guaranteed profit; verify award rules and
current prices with each book.

### Deployment and refresh

Locally, supply the optional files alongside `data/live-snapshot.json`, then run
with `DATA_SOURCE=snapshot`. The Next.js build traces these fixed input paths;
include them in the build/runtime filesystem. Forecast and odds freshness checks
run per request, rather than treating the build date as the current time.
Stats and price ingestion are still manual; this change does not silently enable
paid API polling.

The existing **Pull BALLDONTLIE rookie stats** production workflow optionally
accepts repository Actions variables:

- `ROOKIE_POOL_JSON`: current reviewed BALLDONTLIE pool JSON.
- `FORECAST_MODEL_JSON`: previously trained, validated model JSON.
- Either `ODDS_ALIASES_JSON` for API discovery, or `LICENSED_ODDS_JSON` for a
  normalized licensed import (not both).
- `ODDS_REDISTRIBUTION_APPROVED=true`, plus an `ODDS_API_KEY` Actions **secret**
  for the API path. Never place credentials in JSON data or repository variables.

The workflow validates/stages those inputs before the prebuilt Vercel deployment.
Configured ingestion failures stop deployment; missing optional inputs leave
clear unavailable/experimental states. Actions variable size limits apply; larger
licensed datasets require an appropriately authorized build-time artifact supply
instead. Historical training remains a local/offline command; never put the
winner outcome into a live pool or train on the target season.

## BALLDONTLIE ALL-STAR snapshots

The optional BALLDONTLIE collector uses authenticated `/nba/v1/stats` game
box scores and `/nba/v1/teams`, compatible with NBA **ALL-STAR or higher** access.
It does not call season-averages, advanced-stats, or other higher-tier endpoints.
The existing ROTY formula and weights are unchanged: the collector supplies
per-game production, total makes / total attempts shooting fractions, and the
most recent ten appearances (or all appearances if fewer). Only finished
regular-season games count; live games, postseason games, and DNPs are excluded.
Both provider formats use the same snapshot validator and dashboard.

### Manual stat pull from GitHub

1. Subscribe to NBA ALL-STAR (or higher) at [BALLDONTLIE](https://www.balldontlie.io/)
   and obtain an API key; confirm your plan's data-display/redistribution terms.
2. In this repository, open **Settings → Secrets and variables → Actions → New
   repository secret** and add:
   - **`BALLDONTLIE_API_KEY`** — your NBA ALL-STAR API key.
   - **`VERCEL_TOKEN`** — a Vercel access token authorized to deploy the project.
   - **`VERCEL_ORG_ID`** — the Vercel account/team ID.
   - **`VERCEL_PROJECT_ID`** — the existing Vercel project's ID.

   Find project/account IDs in Vercel project/account settings, or in
   `.vercel/project.json` after linking the project locally. Never commit this
   folder or tokens. The Vercel project must use this repository root and Next.js
   with its standard `npm run build` command.
3. After the workflow is on the default branch, open **Actions → Pull BALLDONTLIE
   rookie stats → Run workflow**, use the **default branch**, select a season
   such as `2026-27`, and run it. The year is the season's starting year, not its
   ending year. Production pulls from other branches are rejected.
   Leave **full_refresh** unchecked for incremental pulls; enable it to rebuild
   all season stats and recheck eligibility after older provider corrections.
4. The workflow collects and validates stats, pulls Vercel's production project
   settings, builds locally with the new snapshot and **`DATA_SOURCE=snapshot`**,
   and deploys the prebuilt output to **Vercel production**. No download or manual
   redeployment is needed. The dashboard displays **BALLDONTLIE SNAPSHOT** and the
   actual collection timestamp; the API key is not needed by the dashboard.
5. Check the run summary and deployment step for the result and deployment URL.
   The `balldontlie-snapshot-<run id>` artifact remains available for download
   for local use or recovery, even if a later build/deployment step fails.

This action is **manually triggered, with automatic production deployment**,
read-only for repository contents, and serialized across collection and deployment,
with a 45-minute timeout and seven-day artifact retention. It does **not** commit
data or enable a schedule. Collection, validation, and build must all succeed
before deployment runs; failure in those steps leaves the current website
unchanged. The Vercel CLI is pinned, and `deploy --prebuilt` uploads the output
built with the snapshot on the runner; a deploy hook or remote Git rebuild would
not include this gitignored file. The build overrides any Vercel `DATA_SOURCE=demo`
setting, and the deployed runtime is also configured for snapshot mode.

The BALLDONTLIE key is scoped to collection; Vercel secrets are used for project
configuration/build/deployment, not embedded in client code. Public-repo artifacts
are accessible to signed-in GitHub users, and the deployment makes stats public;
only run this workflow if your license allows distribution. The separate NBA
Stats feasibility action remains artifact-only.

Normal Vercel Git deployments do not have the runner's snapshot and can overwrite
the site with demo data. Use this workflow again after such a deployment to restore
fresh snapshot data, or disable overlapping Git-triggered production deployments
in Vercel if this workflow should be the sole publisher.

### Local collection

Export `BALLDONTLIE_API_KEY` in your shell using your secret manager (never commit
it or prefix it with `NEXT_PUBLIC_`), then run from the repository root:

```sh
npm run collect:balldontlie -- --season 2026-27
npm run validate:snapshot
DATA_SOURCE=snapshot npm run dev
```

`--output /tmp/rookie-snapshot.json` is available for inspection; validate it with
`npm run validate:snapshot -- --file /tmp/rookie-snapshot.json`.
The collector caches season box scores and eligibility in
`.cache/balldontlie/<season>.json` (gitignored). Subsequent pulls replace the
recent date window, merging older cached rows by player/game ID. The window
starts seven days before the previous successful collection, not the most recent
game, so gaps between runs and newly debuted players are covered.

Collection options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--cache` | `.cache/balldontlie/<season>.json` | Persistent season cache location |
| `--full-refresh` | off | Ignore cached stats and eligibility and rebuild both |
| `--refresh-days` | `7` | Lookback for corrections relative to the previous successful pull (1–366 days) |
| `--concurrency` | `4` | Maximum concurrent player history checks (1–16) |
| `--requests-per-minute` | `60` | Shared request-start limit (1–600); set no higher than your subscription permits |

GitHub Actions restores the latest cache for the selected season and saves a new
version after successful collection and validation, even if deployment later
fails. A missing, invalid, or incompatible cache triggers a full collection.
Actions caches may be evicted; they are an optimization, not the source of truth.
They contain provider box scores, not API keys; the same redistribution cautions
as snapshot artifacts apply. Repository Actions variables
`BALLDONTLIE_REQUESTS_PER_MINUTE`, `BALLDONTLIE_CONCURRENCY`, and
`BALLDONTLIE_REFRESH_DAYS` override the workflow defaults. Older corrections outside
the refresh window require `--full-refresh` (or the workflow's **full_refresh** input).
Season-scoped rookie/veteran classifications are reused until a full refresh.
Collection logs and the Actions summary report phase timings, request counts,
retries, and separate Vercel build/deployment timings.

Production builds still require the validated file and `DATA_SOURCE=snapshot`
at build time, then a rebuild whenever data changes. An unset `DATA_SOURCE`
continues to select the original demo.

### Rookie discovery and limitations

- BALLDONTLIE player profiles do not expose official rookie eligibility.
  On a cold/full pull, the collector scans **all** target-season box-score pages,
  then checks each participant's prior regular-season history (season filters from 1946 through
  the preceding season). Players without prior recorded appearances enter the
  rookie snapshot. Draft year is **not** used as an eligibility proxy: delayed
  debuts and undrafted players can qualify, and current active rosters do not
  exclude rookies who have since been waived.
- This is **first observed NBA season**, not authoritative award eligibility.
  Historical coverage gaps and rounded zero-minute appearances can affect
  classification. Verify the resulting list against official eligibility
  before using it for award analysis; the dashboard visibly discloses this.
- Season stats combine all teams; the profile shows the team of the latest
  appearance. Missing draft pick/jersey and unavailable age display “—”.
  Availability still uses the full 82-game season, not team games played to date.
- History checks use pages of up to 100 rows and stop at the first recorded
  appearance; cached classifications skip repeat history requests.
- Requests share a rate limiter across bounded concurrent history checks, with
  20-second timeouts and at most three attempts for network errors, 429s, and 5xx
  responses. Pacing includes a 10% safety margin (1.1 seconds at the default limit).
  Backoff honors `Retry-After` with a shared cooldown; a delay over two minutes
  stops the run.
  Authentication/subscription errors fail immediately without printing the key
  or response bodies. No new dependencies or paid endpoints beyond ALL-STAR
  box-score access are needed.
- Cold/full pulls still need full-season pagination and history requests, while
  warm pulls fetch only the refresh window and history for newly observed players.
  Empty seasons, incomplete or invalid responses, and failed
  requests exit nonzero; the validated file is replaced atomically only after
  the entire collection succeeds.

API reference: [BALLDONTLIE documentation](https://docs.balldontlie.io/);
endpoint/filter schemas also follow the
[official TypeScript SDK](https://github.com/balldontlie-api/typescript).
No live authenticated request has been verified without your API key.

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
Only successful snapshot data uses a provider-specific snapshot label; timestamps
are never refreshed merely because the file was read.

- The NBA Stats path has no credentials or paid service; neither path streams
  box scores or runs automatically.
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
attribution. No NBA Stats production live mode or scheduled collection is enabled
here; the NBA Stats GitHub Actions workflow is manual and artifact-only. The
BALLDONTLIE workflow above separately supports production snapshot deployment.
