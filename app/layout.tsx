import AnalyticsBeacon from "@/lib/analytics/beacon";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
const inter = Inter({ subsets: ["latin"], display: "swap" });
export const metadata: Metadata = {
  title: {
    default: "Wissen — Hosted BookStack for Teams | €39/month",
    template: "%s · Wissen",
  },
  description:
    "Managed BookStack for teams at €39/month plus VAT. Daily backups, monthly cancellation and a 14-day free trial. No card required.",
  robots: { index: true, follow: true },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AnalyticsBeacon />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4"
        >
          Skip to content
        </a>
        <header className="border-b border-ink/10">
          <nav
            aria-label="Main navigation"
            className="shell flex min-h-20 items-center justify-between gap-4"
          >
            <Link
              href="/"
              className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"
            >
              <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-base text-white"
              >
                w
              </span>
              wissen<span className="text-moss">.</span>
            </Link>
            <div className="flex items-center gap-5 text-sm">
              <Link className="hover:underline" href="/pricing">
                Pricing
              </Link>
              <Link className="hover:underline" href="/login">
                Log in
              </Link>
              <Link
                className="hidden rounded-lg border border-ink/20 px-4 py-2 sm:block"
                href="/pricing"
              >
                Try Wissen ↗
              </Link>
            </div>
          </nav>
        </header>
        <main id="main" className="shell">
          {children}
        </main>
        <footer className="border-t border-ink/15 py-10">
          <div className="shell">
            <div className="flex flex-col justify-between gap-6 md:flex-row">
              <div>
                <Link href="/" className="text-xl font-semibold">
                  wissen.
                </Link>
                <p className="mt-2 text-sm text-slate-600">
                  A little less admin. A lot more shared knowledge.
                </p>
              </div>
              <nav aria-label="Legal" className="flex flex-wrap gap-5 text-sm">
                <Link href="/legal/impressum">Impressum</Link>
                <Link href="/legal/datenschutz">Datenschutz</Link>
                <Link href="/legal/agb">AGB</Link>
                <Link href="/legal/avv">AVV</Link>
                <Link href="/cancel">Cancel subscription</Link>
                <Link href="/cancel?kind=withdrawal">Withdraw contract</Link>
                <a href="mailto:info@productivity-boost.com">Contact</a>
              </nav>
            </div>
            <p className="mt-8 text-xs text-slate-500">
              © {new Date().getFullYear()} productivity-boost.com Betriebs UG
              (haftungsbeschränkt) &amp; Co. KG · Passau, Germany
              <br />
              Wissen is an independent hosting service. BookStack is an
              open-source project; we are not affiliated with its maintainers.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
