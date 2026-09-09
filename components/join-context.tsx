"use client";
import { useEffect, useState } from "react";
export function JoinContext() {
  const [error, setError] = useState("");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) return;
    window.history.replaceState(null, "", "/join");
    void fetch("/api/join/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        window.location.replace("/join");
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Please try again."),
      );
  }, []);
  return (
    <>
      <p role="alert">{error}</p>
      <details className="mt-4">
        <summary>Enter an invitation code manually</summary>
        <form
          action="/api/join/context"
          method="post"
          className="mt-4 space-y-4"
        >
          <label className="block">
            Invitation code (the text after # in your link)
            <input
              className="field"
              name="token"
              required
              maxLength={64}
              autoComplete="off"
            />
          </label>
          <button className="button">Open invitation</button>
        </form>
      </details>
    </>
  );
}
