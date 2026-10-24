export default function Loading() {
  return (
    <main className="loading-page" aria-busy="true" aria-label="Loading rookie dashboard">
      <p className="eyebrow">ROOKIE RADAR</p><h1>Scouting the rookie class…</h1>
      <div className="summary-grid">{[1, 2, 3].map((key) => <div key={key} className="summary-card skeleton" style={{ height: 150 }} />)}</div>
      <div className="panel skeleton" style={{ height: 440, marginTop: 24 }} />
      <p role="status">Loading rankings and player stats.</p>
    </main>
  );
}
