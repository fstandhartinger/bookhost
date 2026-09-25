import type { Metadata } from "next";
import Link from "next/link";
import { GuideFaq, GuidePage } from "@/components/guide-page";
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
import { STORAGE_COPY } from "@/lib/quotas";

const slug = "self-hosted-vs-managed-bookstack";
export const metadata: Metadata = guideMetadata(slug);

const faqs: Faq[] = [
  {
    question: "Is self-hosting BookStack hard?",
    answer:
      "Getting it running is not hard. The official docs and the LinuxServer Docker image make a first install straightforward. The ongoing work is what costs time: updates, TLS, mail, backups, restore tests and noticing when something has stopped working.",
  },
  {
    question: "Can I move from self-hosted BookStack to managed hosting later?",
    answer:
      "Yes. A move needs a consistent database dump and an archive of the uploads and attachment files, taken during a write freeze. BookHost's migration page lists the exact commands, what we migrate and what we do not, such as LDAP, SAML and OIDC sign-in and S3 storage.",
  },
  {
    question: "Can I leave managed hosting and self-host again?",
    answer:
      "With BookHost, yes. Ask at any time and we hand you a database dump and an archive of your uploads and attachments, plus a manifest with counts and checksums. They restore into any BookStack installation.",
  },
  {
    question: "Does managed hosting mean I never lose data?",
    answer:
      "No. BookHost makes daily backups, so a restore returns the workspace to the state of its last nightly backup and can cost up to a day of changes. There is no fixed restore time and no contractual availability commitment.",
  },
];

export default function SelfHostedVsManagedPage() {
  const { title } = guide(slug);
  return (
    <>
      <JsonLd data={guideJsonLd(slug, faqs)} />
      <GuidePage
        eyebrow="GUIDE · RUNNING BOOKSTACK"
        title={title}
        lede="BookStack is free, open-source software, and running it yourself is a perfectly good choice. This guide lists the work that comes with it, compares that with managed hosting, and ends with a checklist you can use either way."
        updated={GUIDE_REVIEWED}
        related={relatedLinks(slug)}
      >
        <h2>Who this is for</h2>
        <p>
          Small IT teams, agencies and technical founders who already use
          BookStack or are about to, and who are deciding whether to keep a
          server for it. BookHost sells managed hosting, so we have an interest
          here. We still think self-hosting is the right answer for many teams,
          and we say where.
        </p>

        <h2>What running BookStack yourself involves</h2>
        <h3>Installation</h3>
        <p>
          BookStack is a PHP application backed by MySQL or MariaDB. You can
          install it directly on a Linux server following the official docs,
          or run the popular LinuxServer.io Docker image next to a MariaDB
          container. With the Docker image, persistent data lives under{" "}
          <code>/config</code>, the configuration file is{" "}
          <code>/config/www/.env</code>, and you must set <code>APP_URL</code>,{" "}
          <code>APP_KEY</code> and the database connection variables.
        </p>
        <h3>Updates</h3>
        <p>
          BookStack is updated regularly, including security fixes. On a
          manual install an update is roughly <code>git pull</code>,{" "}
          <code>composer install --no-dev</code> and{" "}
          <code>php artisan migrate</code>; with Docker you pull the new image
          and recreate the container. BookStack’s docs recommend a backup
          before every update. Around the application you also maintain the
          operating system, PHP, the database server and your reverse proxy.
        </p>
        <h3>TLS and the address</h3>
        <p>
          You need a domain, DNS, and a reverse proxy or web server that
          renews certificates automatically. If the address changes later,
          BookStack’s stored URLs must be updated too.
        </p>
        <h3>Email</h3>
        <p>
          BookStack sends invitations, password resets and notifications by
          email. That means SMTP credentials for a provider whose mail actually
          arrives, plus SPF and DKIM records for your sending domain. A wiki
          whose password reset mail lands in spam produces support tickets.
        </p>
        <h3>Backups and restore tests</h3>
        <p>
          A BookStack backup has three parts: the database, the uploaded
          images and attachment files, and the <code>.env</code> file with its{" "}
          <code>APP_KEY</code>. Backups belong on a different machine from the
          wiki, and they only count once you have restored one. Our{" "}
          <Link href="/bookstack-backup-guide">BookStack backup guide</Link>{" "}
          has the commands.
        </p>
        <h3>Monitoring</h3>
        <p>
          Somebody should find out that the wiki is down, the disk is full, the
          certificate failed to renew or last night’s backup did not run
          before a colleague does. That means uptime checks, disk alerts and
          a backup job that reports failures instead of failing silently.
        </p>

        <h2>Side by side</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Self-hosted</th>
              <th scope="col">BookHost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Server, OS, PHP, database</td>
              <td>You</td>
              <td>Included: hosting</td>
            </tr>
            <tr>
              <td>BookStack updates</td>
              <td>You, with a backup first</td>
              <td>Included: maintenance and security updates</td>
            </tr>
            <tr>
              <td>TLS and domain</td>
              <td>You</td>
              <td>A bookhost.co address, or your own domain via DNS records</td>
            </tr>
            <tr>
              <td>Backups</td>
              <td>You design, store and rotate them</td>
              <td>Daily, encrypted; backups older than seven days are removed</td>
            </tr>
            <tr>
              <td>Restore tests</td>
              <td>You</td>
              <td>Scheduled rotation across workspaces; see the reliability page</td>
            </tr>
            <tr>
              <td>Single sign-on (LDAP, SAML, OIDC)</td>
              <td>Available in BookStack</td>
              <td>Not available today</td>
            </tr>
            <tr>
              <td>Themes and server customisations</td>
              <td>Full control</td>
              <td>Custom server extensions do not run</td>
            </tr>
            <tr>
              <td>Support</td>
              <td>Community forums and your own team</td>
              <td>Email support; no 24/7 or fixed response-time commitment</td>
            </tr>
            <tr>
              <td>Cost</td>
              <td>Server plus your time</td>
              <td>€{PLAN.price}/month plus applicable VAT</td>
            </tr>
          </tbody>
        </table>

        <h2>The real cost of self-hosting is time</h2>
        <p>
          A small virtual server is cheap. The expensive part is the hours,
          and they come unevenly: a quiet month may need almost nothing, while
          a failed upgrade or a full disk can eat an afternoon at an awkward
          moment. A fair way to compare is to write down, for your own team:
        </p>
        <ul>
          <li>Hours per month for updates, OS patches and checking backups.</li>
          <li>Hours per quarter for a restore test.</li>
          <li>Hours per year for incidents, upgrades of PHP or the database, and certificate or mail problems.</li>
          <li>The hourly cost of the person doing it, and what they would otherwise work on.</li>
          <li>Who covers when that person is on holiday.</li>
        </ul>
        <p>
          If the result is well below €{PLAN.price} a month and you have more
          than one person who can fix the server, self-hosting is a sound
          choice. If the wiki depends on one busy admin, the risk matters more
          than the money.
        </p>

        <h2>What managed hosting does and does not change</h2>
        <p>
          With BookHost, we handle hosting, maintenance and security updates,
          and back up each workspace daily. Backups are encrypted. A nightly
          restore check rebuilds one workspace at a time from its backup in an
          isolated test instance, rotating so every workspace comes round in
          turn; it is not a test of every backup every night. You get restore help through
          email support. {STORAGE_COPY}
        </p>
        <p>
          Some limits stay. A daily backup is not continuous recovery: a
          restore can cost up to a day of changes. Backups currently live on
          the same server as the workspaces; a copy at a second location is in
          preparation and not yet in operation. We do not promise a fixed
          restore time or a contractual availability commitment. The{" "}
          <Link href="/reliability">reliability page</Link> and{" "}
          <Link href="/blog/how-we-test-every-bookstack-backup-restore">
            how we test restores
          </Link>{" "}
          describe the details.
        </p>

        <h2>When self-hosting is the better choice</h2>
        <ul>
          <li>You have ops capacity and more than one person who can maintain the server.</li>
          <li>You need LDAP, SAML or OIDC sign-in, or enforced two-factor authentication.</li>
          <li>You rely on custom themes, logical theme hooks or other server-side changes.</li>
          <li>Your policy requires the wiki to run on your own infrastructure.</li>
          <li>You need S3 or other external file storage.</li>
        </ul>

        <h2>When managed hosting is the better choice</h2>
        <ul>
          <li>Nobody on the team wants to be on call for the wiki server.</li>
          <li>You want backups and restore checks handled by someone else.</li>
          <li>BookStack’s own email-and-password sign-in is enough for your team.</li>
          <li>You want to start within minutes, without buying a server first.</li>
        </ul>

        <h2>Checklist for self-hosters</h2>
        <p>If you run BookStack yourself, these are the things worth confirming:</p>
        <ul className="checklist">
          <li>BookStack, PHP, the database server and the OS each have an update routine and an owner.</li>
          <li>You follow BookStack release notes so security releases are not missed.</li>
          <li>HTTPS is enforced and certificate renewal is automatic and monitored.</li>
          <li><code>APP_URL</code> matches the public address exactly.</li>
          <li>Outgoing mail works: send yourself a password reset and check it arrives.</li>
          <li>The database is dumped daily with a consistent snapshot.</li>
          <li>Uploaded images and attachment files are archived with the same backup run.</li>
          <li>A copy of <code>.env</code> and its <code>APP_KEY</code> is stored securely, separate from the server.</li>
          <li>Backups are copied off the server and old ones are rotated out.</li>
          <li>You have restored a backup to a separate instance in the last quarter and checked pages, images, attachments and a normal user login.</li>
          <li>Uptime, disk space and backup failures raise an alert someone reads.</li>
          <li>A second person knows where the backups are and how to restore them.</li>
        </ul>
        <p>
          If you tick most of these already, you are running BookStack well
          and probably do not need us. If several are open and nobody has time
          to close them, a{" "}
          <Link href="/pricing">{PLAN.trialDays}-day free trial</Link> of
          BookHost costs nothing to try. When you are ready to move an existing
          instance, read{" "}
          <Link href="/blog/moving-self-hosted-bookstack-to-managed-hosting">
            what actually breaks when moving to managed hosting
          </Link>{" "}
          and the <Link href="/migrate">migration page</Link>.
        </p>

        <GuideFaq faqs={faqs} />
      </GuidePage>
    </>
  );
}
