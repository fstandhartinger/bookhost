import { loginDestination } from "@/lib/join-context";
import { auth, signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { smtpReady } from "@/lib/config";
import { PasswordLogin } from "@/components/password-login";
export const metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    error?: string;
    checkout?: string;
    reset?: string;
  }>;
}) {
  const destination = await loginDestination();
  if (await auth()) redirect(destination);
  const params = await searchParams;
  const emailEnabled = smtpReady();
  return (
    <section className="mx-auto max-w-md py-20">
      <p className="eyebrow">WELCOME BACK</p>
      <h1 className="text-4xl">Your knowledge starts here.</h1>
      <p className="mt-5 text-slate-600">
        Sign in to manage your team and workspace.
      </p>
      <p className="mt-5 rounded-lg bg-[#e8edde] p-4 text-sm">
        New to BookHost?{" "}
        <a className="font-medium underline" href="/pricing#trial">
          Start your free 14-day trial — no card needed.
        </a>
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
      {params.reset && (
        <p role="status" className="mt-4">
          Password reset. Sign in with your new password.
        </p>
      )}
      {emailEnabled && (
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
              await signIn("nodemailer", {
                email,
                redirectTo: await loginDestination(),
              });
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
      )}
      {process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && (
        <form
          className="mt-4"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: await loginDestination() });
          }}
        >
          <button className="button-secondary w-full">
            Sign in with Google
          </button>
        </form>
      )}
      <p className="mt-6 text-sm text-slate-600">
        Set a password later from your dashboard; you can always sign in with an
        e-mailed link or Google.
      </p>
      <PasswordLogin destination={destination} />
      <p className="mt-8 text-center text-xs text-slate-500">
        Secure access to your BookHost dashboard.
      </p>
    </section>
  );
}
