// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import AnalyticsBeacon from "@/lib/analytics/beacon";
import { resetAttributionForTests } from "@/lib/analytics/attribution";

let container: HTMLDivElement;
let root: Root;
const beacon = vi.fn(() => true);
const originalFetch = window.fetch;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beacon,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    value: "0",
  });
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: false,
  });
  window.history.replaceState({}, "", "/?utm_source=landing-test");
  resetAttributionForTests();
  beacon.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.fetch = originalFetch;
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(React.createElement(AnalyticsBeacon)));
}
async function payloads() {
  return Promise.all(
    beacon.mock.calls.map(async (args) =>
      JSON.parse(await (args as unknown as [string, Blob])[1].text()),
    ),
  );
}
it("counts nested CTA clicks once, validates positions and keeps demo counting", async () => {
  await mount();
  container.insertAdjacentHTML(
    "beforeend",
    '<button data-trial-position="hero"><span>Trial</span></button><a href="/pricing" data-trial-position="nav"><span>Nav</span></a><a href="/pricing" data-trial-position="footer"><span>Footer</span></a><button data-trial-position="pricing_teaser"><span>Pricing</span></button><button data-trial-position="secret@example.com">Invalid</button><a href="https://demo.bookhost.co"><span>Demo</span></a>',
  );
  for (const element of container.querySelectorAll(
    "button span, a span, button[data-trial-position='secret@example.com']",
  )) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  const events = await payloads();
  expect(events.filter((event) => !event.name)).toHaveLength(1);
  expect(
    events
      .filter((event) => event.name === "checkout_start")
      .map((event) => event.position),
  ).toEqual(["hero", "nav", "footer", "pricing_teaser"]);
  expect(events.filter((event) => event.name === "demo_click")).toHaveLength(1);
  expect(events.every((event) => event.utm_source === "landing-test")).toBe(
    true,
  );
});
it.each(["doNotTrack", "globalPrivacyControl"])(
  "suppresses page and click beacons for %s",
  async (signal) => {
    Object.defineProperty(navigator, signal, {
      configurable: true,
      value: signal === "doNotTrack" ? "1" : true,
    });
    await mount();
    container.insertAdjacentHTML(
      "beforeend",
      '<button data-trial-position="hero">Trial</button>',
    );
    container
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(beacon).not.toHaveBeenCalled();
  },
);
it("does not count disabled buttons or keep listeners after unmount", async () => {
  await mount();
  beacon.mockClear();
  container.insertAdjacentHTML(
    "beforeend",
    '<button data-trial-position="hero" disabled><span>Busy</span></button>',
  );
  container
    .querySelector("span")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(beacon).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  container.querySelector("button")!.disabled = false;
  container
    .querySelector("span")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(beacon).not.toHaveBeenCalled();
});
