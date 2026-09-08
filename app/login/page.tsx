import { auth, signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { smtpReady } from "@/lib/config";
import { ActionButton } from "@/components/action-button";
export const metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; checkout?: string }>;
}) {
  if (await auth()) redirect("/app");
  const params = await searchParams;
  const emailEnabled = smtpReady() || process.env.NODE_ENV !== "production";
  return (
    <section className="mx-auto max-w-md py-20">
      <p className="eyebrow">WELCOME BACK</p>
      <h1 className="text-4xl">Your knowledge starts here.</h1>
      <p className="mt-5 text-slate-600">
        Sign in to manage your team and workspace.
      </p>
      {params.sent && (
        <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm">
          Check your inbox for a sign-in link. It expires in 15 minutes.
        </p>
      )}
      {params.error && (
        <p role="alert" className="error mt-6">
          We couldn’t sign you in. Request a fresh link, or try your original
          sign-in method.
        </p>
      )}
      {params.checkout && (
        <p role="status" className="mt-6 rounded-lg bg-amber-50 p-4 text-sm">
          {params.checkout === "existing" ? (
            "You already have a workspace — sign in"
          ) : (
            <>
              This checkout link has already been used, expired, or belongs to
              another browser. Sign in below to continue. If you used an
              existing account’s email, sign in to that account.
            </>
          )}
        </p>
      )}
      {emailEnabled ? (
        <form
          className="mt-8"
          action={async (data: FormData) => {
            "use server";
            const email = String(data.get("email") || "")
              .trim()
              .toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)
              redirect("/login?error=email");
            try {
              await signIn("nodemailer", { email, redirectTo: "/app" });
            } catch (error) {
              if (error instanceof AuthError) redirect("/login?error=email");
              throw error;
            }
          }}
        >
          <label htmlFor="email" className="text-sm font-medium">
            Work email
          </label>
          <input
            required
            type="email"
            autoComplete="email"
            name="email"
            id="email"
            placeholder="you@company.com"
            className="field"
            maxLength={254}
          />
          <button className="button mt-4 w-full">
            Email me a sign-in link
          </button>
        </form>
      ) : (
        <div className="mt-8 rounded-xl border border-ink/15 bg-white p-6">
          <label htmlFor="email" className="text-sm font-medium">
            Work email
          </label>
          <input
            id="email"
            type="email"
            disabled
            className="field"
            placeholder="Email sign-in coming soon"
          />
          <p className="mt-4 text-sm leading-6">
            Email sign-in is being set up — start a free trial below and
            you&apos;re signed in right away.
          </p>
          <div className="mt-5">
            <ActionButton />
          </div>
          <p className="mt-4 text-xs text-slate-600">
            Already have an account? Contact{" "}
            <a className="underline" href="mailto:info@productivity-boost.com">
              support
            </a>{" "}
            for access.
          </p>
        </div>
      )}
      {process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && (
        <form
          className="mt-4"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/app" });
          }}
        >
          <button className="button-secondary w-full">
            Sign in with Google
          </button>
        </form>
      )}
      <p className="mt-8 text-center text-xs text-slate-500">
        Secure sign-in. No password to remember.
      </p>
    </section>
  );
}
