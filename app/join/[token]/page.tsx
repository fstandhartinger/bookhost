import { auth } from "@/auth";
import { getInvite, inviteProblem } from "@/lib/team";
import { JoinForm } from "@/components/join-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Join your team",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Join({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInvite(token);
  const problem = inviteProblem(invite);
  const session = await auth();
  return (
    <section className="mx-auto max-w-lg py-16">
      <div className="price-card">
        <h1 className="text-3xl">
          {problem ? "Invitation unavailable" : `Join ${invite.name}`}
        </h1>
        {problem ? (
          <p className="mt-4">{problem} Ask your team admin for a new link.</p>
        ) : (
          <>
            <p className="mt-4">
              You’ve been invited as a <strong>{invite.role}</strong>. Join to
              access your team’s workspace and document intake.
            </p>
            <JoinForm token={token} email={session?.user?.email} />
          </>
        )}
      </div>
    </section>
  );
}
