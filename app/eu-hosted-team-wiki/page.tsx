import type { Metadata } from "next";
import Link from "next/link";
import { GuideFaq, GuidePage, GuideSources } from "@/components/guide-page";
import { JsonLd } from "@/components/json-ld";
import {
  GUIDE_REVIEWED,
  guide,
  guideJsonLd,
  guideMetadata,
  relatedLinks,
  type Faq,
} from "@/lib/guides";

const slug = "eu-hosted-team-wiki";
export const metadata: Metadata = guideMetadata(slug);

const faqs: Faq[] = [
  {
    question: "Does using BookHost take care of GDPR for us?",
    answer:
      "No provider can make your use of a wiki compliant on your behalf; you remain the controller for what your team stores. BookHost offers a data processing agreement under Art. 28 GDPR, core hosting and backups at Hetzner in Germany or Finland, and a published list of service providers. Our descriptions of processing are not a legal assessment.",
  },
  {
    question: "Does any data leave the EU with BookHost?",
    answer:
      "Wiki content and backups at Hetzner are processed in Germany and Finland. Stripe payments and optional Google sign-in can involve international processing, and transactional email is sent through Resend Inc. (USA) with EU data processing under standard contractual clauses. The AI betas use TensorX in Ireland and should only be used with non-personal content for now.",
  },
  {
    question: "Where are BookHost backups stored?",
    answer:
      "Daily encrypted backups are stored on Hetzner infrastructure in Germany or Finland. Today they live on the same server as the workspaces; a copy at a second location is in preparation and not yet in operation.",
  },
  {
    question: "What happens to our wiki when we cancel?",
    answer:
      "You keep normal access until the end of the billing period, so export what you need first. Active instance data is deleted within 30 days after the contract ends, and protected backup copies expire within a further seven days. Earlier deletion can be requested.",
  },
];

const sources = [
  { href: "https://eur-lex.europa.eu/eli/reg/2016/679/oj", label: "EUR-Lex: General Data Protection Regulation (EU) 2016/679" },
  { href: "https://www.hetzner.com/unternehmen/rechenzentrum/", label: "Hetzner: data center locations" },
  { href: "https://tensorx.ai/sub-processors", label: "TensorX: sub-processor list" },
  { href: "https://www.bookstackapp.com/", label: "BookStack: project homepage" },
];

export default function EuHostedTeamWikiPage() {
  const { title } = guide(slug);
  return (
    <>
      <JsonLd data={guideJsonLd(slug, faqs)} />
      <GuidePage
        eyebrow="GUIDE · DATA PROTECTION"
        title={title}
        lede="A team wiki ends up holding names, customer details, internal procedures and sometimes passwords that should not be there. If you are in the EU, where that data sits and who can touch it matters. These are the questions to ask any provider, with BookHost’s own answers as a worked example."
        updated={GUIDE_REVIEWED}
        related={relatedLinks(slug)}
      >
        <h2>“EU-hosted” is only the start</h2>
        <p>
          Many services say they host in the EU. That usually describes where
          the main servers are. It says nothing about the payment provider, the
          email service, the support tool, the AI feature or where backups are
          copied. Under the GDPR, a wiki provider that stores your content on
          your behalf is a processor, and you need to know the whole chain.
        </p>
        <p>
          This page is practical guidance, not legal advice. For a formal
          assessment, involve your data protection officer or a lawyer.
        </p>

        <h2>Six things to check</h2>

        <h3>1. Where the wiki and its database run</h3>
        <p>
          Ask for the hosting company and the countries, not just “Europe”. A
          provider that names its infrastructure partner and locations is
          easier to assess than one that does not.
        </p>

        <h3>2. A data processing agreement you can read</h3>
        <p>
          Art. 28 GDPR requires a contract between you and any processor. Look
          for a document you can download before you sign up, not one you have
          to request after paying. Check that it covers instructions,
          confidentiality, security measures, help with data subject requests,
          breach notification, and return or deletion at the end.
        </p>

        <h3>3. The list of sub-processors</h3>
        <p>
          Every service the provider uses to handle your data should be named,
          with its role and processing location. Check how you are told about
          changes and whether you can object. Pay attention to anything outside
          the EU and the legal basis used for that transfer (Art. 44 onwards
          GDPR).
        </p>

        <h3>4. Where backups live</h3>
        <p>
          Backups are copies of everything. Ask where they are stored, whether
          they are encrypted, how long they are kept, and whether they sit on
          the same machine as the live data. A backup in another country can
          change your assessment even when the main server is in the EU.
        </p>

        <h3>5. How you get your data out</h3>
        <p>
          Portability is part of good data handling and your bargaining position as a
          customer. Ask what export formats exist, whether exports include
          attachments, users and permissions, and whether you can get a full
          copy that restores elsewhere.
        </p>

        <h3>6. How and when data is deleted</h3>
        <p>
          Ask for concrete periods: when live data is deleted after the
          contract ends, when backup copies expire, and whether you can ask for
          earlier deletion and a written confirmation.
        </p>

        <h2>How BookHost answers these questions</h2>
        <p>
          BookHost hosts BookStack, the open-source wiki. Here is what our
          published documents say. The legal documents themselves are in
          German.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">BookHost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Hosting location</td>
              <td>
                Hetzner infrastructure in Germany or Finland. Processing of
                instance and backup data at Hetzner is limited to those two
                countries.
              </td>
            </tr>
            <tr>
              <td>Processing agreement</td>
              <td>
                A data processing agreement under Art. 28 GDPR is published at{" "}
                <Link href="/legal/avv">/legal/avv</Link> and accepted at
                sign-up.
              </td>
            </tr>
            <tr>
              <td>Sub-processors</td>
              <td>
                Listed in Annex 3 of the agreement, with role and location. We
                announce new or replaced sub-processors at least 30 days in
                advance, and you can object.
              </td>
            </tr>
            <tr>
              <td>Backups</td>
              <td>
                Daily, encrypted, on Hetzner in Germany or Finland. Backups
                older than seven days are removed at the next daily retention
                run. Currently on the same server as the workspaces.
              </td>
            </tr>
            <tr>
              <td>Exports</td>
              <td>
                BookStack content exports during the subscription, plus on
                request a database dump and file archive with a manifest.
              </td>
            </tr>
            <tr>
              <td>Deletion</td>
              <td>
                Active instance data within 30 days after the contract ends;
                protected backup copies within a further seven days. Earlier
                deletion on request.
              </td>
            </tr>
          </tbody>
        </table>

        <h3>The providers outside the core hosting</h3>
        <p>
          Hosting in the EU does not mean every service processes data only in
          the EU. The agreement names these providers:
        </p>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> (Germany): infrastructure and
            storage for workspaces and backups.
          </li>
          <li>
            <strong>Stripe Payments Europe</strong> (Ireland): payments,
            subscriptions and the customer portal. Stripe acts as its own
            controller for its payment and regulatory tasks, receives billing
            data rather than wiki content, and can process data
            internationally.
          </li>
          <li>
            <strong>Google Ireland</strong>: only if you choose Google sign-in
            for the BookHost dashboard. Password sign-in remains available.
            Google can process data internationally.
          </li>
          <li>
            <strong>Resend Inc.</strong> (USA): transactional email such as
            password resets and notifications, with EU data processing under
            standard contractual clauses.
          </li>
          <li>
            <strong>TensorX Limited</strong> (Ireland): AI processing for the
            document intake and “Ask your wiki” betas. TensorX’s documented GPU
            infrastructure is in Dublin and Helsinki. It also serves the
            optional semantic wiki indexing (beta), which stays off until an
            owner or admin switches it on. Nothing is sent to TensorX unless
            someone uses or activates these features. Until the updated processing
            conditions are independently verified, use the betas only with
            non-personal content.
          </li>
        </ul>

        <h3>What we do not claim</h3>
        <ul>
          <li>We do not advertise any security certification.</li>
          <li>We do not claim encryption of every active disk or end-to-end encryption; backups are encrypted before storage and public access uses TLS.</li>
          <li>We do not offer a contractual availability commitment or a fixed restore time.</li>
          <li>Backups are not yet copied to a second location.</li>
        </ul>
        <p>
          The details are on our{" "}
          <Link href="/reliability">backups and recovery page</Link> and in
          the <Link href="/legal/datenschutz">privacy policy</Link>.
        </p>

        <h2>Your side of the work</h2>
        <p>
          Even with a careful provider, some of the job stays with you:
        </p>
        <ul className="checklist">
          <li>Record the wiki in your record of processing activities.</li>
          <li>Decide what does not belong in the wiki, such as passwords, health data or HR files, and tell the team.</li>
          <li>Use BookStack roles and book permissions so client and HR material is only visible to the people who need it.</li>
          <li>Remove leavers’ accounts promptly.</li>
          <li>Keep your own exports if you need copies beyond the provider’s retention.</li>
          <li>Review the sub-processor list when you are notified of a change.</li>
        </ul>

        <h2>Moving an existing wiki</h2>
        <p>
          If you already run BookStack on a server outside the EU, or on a
          machine you would rather not maintain, the{" "}
          <Link href="/migrate">migration page</Link> explains the two files
          we need and what we do not migrate. Moving from Confluence? Our{" "}
          <Link href="/bookstack-vs-confluence">BookStack vs Confluence</Link>{" "}
          comparison covers that route. Pricing and the free trial are on the{" "}
          <Link href="/pricing">pricing page</Link>.
        </p>

        <GuideFaq faqs={faqs} />
        <GuideSources sources={sources} />
      </GuidePage>
    </>
  );
}
