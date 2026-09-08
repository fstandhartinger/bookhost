"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="section">
      <h1 className="text-4xl">Something didn’t load.</h1>
      <p className="lede">
        Please try again in a moment. If this continues, contact support.
      </p>
      <button onClick={reset} className="button mt-6">
        Try again
      </button>
    </section>
  );
}
