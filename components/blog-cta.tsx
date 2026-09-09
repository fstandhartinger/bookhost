import Link from "next/link";

export default function BlogCta() {
  return (
    <aside
      aria-label="Try Wissen"
      className="mt-12 rounded-2xl border border-ink/15 bg-white p-6 sm:p-8"
    >
      <h2 className="text-2xl md:text-3xl">
        A home for your team’s knowledge.
      </h2>
      <p className="mt-4 leading-relaxed text-slate-600">
        Hosted BookStack with reviewed document intake in beta. Team is
        €39/month plus applicable VAT, for up to 25 users and 5 GB of uploads.
        Try it for 14 days without a card.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-5">
        <Link className="button" href="/pricing">
          Start your 14-day trial
        </Link>
        <a
          className="text-sm font-semibold text-moss underline"
          href="https://demo.wissen.app.mintapis.com"
        >
          Explore the public demo ↗
        </a>
      </div>
    </aside>
  );
}
