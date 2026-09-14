import type Stripe from "stripe";
// stripe-node 18.5 types lack branding_settings (added upstream in 19.0.0).
type BrandedSessionCreateParams = Stripe.Checkout.SessionCreateParams & {
  branding_settings?: { display_name?: string };
};
export function checkoutParams({
  price,
  url,
  email,
  customer,
  teamId,
  utmSource,
  noAnalytics,
  resume = false,
}: {
  price: string;
  url: string;
  email?: string;
  customer?: string;
  teamId?: string;
  utmSource?: string | null;
  noAnalytics?: boolean;
  resume?: boolean;
}): BrandedSessionCreateParams {
  return {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      ...(process.env.STRIPE_TAX_RATE_DE
        ? { default_tax_rates: [process.env.STRIPE_TAX_RATE_DE] }
        : {}),
      ...(!resume
        ? {
            trial_period_days: 14,
            trial_settings: {
              end_behavior: { missing_payment_method: "cancel" as const },
            },
          }
        : {}),
      metadata: {
        ...(utmSource ? { utm_source: utmSource } : {}),
        ...(noAnalytics ? { no_analytics: "1" } : {}),
        venture: "wissen",
        ...(teamId ? { team_id: teamId } : {}),
      },
    },
    // The Stripe account is shared with our other products, so its name in the
    // Checkout header is not the one the visitor just read on our site.
    // display_name fixes only that header (receipts keep the account name);
    // saying who operates BookHost removes the surprise at the moment of payment.
    branding_settings: { display_name: "BookHost" },
    custom_text: {
      submit: {
        message:
          "BookHost is operated by productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG, Passau, Germany.",
      },
    },
    payment_method_collection: "if_required",
    allow_promotion_codes: true,
    billing_address_collection: "required",
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
