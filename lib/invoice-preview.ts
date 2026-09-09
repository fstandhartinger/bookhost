import { unstable_cache } from "next/cache";
import { stripeClient } from "./stripe";
// Both successful previews and the honest fallback are cached for ten minutes.
export const invoicePreview = unstable_cache(
  async (subscription: string): Promise<string | null> => {
    try {
      const invoice = await stripeClient().invoices.createPreview({
        subscription,
      });
      return new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: invoice.currency,
      }).format(invoice.amount_due / 100);
    } catch {
      return null;
    }
  },
  ["billing-invoice-preview"],
  { revalidate: 600 },
);
