"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { publicPath } from "./shared";
import { attributionFor } from "./attribution";
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
// Attribution lives only in the memory of the open page: it survives
// client-side (SPA) navigations and is gone after a full reload. Nothing is
// stored on the device for statistics.
function attribution() {
  return attributionFor(location.search, disabled());
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
