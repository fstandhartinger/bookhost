import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
export default async function BillingPage() {
  if (!(await auth())?.user?.id)
    redirect("/login?callbackUrl=%2Fapp%2Fbilling");
  return (
    <section className="py-14">
      <h1 className="text-3xl">Manage billing</h1>
      <p className="my-5">
        Update your payment method securely in the billing portal.
      </p>
      <ActionButton endpoint="/api/portal">Open billing portal</ActionButton>
    </section>
  );
}
