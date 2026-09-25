import { PRODUCT_DESCRIPTION } from "@/lib/metadata";
import AnalyticsBeacon from "@/lib/analytics/beacon";
import HeaderAccountLinks from "@/components/header-account-links";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle, THEME_SCRIPT } from "@/components/theme-toggle";
import { guides } from "@/lib/guides";
import { DEMO_URL } from "@/lib/config";
import { PRODUCT_NAME, PUBLIC_BASE_URL } from "@/lib/config";
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} — Managed BookStack hosting for teams`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  metadataBase: new URL(PUBLIC_BASE_URL),
  alternates: { canonical: "./" },
  // Ownership proof for Google Search Console. Not a secret; it must stay in
  // place or the property loses its verification.
  verification: {
    google:
      process.env.GOOGLE_SITE_VERIFICATION ||
      "zD0UR835omd9e1sn_LPETAddu4sJLQPxVMNlfFQtC1g",
    other: {
      "msvalidate.01":
        process.env.BING_SITE_VERIFICATION ||
        "A10068AB02B05DAA5C1E1C0915123CFD",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: PUBLIC_BASE_URL,
    siteName: PRODUCT_NAME,
    title: "Your team’s BookStack. Hosting handled.",
    description:
      "Managed BookStack hosting in the EU: updates, daily backups and restore help included. 14 days free, no card required; then €39/month plus VAT.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "BookHost: your team’s BookStack, hosting handled. Managed BookStack hosting in the EU.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BookHost — Managed BookStack hosting for teams",
    description:
      "Your team’s BookStack, hosted in the EU. Updates, daily backups and restore help included. 14 days free, no card required.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1211" },
  ],
};
function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className="h-8 w-8 shrink-0">
      <rect width="64" height="64" rx="15" className="fill-ink" />
      <path
        d="M17 18h11c12 0 19 5 19 14s-7 14-19 14h-4v-8h4c6 0 10-2 10-6s-4-6-10-6h-3v20h-8z"
        className="fill-paper"
      />
    </svg>
  );
}
const footerColumns: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["/#features", "Features"],
      ["/pricing", "Pricing"],
      [DEMO_URL, "Live demo"],
      ["/migrate", "Move your BookStack"],
    ],
  ],
  [
    "Guides",
    [
      ...guides.map((g): [string, string] => [`/${g.slug}`, g.short]),
      ["/blog", "Blog"],
    ],
  ],
  [
    "Legal",
    [
      ["/legal/impressum", "Impressum"],
      ["/legal/datenschutz", "Datenschutz"],
      ["/legal/agb", "AGB"],
      ["/legal/avv", "AVV"],
      ["/cancel", "Cancel subscription"],
      ["/cancel?kind=withdrawal", "Withdraw contract"],
    ],
  ],
];
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <AnalyticsBeacon />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-white focus:p-4"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-ink/[.07] bg-paper/80 backdrop-blur-xl backdrop-saturate-150">
          <nav
            aria-label="Main navigation"
            className="shell flex h-16 items-center justify-between gap-3"
          >
            <Link
              href="/"
              aria-label="BookHost home"
              className="flex items-center gap-2.5 text-lg font-semibold tracking-[-.03em]"
            >
              <Logo />
              <span>
                bookhost<span className="text-moss">.</span>
              </span>
            </Link>
            <div className="hidden items-center gap-7 text-sm text-muted md:flex">
              <Link href="/#features" className="transition hover:text-ink">
                Features
              </Link>
              <Link href="/migrate" className="transition hover:text-ink">
                Migrate
              </Link>
              <Link href="/bookstack-vs-confluence" className="transition hover:text-ink">
                Guides
              </Link>
              <Link href="/blog" className="transition hover:text-ink">
                Blog
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm sm:gap-4">
              <ThemeToggle />
              <HeaderAccountLinks
                callToAction={
                  <Link
                    href="/pricing"
                    className="whitespace-nowrap rounded-full bg-ink px-4 py-2 font-medium text-white transition hover:bg-moss"
                  >
                    <span className="sm:hidden">Try free</span>
                    <span className="hidden sm:inline">Start free trial</span>
                  </Link>
                }
              />
            </div>
          </nav>
        </header>
        <main id="main" className="shell">
          {children}
        </main>
        <footer className="mt-12 border-t border-ink/10 bg-sunken/60 py-14">
          <div className="shell">
            <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1.3fr_1fr]">
              <div>
                <Link
                  href="/"
                  className="flex items-center gap-2.5 text-lg font-semibold tracking-[-.03em]"
                >
                  <Logo />
                  <span>
                    bookhost<span className="text-moss">.</span>
                  </span>
                </Link>
                <p className="mt-4 max-w-xs text-sm leading-6 text-muted">
                  Managed BookStack hosting for teams. Hosted on Hetzner
                  infrastructure in Germany or Finland.
                </p>
                <a
                  href="mailto:info@productivity-boost.com"
                  className="mt-4 inline-block text-sm text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
                >
                  info@productivity-boost.com
                </a>
                <Link
                  href="/reliability"
                  className="mt-2 block text-sm text-muted transition hover:text-ink"
                >
                  Backups, reliability and current limits
                </Link>
              </div>
              {footerColumns.map(([heading, links]) => (
                <nav key={heading} aria-label={heading}>
                  <p className="text-xs font-semibold uppercase tracking-[.14em] text-faint">
                    {heading}
                  </p>
                  <ul className="mt-4 space-y-2.5 text-sm">
                    {links.map(([href, label]) => (
                      <li key={href}>
                        {href.startsWith("http") ? (
                          <a href={href} className="text-muted transition hover:text-ink">
                            {label}
                          </a>
                        ) : (
                          <Link href={href} className="text-muted transition hover:text-ink">
                            {label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <p className="mt-12 border-t border-ink/10 pt-6 text-xs leading-5 text-faint">
              © {new Date().getFullYear()} productivity-boost.com Betriebs UG
              (haftungsbeschränkt) &amp; Co. KG · Passau, Germany
              <br />
              BookHost is an independent hosting service. BookStack is an
              open-source project; we are not affiliated with its maintainers.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
