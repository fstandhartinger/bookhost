import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service · BookHost",
  description:
    "Terms of service for BookHost, the hosted BookStack service by productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG, Passau, Germany.",
  alternates: { canonical: "https://bookhost.co/terms" },
};

export default function Terms() {
  return (
    <section className="legal-wrapper">
      <div className="legal-intro" lang="en">
        <h1>Terms of Service</h1>
        <p>
          BookHost provides a hosted BookStack workspace per team for €39 per month plus applicable
          VAT, starting with a 14-day free trial that needs no card and ends automatically unless a
          payment method is added. Subscriptions renew monthly and can be cancelled any time in the
          billing portal or via <a href="/cancel">/cancel</a>. You keep ownership of your content and
          can export it from BookStack at any time. The service is offered by productivity-boost.com
          Betriebs UG (haftungsbeschränkt) &amp; Co. KG, Passau, Germany. The German text below
          (Allgemeine Geschäftsbedingungen) is the legally binding version.
        </p>
      </div>
      <LegalDocument name="agb" />
    </section>
  );
}
