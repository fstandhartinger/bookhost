import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy · BookHost",
  description:
    "Privacy policy for BookHost, the hosted BookStack service by productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG, Passau, Germany.",
  alternates: { canonical: "https://bookhost.co/privacy" },
};

export default function Privacy() {
  return (
    <section className="legal-wrapper">
      <div className="legal-intro" lang="en">
        <h1>Privacy Policy</h1>
        <p>
          BookHost is operated by productivity-boost.com Betriebs UG (haftungsbeschränkt) &amp; Co. KG,
          Reichenbergerstr. 2, 94036 Passau, Germany (contact: info@productivity-boost.com). We process
          the data needed to run your account and workspace: your e-mail address, password hash,
          billing details handled by Stripe, optional Google sign-in profile data, documents you
          upload for reviewed intake (processed by an AI provider on your request), first-party
          visitor statistics without cookies or device storage (see below), and server logs. We do
          not sell personal data. You can request access,
          correction, export or deletion at any time. The German text below is the legally binding
          version of this policy (Datenschutzerklärung).
        </p>
        <h2 id="visitor-statistics">Visitor statistics (Reichweitenmessung)</h2>
        <p>
          We measure aggregate usage of our own offer with first-party visitor statistics. For
          whitelisted public page views we record the page path without query strings, the
          referring site reduced to its domain, and sanitized UTM campaign labels (source, medium,
          campaign). We also count events: demo clicks, checkout starts, successful trials, the
          first paid invoice of a team without its amount, workspaces created, and document drafts
          created or published — never document contents. No cookies and no browser or device
          storage are used for statistics. Daily deduplication uses an in-memory-only hash with a
          random per-day salt; the IP address and browser identifier are never stored, and the
          salt is discarded at the latest at the next UTC day change, so visitors cannot be
          tracked across days. Page views by automated programs (headless browsers, crawlers, CLI
          clients) and views without a browser identifier are discarded. Raw rows are deleted
          after 90 days. You can object via the Do Not Track or Global Privacy Control browser
          signals, which suppress the measurement, or by email to info@productivity-boost.com.
          In our assessment this measurement does not require consent under § 25 TDDDG. The legal
          basis is our legitimate interest in improving our offer (Art. 6(1)(f) GDPR).
        </p>
      </div>
      <LegalDocument name="datenschutz" />
    </section>
  );
}
