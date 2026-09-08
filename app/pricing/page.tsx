import { Pricing } from "@/components/pricing";
export const metadata = { title: "Pricing" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
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
