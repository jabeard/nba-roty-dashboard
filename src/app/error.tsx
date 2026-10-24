"use client";

export default function Error({ reset }: { reset: () => void }) {
  return <main className="loading-page"><p className="eyebrow">ROOKIE RADAR</p><h1>The stats are taking a timeout.</h1><p>We couldn’t load the rookie dashboard. Please try again.</p><button onClick={reset} className="outline-button">Try again</button></main>;
}
