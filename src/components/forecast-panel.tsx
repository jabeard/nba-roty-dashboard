import type { ForecastDashboardData } from "../lib/forecast-provider";
import { compareOdds, fairOdds } from "../lib/odds";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const american = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value}`;

export function ForecastPanel({ data }: { data: ForecastDashboardData }) {
  const { coverage, forecast, odds, notices } = data;
  const poolIds = coverage.players.map((player) => player.id);
  return (
    <section id="forecasts" className="panel forecast-panel" aria-labelledby="forecast-heading">
      <p className="eyebrow">COVERAGE &amp; OUTLOOK</p>
      <h2 id="forecast-heading">ROTY forecasts &amp; fair value</h2>
      <p>Separate from ROTY Score. Forecasts require a complete, eligibility-reviewed field; provider history alone does not verify eligibility. Review sources and projections must be supplied by a curator, not inferred from a missing record.</p>
      <dl className="coverage-summary">
        <div><dt>Season / source</dt><dd>{coverage.season} / {coverage.provider} ({coverage.source})</dd></div>
        <div><dt>Stats collected (UTC)</dt><dd><time dateTime={coverage.updatedAt}>{coverage.updatedAt}</time></dd></div>
        <div><dt>Eligibility review (UTC)</dt><dd>{coverage.reviewedAt ?? "Not supplied"} · {coverage.complete ? "Complete field attested" : "Incomplete / unverified"}</dd></div>
      </dl>
      <p role="status">{coverage.dybantsa}</p>
      {coverage.unreviewed.length > 0 && coverage.source !== "demo" && <p>Observed players without a reviewed eligibility record: {coverage.unreviewed.map((player) => player.name).join(", ")}. Forecasts are withheld until the field is reconciled.</p>}
      <details>
        <summary>Reviewed rookie pool ({coverage.players.length})</summary>
        {coverage.players.length ? <ul>{coverage.players.map((player) =>
          <li key={player.id}>{player.name} (ID {player.id}) — {player.appearance === "recorded" ? "Appearance recorded" : "No appearance in snapshot; awaiting debut or missing data"}; eligibility evidence: {player.eligibilitySource}</li>,
        )}</ul> : <p>No reviewed pool is available. No player has been assigned invented eligibility or projections.</p>}
      </details>
      {notices.map((notice) => <p className="forecast-warning" key={notice}>{notice}</p>)}
      {forecast && <>
        <h3>{forecast.status === "backtested" ? "Historically backtested model" : "Experimental, uncalibrated estimates"}</h3>
        {data.model && <p>Trained through {data.model.trainedThrough} on {data.model.trainingSeasonCount} seasons. Chronological held-out evaluation: {data.model.validation.seasonCount} seasons, multiclass Brier {data.model.validation.brier.toFixed(3)}, log loss {data.model.validation.logLoss.toFixed(3)}. Lower is better; these small-sample metrics do not establish reliable calibration.</p>}
        {forecast.warnings.map((warning) => <p className="forecast-warning" key={warning}>{warning}</p>)}
        <p>Ranges show sensitivity to remaining-season scenarios, not calibrated confidence intervals. Fair odds exclude bookmaker margin.</p>
        <div className="forecast-table-scroll">
          <table className="forecast-table">
            <caption>Win estimates and prices as checked {data.asOf} (UTC)</caption>
            <thead><tr><th scope="col">Player</th><th scope="col">Win / range</th><th scope="col">Projected GP / PPG</th><th scope="col">Observed weight</th><th scope="col">Fair decimal / American</th><th scope="col">Bookmaker comparisons</th></tr></thead>
            <tbody>{forecast.players.map((player) => {
              const fair = fairOdds(player.probability);
              const comparisons = odds ? compareOdds(player.probability, player.id, odds, poolIds, Date.parse(data.asOf)) : [];
              return <tr key={player.id}>
                <th scope="row">
                  {player.name}
                  {player.outlook ? <details>
                    <summary>Availability: {player.outlook.status}</summary>
                    <p>Source: {player.outlook.source}<br />Reviewed (UTC): {player.outlook.reviewedAt}</p>
                    {player.outlook.returnPlan ? <>
                      <p>Return window (UTC): {player.outlook.returnPlan.early.date} – {player.outlook.returnPlan.delayed.date}. Expected: {player.outlook.returnPlan.expected.date}.</p>
                      <p>Team games missed before return (early / expected / delayed): {player.outlook.returnPlan.early.missedGames} / {player.outlook.returnPlan.expected.missedGames} / {player.outlook.returnPlan.delayed.missedGames}.</p>
                      <p>Ramp-up: first {player.outlook.returnPlan.rampUpGames} team opportunities after return at {player.outlook.returnPlan.rampUpMinutes} minutes per appearance, then {player.expectedMinutes} minutes. Post-return availability: {percent(player.availability)}.</p>
                    </> : <p>No explicit return window supplied; projection uses the reviewed remaining-season availability assumption.</p>}
                  </details> : <p>Availability status not supplied; missing stats do not establish an injury.</p>}
                </th>
                <td>{percent(player.probability)}<br /><span>{percent(player.lower)}–{percent(player.upper)}</span></td>
                <td>{player.projectedGames.toFixed(1)} / {player.projectedGames > 0 ? (player.projectedPoints / player.projectedGames).toFixed(1) : "—"}</td>
                <td>{percent(player.observedWeight)}</td>
                <td>{fair.decimal?.toFixed(2) ?? "—"} / {american(fair.american)}</td>
                <td>{comparisons.length ? comparisons.map((quote) => <div className="book-quote" key={quote.bookmaker}>
                  <strong>{quote.bookmaker}</strong>: {quote.decimal.toFixed(2)} decimal · implied {percent(quote.impliedProbability)}
                  <br /><time dateTime={quote.updatedAt}>{quote.updatedAt}</time>
                  <br />{quote.stale ? "STALE / FUTURE — EV withheld" : data.forecastStale ? "OUTDATED FORECAST — EV withheld" : `EV per unit: ${quote.expectedValue === null ? "—" : percent(quote.expectedValue)}`}
                  {" · "}{quote.incomplete ? "Incomplete field — no de-vig" : `No-vig: ${quote.noVigProbability === null ? "unavailable" : percent(quote.noVigProbability)}`}
                </div>) : "No matching licensed prices"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {forecast.players.some((player) => player.returnScenarios) && <details>
          <summary>Early / expected / delayed return comparisons</summary>
          <p>All return plans change together. Each scenario covers the complete field and sums to 100% before rounding. Headline predictions use expected returns; dates and missed-game counts are reviewed assumptions, not a live schedule feed.</p>
          <div className="forecast-table-scroll">
            <table className="forecast-table">
              <caption>Return-scenario impact on win chance, final production, and fair odds</caption>
              <thead><tr><th scope="col">Player</th><th scope="col">Return scenario</th><th scope="col">Win chance</th><th scope="col">Projected GP / PPG</th><th scope="col">Fair decimal / American</th></tr></thead>
              <tbody>{forecast.players.flatMap((player) => (player.returnScenarios ?? []).map((scenario) => {
                const fair = fairOdds(scenario.probability);
                return <tr key={`${player.id}-${scenario.scenario}`}>
                  <th scope="row">{player.name}</th>
                  <td>{scenario.scenario}</td>
                  <td>{percent(scenario.probability)}</td>
                  <td>{scenario.projectedGames.toFixed(1)} / {scenario.projectedGames > 0 ? (scenario.projectedPoints / scenario.projectedGames).toFixed(1) : "—"}</td>
                  <td>{fair.decimal?.toFixed(2) ?? "—"} / {american(fair.american)}</td>
                </tr>;
              }))}</tbody>
            </table>
          </div>
        </details>}
        {odds && <p>Odds provider: {odds.provider}. Collected {odds.collectedAt}. Prices older than 24 hours are stale; a recently collected file does not refresh an old quote.</p>}
        <p>Expected value is a model estimate, not guaranteed profit. Incomplete or stale markets are never normalized to imply full-field probabilities. Verify prices and rules with the bookmaker.</p>
      </>}
      {!forecast && <p>No win probabilities or fair prices are published until the coverage requirements pass.</p>}
    </section>
  );
}
