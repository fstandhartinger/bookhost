import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/analytics/server";
import { analyticsReport } from "@/scripts/analytics-report.mjs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pilot analytics",
  robots: { index: false, follow: false },
};
export default async function StatsPage() {
  const session = await auth();
  if (!session?.user?.id || !isAdmin(session.user.email)) notFound();
  const operator = (
    await db.query("SELECT email,email_verified_at FROM users WHERE id=$1", [
      session.user.id,
    ])
  ).rows[0];
  if (!operator?.email_verified_at || !isAdmin(operator.email)) notFound();
  const report = await analyticsReport(db);
  function table(rows: Record<string, string | number>[], label: string) {
    const keys = [
      label,
      "visits",
      "demo_click",
      "checkout_start",
      "trial_started",
      "workspace_created",
      "intake_draft",
      "intake_published",
    ];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {keys.map((k) => (
                <th className="p-3" key={k}>
                  {k.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t" key={row[label]}>
                {keys.map((k) => (
                  <td className="p-3" key={k}>
                    {row[k]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No data yet.</p>}
      </div>
    );
  }
  return (
    <div className="py-12">
      <h1 className="text-3xl font-semibold">Pilot analytics</h1>
      <p className="my-4">
        Last 14 UTC days, including today. Visits are deduplicated per day and
        source. Counts are activity totals, not conversion cohorts. Privacy
        signals and browser blocking can reduce counts.
      </p>
      <h2 className="my-6 text-xl">By source</h2>
      {table(report.sources, "source")}
      <h2 className="my-6 text-xl">Daily totals</h2>
      {table(report.days, "day")}
    </div>
  );
}
