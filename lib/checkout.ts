import type Stripe from "stripe";
export function checkoutParams({
  price,
  url,
  email,
  customer,
  teamId,
  utmSource,
  noAnalytics,
}: {
  price: string;
  url: string;
  email?: string;
  customer?: string;
  teamId?: string;
  utmSource?: string | null;
  noAnalytics?: boolean;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: {
        ...(utmSource ? { utm_source: utmSource } : {}),
        ...(noAnalytics ? { no_analytics: "1" } : {}),
        venture: "wissen",
        ...(teamId ? { team_id: teamId } : {}),
      },
    },
    payment_method_collection: "if_required",
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    ...(customer
      ? { customer_update: { name: "auto" as const, address: "auto" as const } }
      : {}),
    ...(customer ? { customer } : email ? { customer_email: email } : {}),
    success_url: `${url}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url}/pricing?canceled=1`,
    metadata: {
      ...(utmSource ? { utm_source: utmSource } : {}),
      ...(noAnalytics ? { no_analytics: "1" } : {}),
      venture: "wissen",
      ...(teamId ? { team_id: teamId } : {}),
    },
  };
}
