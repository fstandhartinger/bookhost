import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy · Wissen",
  description:
    "Privacy policy for Wissen, the hosted BookStack service by productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG, Passau, Germany.",
  alternates: { canonical: "https://wissen.app.mintapis.com/privacy" },
};

export default function Privacy() {
  return (
    <section className="legal-wrapper">
      <div className="legal-intro" lang="en">
        <h1>Privacy Policy</h1>
        <p>
          Wissen is operated by productivity-boost.com Betriebs UG (haftungsbeschränkt) &amp; Co. KG,
          Reichenbergerstr. 2, 94036 Passau, Germany (contact: info@productivity-boost.com). We process
          the data needed to run your account and workspace: your e-mail address, password hash,
          billing details handled by Stripe, optional Google sign-in profile data, documents you
          upload for reviewed intake (processed by an AI provider on your request), cookieless
          usage statistics, and server logs. We do not sell personal data. You can request access,
          correction, export or deletion at any time. The German text below is the legally binding
          version of this policy (Datenschutzerklärung).
        </p>
      </div>
      <LegalDocument name="datenschutz" />
    </section>
  );
}
