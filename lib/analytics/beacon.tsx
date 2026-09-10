"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { parseUtm, publicPath } from "./shared";
const storageKey = "wissen-attribution";
// Any workspace domain: the public demo is always the "demo." subdomain.
const isDemoHost = (host: string) =>
  host === demoLegacyHost || host.startsWith("demo.");
const demoLegacyHost = "demo.wissen.app.mintapis.com";

function disabled() {
  return (
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}
function attribution() {
  if (disabled()) {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    return {};
  }
  const current = parseUtm(new URLSearchParams(location.search));
  try {
    if (current.utm_source)
      sessionStorage.setItem(storageKey, JSON.stringify(current));
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return current.utm_source ? current : saved || current;
  } catch {
    return current;
  }
}
export default function AnalyticsBeacon() {
  const path = usePathname();
  useEffect(() => {
    const send = (name?: string) => {
      if (disabled() || !publicPath(location.pathname)) return;
      navigator.sendBeacon(
        "/api/track",
        new Blob(
          [
            JSON.stringify({
              path: location.pathname,
              referrer: document.referrer,
              ...attribution(),
              ...(name ? { name } : {}),
            }),
          ],
          { type: "application/json" },
        ),
      );
    };
    send();
    const click = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        anchor &&
        isDemoHost(new URL(anchor.href).hostname)
      )
        send("demo_click");
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [path]);
  useEffect(() => {
    // Existing checkout buttons use fetch; decorate only this same-origin endpoint.
    const original = window.fetch;
    const wrapped: typeof fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (url.origin === location.origin && url.pathname === "/api/checkout") {
        const headers = new Headers(
          init?.headers ||
            (input instanceof Request ? input.headers : undefined),
        );
        if (disabled()) headers.set("x-wissen-no-analytics", "1");
        else {
          const source = attribution().utm_source;
          if (source) headers.set("x-wissen-utm-source", source);
        }
        return original(input, { ...init, headers });
      }
      return original(input, init);
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);
  return null;
}
