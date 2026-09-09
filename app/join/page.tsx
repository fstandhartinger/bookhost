import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getInvite, inviteProblem } from "@/lib/team";
import { JOIN_COOKIE } from "@/lib/join-context";
import { JoinForm } from "@/components/join-form";
import { JoinContext } from "@/components/join-context";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Join your team",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Join() {
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  const invite = token ? await getInvite(token) : undefined;
  const problem = token ? inviteProblem(invite) : null;
  const session = await auth();
  return (
    <section className="mx-auto max-w-lg py-16">
      <div className="price-card">
        <h1 className="text-3xl">
          {invite && !problem ? `Join ${invite.name}` : "Join your team"}
        </h1>
        {problem && (
          <p className="mt-4">{problem} Ask your team admin for a new link.</p>
        )}
        {invite && !problem && (
          <>
            <p className="mt-4">
              You’ve been invited as a <strong>{invite.role}</strong>.
            </p>
            <JoinForm email={session?.user?.email} />
          </>
        )}
        {!token && (
          <p className="mt-4">
            Open your invitation link or enter its code below.
          </p>
        )}
        <JoinContext />
      </div>
    </section>
  );
}
