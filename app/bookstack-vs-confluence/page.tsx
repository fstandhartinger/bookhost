import type { Metadata } from "next";
import Link from "next/link";
import { GuideFaq, GuidePage, GuideSources } from "@/components/guide-page";
import { JsonLd } from "@/components/json-ld";
import { PLAN } from "@/lib/config";
import {
  GUIDE_REVIEWED,
  guide,
  guideJsonLd,
  guideMetadata,
  relatedLinks,
  type Faq,
} from "@/lib/guides";
import { MEMBER_COPY } from "@/lib/quotas";

const slug = "bookstack-vs-confluence";
export const metadata: Metadata = guideMetadata(slug);

const faqs: Faq[] = [
  {
    question: "Can BookStack import Confluence spaces directly?",
    answer:
      "BookStack does not ship an official Confluence importer. Teams usually export a space from Confluence, rebuild the structure as books and chapters, and move page content by hand, with the BookStack REST API, or with community scripts. Confluence macros and Jira embeds need manual replacement.",
  },
  {
    question: "Is BookStack free?",
    answer:
      "The software is free and open source under the MIT licence. You still pay for running it: either your own server and the time to operate it, or a hosting service. BookHost charges a flat monthly price for a hosted workspace.",
  },
  {
    question: "Does BookHost support single sign-on like Confluence?",
    answer:
      "No. BookStack itself supports LDAP, SAML2 and OIDC when you run it yourself, but BookHost workspaces do not offer LDAP, SAML or OIDC single sign-on today. Workspaces use BookStack's own email-and-password sign-in. If your team depends on an identity provider, Confluence or a self-hosted BookStack is the better fit.",
  },
  {
    question: "Is BookHost part of the BookStack project?",
    answer:
      "No. BookStack is created by Dan Brown and developed with its community. BookHost is an independent hosting service and is not affiliated with or endorsed by the BookStack project.",
  },
];

const sources = [
  { href: "https://www.bookstackapp.com/", label: "BookStack: project homepage (licence, editor, permissions, authentication options)" },
  { href: "https://www.bookstackapp.com/docs/admin/hacking-bookstack/", label: "BookStack docs: REST API and customisation" },
  { href: "https://www.atlassian.com/software/confluence/pricing", label: "Atlassian: Confluence pricing" },
  { href: "https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency/", label: "Atlassian: understand data residency" },
  { href: "https://www.atlassian.com/software/confluence/download-archives", label: "Atlassian: Confluence Data Center downloads and end-of-life notice" },
];

export default function BookStackVsConfluencePage() {
  const { title } = guide(slug);
  return (
    <>
      <JsonLd data={guideJsonLd(slug, faqs)} />
      <GuidePage
        eyebrow="GUIDE · WIKI COMPARISON"
        title={title}
        lede="Both tools can hold a team’s procedures, handovers and reference docs. They differ in how content is organised, how you pay, and how much of the wider Atlassian world you need. This guide compares them for teams of roughly 5 to 50 people."
        updated={GUIDE_REVIEWED}
        related={relatedLinks(slug)}
      >
        <h2>The short answer</h2>
        <p>
          Pick <strong>BookStack</strong> if you want a focused, easy-to-learn
          documentation wiki with a fixed structure, open-source code and a
          predictable cost that does not grow with every new colleague. Pick{" "}
          <strong>Confluence</strong> if your team already lives in Jira, needs
          single sign-on through an identity provider, or relies on
          Marketplace apps and real-time co-editing.
        </p>
        <p>
          A note on who is writing: BookHost sells managed BookStack hosting.
          We have tried to keep the comparison fair, and the section on when
          Confluence is the better choice is meant seriously.
        </p>

        <h2>At a glance</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">BookStack</th>
              <th scope="col">Confluence (Cloud)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Structure</td>
              <td>Shelves, books, chapters, pages</td>
              <td>Spaces with nested page trees</td>
            </tr>
            <tr>
              <td>Editing</td>
              <td>WYSIWYG editor or Markdown editor with live preview</td>
              <td>Rich editor with collaborative editing</td>
            </tr>
            <tr>
              <td>Licence</td>
              <td>MIT-licensed open source</td>
              <td>Proprietary SaaS; self-managed Data Center edition until 2029</td>
            </tr>
            <tr>
              <td>Pricing model</td>
              <td>Software free; you pay for a server or a host</td>
              <td>Per user per month, with a free tier for small teams</td>
            </tr>
            <tr>
              <td>Integrations</td>
              <td>REST API, webhooks, diagrams.net built in</td>
              <td>Deep Jira integration, large app Marketplace</td>
            </tr>
            <tr>
              <td>Data location</td>
              <td>Wherever you or your host run it</td>
              <td>Atlassian cloud regions; data residency on paid plans</td>
            </tr>
          </tbody>
        </table>

        <h2>Structure: books and chapters vs spaces</h2>
        <p>
          BookStack uses a deliberately simple hierarchy borrowed from print.
          Pages live in chapters, chapters live in books, and books can be
          grouped on shelves. There are only those levels, which keeps things
          tidy: a new colleague can usually guess where the VPN guide or the
          onboarding checklist lives.
        </p>
        <p>
          Confluence organises content in spaces. Inside a space, pages can be
          nested as deeply as you like. That flexibility suits large
          organisations with many teams, but small teams often end up with page
          trees that grow sideways and downwards until nobody is sure where
          anything belongs. If your main pain is “we can’t find things”,
          BookStack’s fixed structure is a real advantage. If your content does
          not fit three levels, it is a limitation.
        </p>

        <h2>Editing</h2>
        <p>
          BookStack offers a WYSIWYG editor and a separate Markdown editor with
          live preview; each user can choose. It also has diagrams.net drawing
          built in, page revisions, and full-text search across all content.
          It does not do real-time co-editing: if two people open the same
          page, BookStack warns them rather than merging their typing live.
        </p>
        <p>
          Confluence’s editor is richer. Several people can edit a page at the
          same time, and macros let you embed Jira issues, status labels, page
          trees and other dynamic content. That power has a cost when you want
          to leave: macro content does not translate cleanly to plain HTML or
          Markdown.
        </p>

        <h2>Permissions</h2>
        <p>
          BookStack has a role-based permission system. Roles grant system-wide
          abilities, and you can override permissions on individual shelves,
          books, chapters and pages. For a team that needs “sales can read the
          handbook, only ops can edit runbooks, the client folder is private”,
          it is enough and easy to reason about.
        </p>
        <p>
          Confluence uses space permissions plus page restrictions, with
          groups usually managed through Atlassian’s admin tools or an
          identity provider. It scales further for large organisations with
          many departments. For 10 people, both are more than sufficient.
        </p>

        <h2>Integrations and extensibility</h2>
        <p>
          Confluence wins on breadth. The Jira link is the main reason many
          teams choose it, and the Atlassian Marketplace offers apps for
          diagrams, templates, reporting and more.
        </p>
        <p>
          BookStack is more modest. It has a documented REST API and webhooks,
          so you can script imports, sync content or notify a chat channel
          when a page changes. On a self-hosted instance you can also use
          themes and customisations. On BookHost, custom server extensions do
          not run on our hosting; the API and BookStack’s built-in settings are
          available.
        </p>

        <h2>Pricing model</h2>
        <p>
          Confluence Cloud is priced per user per month, with a free tier for
          small teams and several paid tiers. Annual billing is also offered.
          The total therefore grows with headcount, and the features you need
          (for example data residency, which Atlassian offers only on paid
          plans) determine the tier. Prices change, so check{" "}
          <a href="https://www.atlassian.com/software/confluence/pricing">
            Atlassian’s pricing page
          </a>{" "}
          for current numbers.
        </p>
        <p>
          BookStack costs nothing to license. You pay for somewhere to run it.
          Self-hosting means a server plus your own time for updates, backups
          and monitoring; our{" "}
          <Link href="/self-hosted-vs-managed-bookstack">
            self-hosted vs managed comparison
          </Link>{" "}
          goes through that honestly. BookHost charges a flat €{PLAN.price} per
          month plus applicable VAT for a workspace, after a {`${PLAN.trialDays}-day`} free trial with no card required. {MEMBER_COPY} See{" "}
          <Link href="/pricing">pricing</Link> for everything that is included.
        </p>

        <h2>Hosting and data location</h2>
        <p>
          Atlassian runs Confluence Cloud on its own infrastructure. On
          Standard, Premium and Enterprise plans you can pin product data to a
          location such as the EU or Germany using Atlassian’s data residency
          feature; the free plan does not include it. Confluence Data Center,
          the self-managed edition, reaches end of life on 28 March 2029
          according to Atlassian, so self-hosting Confluence is not a long-term
          option.
        </p>
        <p>
          With BookStack, the data lives wherever the instance runs. BookHost’s
          core hosting and backups use Hetzner infrastructure in Germany or
          Finland. That does not mean every service processes data only in the
          EU: Stripe payments and optional Google sign-in can involve
          international processing. Our{" "}
          <Link href="/eu-hosted-team-wiki">EU-hosted team wiki guide</Link>{" "}
          lists what to check with any provider.
        </p>

        <h2>Moving from Confluence to BookStack</h2>
        <p>
          There is no one-click path. A realistic plan for a small team looks
          like this:
        </p>
        <ol>
          <li>
            Inventory your spaces and decide which are still in use. Stale
            spaces are often better archived than migrated.
          </li>
          <li>
            Map each active space to a book (or a shelf of books) and the top
            levels of its page tree to chapters.
          </li>
          <li>
            Export the content from Confluence and bring it into BookStack by
            hand for small spaces, or with the BookStack API for larger ones.
          </li>
          <li>
            Replace macros, Jira embeds and inline comments. These do not carry
            over and are the most time-consuming part.
          </li>
          <li>
            Recreate permissions per book and check them with a regular member
            account, not only as an admin.
          </li>
          <li>Keep Confluence read-only until the team has signed off.</li>
        </ol>
        <p>
          BookHost’s documented migration service is for existing BookStack
          instances; see <Link href="/migrate">moving your BookStack</Link>.
          Help with a Confluence move is additional work that we assess and
          agree separately before anything starts.
        </p>

        <h2>When Confluence is the better choice</h2>
        <ul>
          <li>Your team plans work in Jira and wants issues and docs linked closely.</li>
          <li>
            You need sign-in through Azure AD, Okta, Google Workspace or
            another identity provider. BookHost does not offer LDAP, SAML or
            OIDC single sign-on today.
          </li>
          <li>Several people regularly need to edit the same page at the same time.</li>
          <li>You depend on Marketplace apps or complex page macros.</li>
          <li>
            You need contractual availability commitments. BookHost does not
            offer a contractual availability commitment or a 24/7 support
            promise.
          </li>
        </ul>

        <h2>When BookStack is the better choice</h2>
        <ul>
          <li>You want a clear structure that new people understand in minutes.</li>
          <li>You prefer open-source software you could run yourself at any time.</li>
          <li>You want a flat monthly cost instead of a price per seat.</li>
          <li>
            You want the option to take a database dump and file
            archive with you and restore it into any BookStack installation.
          </li>
        </ul>

        <GuideFaq faqs={faqs} />
        <GuideSources sources={sources} />
      </GuidePage>
    </>
  );
}
