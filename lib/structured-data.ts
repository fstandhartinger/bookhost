import { readFileSync } from "node:fs";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { PLAN, PRODUCT_NAME, PUBLIC_BASE_URL } from "@/lib/config";
import { faqs } from "@/lib/landing-copy";
import { PRODUCT_DESCRIPTION } from "@/lib/metadata";

/** The published Impressum remains the single source for the operator. */
export function organization() {
  const impressum = readFileSync(
    path.join(process.cwd(), "content/legal/impressum.md"),
    "utf8",
  );
  const operator = impressum.match(
    /\n([^\n]+) {2}\r?\n([^\n]+) {2}\r?\n(\d{5}) ([^\n]+) {2}\r?\nDeutschland(?:\r?\n|$)/,
  );
  if (!operator) throw new Error("Cannot read operator address from Impressum");
  return {
    "@type": "Organization",
    name: PRODUCT_NAME,
    legalName: operator[1].trim(),
    url: PUBLIC_BASE_URL,
    address: {
      "@type": "PostalAddress",
      streetAddress: operator[2].trim(),
      postalCode: operator[3],
      addressLocality: operator[4].trim(),
      addressCountry: "DE",
    },
  };
}

const plainText = (value: string) =>
  sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });

// The offer belongs on the page a price search leads to as well, so the
// application entity is built once and used by the home and the pricing page.
export function softwareApplication() {
  const provider = organization();
  return {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: PRODUCT_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: PUBLIC_BASE_URL,
      description: PRODUCT_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: PLAN.price,
        priceCurrency: PLAN.currency,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PLAN.price,
          priceCurrency: PLAN.currency,
          // The visible pricing section says "plus applicable VAT".
          valueAddedTaxIncluded: false,
          billingIncrement: 1,
          unitCode: "MON",
          unitText: "month",
          referenceQuantity: {
            "@type": "QuantitativeValue",
            value: 1,
            unitCode: "MON",
          },
        },
      },
      provider,
      publisher: provider,
  };
}

export function homeStructuredData() {
  return [
    softwareApplication(),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map(([question, answer]) => ({
        "@type": "Question",
        name: plainText(question),
        acceptedAnswer: { "@type": "Answer", text: plainText(answer) },
      })),
    },
  ];
}
