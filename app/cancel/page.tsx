import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { ActionButton } from "@/components/action-button";
export const metadata: Metadata = {
  title: "Cancel subscription / Vertrag kündigen",
  robots: { index: false, follow: true },
};
export default async function Cancel({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await auth();
  const withdrawal = (await searchParams).kind === "withdrawal";
  return (
    <section className="section mx-auto max-w-2xl">
      <p className="eyebrow">YOUR CONTRACT</p>
      <h1 className="!text-4xl">Cancel subscription / Vertrag kündigen</h1>
      <p className="lede">
        Cancel for the earliest possible date or exercise your right of
        withdrawal. You do not need an account login to use this form.
      </p>
      <div className="my-8 rounded-xl border border-ink/15 p-6">
        <h2 className="!text-xl">Manage your subscription</h2>
        <p className="my-4 text-sm">
          Signed-in customers can also cancel directly in the billing portal.
        </p>
        {session?.user ? (
          <ActionButton endpoint="/api/portal">Manage billing</ActionButton>
        ) : (
          <Link className="underline" href="/login">
            Log in to manage billing
          </Link>
        )}
      </div>
      <div className="mb-6 flex flex-wrap gap-4">
        <Link className="underline" href="/cancel">
          Verträge hier kündigen
        </Link>
        <Link className="underline" href="/cancel?kind=withdrawal">
          Vertrag widerrufen
        </Link>
      </div>
      <h2 className="!text-2xl">
        {withdrawal
          ? "Withdraw contract / Vertrag widerrufen"
          : "Cancel by form / Kündigungsformular"}
      </h2>
      <form action="/api/cancel" method="post" className="mt-6 grid gap-5">
        <label>
          Email / E-Mail *
          <input
            className="mt-2 w-full rounded-lg border p-3"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={session?.user?.email || ""}
          />
        </label>
        <label>
          Name (optional)
          <input
            className="mt-2 w-full rounded-lg border p-3"
            name="name"
            maxLength={2000}
            autoComplete="name"
          />
        </label>
        <label>
          Team or instance slug (optional)
          <input
            className="mt-2 w-full rounded-lg border p-3"
            name="team"
            maxLength={2000}
            placeholder="e.g. my-team"
          />
        </label>
        <input
          type="hidden"
          name="kind"
          value={withdrawal ? "withdrawal" : "cancel"}
        />
        <p>
          {withdrawal
            ? "I withdraw my contract. / Ich widerrufe meinen Vertrag."
            : "I cancel at the earliest possible date. / Ich kündige zum nächstmöglichen Termin."}
        </p>
        <label>
          Additional details (optional)
          <textarea
            className="mt-2 w-full rounded-lg border p-3"
            name="note"
            maxLength={2000}
            rows={3}
            placeholder="Contract reference, requested date, or reason for extraordinary cancellation"
          />
        </label>
        <p className="text-sm text-slate-600">
          We use these details to identify your contract and confirm your
          request. You will immediately receive a dated confirmation you can
          download. We will implement your request in the Stripe customer portal
          within 2 working days and confirm it by email.{" "}
          <Link className="underline" href="/legal/datenschutz">
            Privacy notice (German)
          </Link>
          .
        </p>
        <button className="button" type="submit">
          {withdrawal
            ? "Confirm withdrawal / Widerruf bestätigen"
            : "Cancel now / Jetzt kündigen"}
        </button>
      </form>
      <p className="mt-6 text-sm">
        You can also email{" "}
        <a className="underline" href="mailto:info@productivity-boost.com">
          info@productivity-boost.com
        </a>
        .{" "}
        <Link className="underline" href="/legal/agb">
          Terms and withdrawal rights (German)
        </Link>
        .
      </p>
    </section>
  );
}
