import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { billingEligible, billingNotice } from "@/lib/trial";
import { BillingNotice } from "@/components/billing-notice";

it("keeps a marked showcase usable after its synthetic trial date", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const expiredShowcase = {
    status: "trialing",
    trial_end: new Date("2026-09-26T12:00:00Z"),
    current_period_end: null,
    is_showcase: true,
    desired_state: "running",
  };

  expect(billingEligible(expiredShowcase, now)).toBe(true);
  expect(billingNotice(expiredShowcase, now)).toMatchObject({
    kind: "showcase",
    action: "none",
    urgent: false,
  });
  expect(
    renderToStaticMarkup(
      createElement(BillingNotice, { subscription: expiredShowcase }),
    ),
  ).toBe("");
});
