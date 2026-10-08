"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="container public-main">
      <div className="empty" role="alert">
        <h1>This page isn’t available right now.</h1>
        <p>Please try again.</p>
        <button className="button" onClick={reset}>
          Try Again
        </button>
      </div>
    </main>
  );
}
