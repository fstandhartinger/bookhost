import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { DRAFT_COPY } from "@/lib/quotas";
import { homeStructuredData } from "@/lib/structured-data";
import { PLAN } from "@/lib/config";

afterEach(() => vi.unstubAllGlobals());

it("preserves structured data and shows canonical limits once in visible home copy", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(React.createElement(Home));
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  expect(visible.split(DRAFT_COPY)).toHaveLength(2);
  expect(visible).toContain(`€${PLAN.price}/month plus VAT`);
  expect(visible).toContain(`${PLAN.trialDays} days free`);
  expect(visible).toContain("No card required");
  expect(visible).toContain("small IT teams and agencies");
  expect(visible).toContain("DPA annex 3");
  expect(visible).toContain("Amazing AI Apps");
  const data = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )?.[1];
  expect(JSON.parse(data!)).toEqual(homeStructuredData());
});
