import { smtpReady } from "@/lib/config";
import { PasswordForm, ResetRequestForm } from "@/components/password-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <section className="mx-auto max-w-md py-20">
      <h1 className="text-4xl">Reset your password</h1>
      {smtpReady() ? (
        token ? (
          <PasswordForm resetToken={token} />
        ) : (
          <ResetRequestForm />
        )
      ) : (
        <p className="mt-6 leading-7">
          Password reset by email will be available once email delivery is
          enabled. For help accessing your account, contact{" "}
          <a className="underline" href="mailto:info@productivity-boost.com">
            info@productivity-boost.com
          </a>
          .
        </p>
      )}
      <a className="mt-8 block underline" href="/login">
        Back to sign in
      </a>
    </section>
  );
}
