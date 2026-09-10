import { Pricing } from "@/components/pricing";
import { JsonLd } from "@/components/json-ld";
import { softwareApplication } from "@/lib/structured-data";
export const metadata = {
  title: "Pricing",
  description:
    "One plan for hosted BookStack: €39/month plus VAT, 14 days free without a card. Includes up to 25 dashboard members, 5 GB of uploads and 300 drafts per calendar month.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "BookHost pricing — €39/month, 14 days free",
    description:
      "One plan for hosted BookStack, billed monthly and cancellable at any time. 14 days free without a card.",
    url: "/pricing",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      {/* A price search lands here, so the offer has to be marked up here too. */}
      <JsonLd data={softwareApplication()} />
      {params.canceled && (
        <p role="status" className="mt-8 rounded-lg bg-amber-50 p-4 text-sm">
          Checkout was canceled. No payment was taken. You can start again
          below.
        </p>
      )}
      <Pricing />
    </>
  );
}
