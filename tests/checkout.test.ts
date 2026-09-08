import { describe, it, expect } from "vitest";
import { checkoutParams } from "../lib/checkout";
describe("Checkout parameters", () => {
  it("starts a no-card trial with correct return URLs", () => {
    const p = checkoutParams({
      price: "price_team",
      url: "https://wissen.example",
    });
    expect(p.mode).toBe("subscription");
    expect(p.line_items).toEqual([{ price: "price_team", quantity: 1 }]);
    expect(p.payment_method_collection).toBe("if_required");
    expect(p.subscription_data?.trial_period_days).toBe(14);
    expect(
      p.subscription_data?.trial_settings?.end_behavior.missing_payment_method,
    ).toBe("cancel");
    expect(p.success_url).toBe(
      "https://wissen.example/welcome?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(p.cancel_url).toBe("https://wissen.example/pricing?canceled=1");
    expect(p.allow_promotion_codes).toBe(true);
    expect(p.metadata).toEqual({ venture: "wissen" });
  });
  it("reuses customers without sending customer_email", () => {
    const p = checkoutParams({
      price: "p",
      url: "https://x",
      email: "a@b.com",
      customer: "cus_1",
      teamId: "team1",
    });
    expect(p.customer).toBe("cus_1");
    expect(p).not.toHaveProperty("customer_email");
    expect(p.subscription_data?.metadata?.team_id).toBe("team1");
  });
  it("supports a new customer email", () =>
    expect(
      checkoutParams({ price: "p", url: "https://x", email: "a@b.com" })
        .customer_email,
    ).toBe("a@b.com"));
});
