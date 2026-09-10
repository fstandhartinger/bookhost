import type { Metadata } from "next";
import Link from "next/link";
import { baseUrl } from "@/lib/config";

const title = "What happens to your data";
const description =
  "How BookHost backs up your workspace: daily encrypted backups, dated restore checks, recovery checks and the limits of our current setup.";
const url = `${baseUrl()}/reliability`;
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    type: "website",
    url,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function Reliability() {
  return (
    <article className="section mx-auto max-w-3xl">
      <p className="eyebrow">BACKUPS AND RECOVERY</p>
      <h1>{title}</h1>
      <p className="lede">
        What we back up, the restores we have tested, and where our current
        setup has limits.
      </p>
      <p className="mt-5 text-sm text-slate-600">
        Last updated <time dateTime="2026-09-10">10 September 2026</time>.
      </p>

      <div className="mt-12 space-y-12">
        <section id="backups" aria-labelledby="backups-heading">
          <h2 id="backups-heading">What we back up, and how often</h2>
          <div className="mt-5 space-y-4 leading-7 text-slate-600">
            <p>
              Each workspace gets a daily backup of its BookStack database and
              files, including pages, attachments and images. Backups are
              encrypted with age and authenticated with an HMAC signature. We
              remove local backups older than seven days at the next daily retention
              run; with scheduled runs, this can add up to 24 hours. A first backup is triggered
              directly after a workspace is provisioned.
            </p>
            <p>
              {/* A page that sells tested restores has to say what a restore
                  cannot bring back. */}
              A restore returns the workspace to the state of its last nightly
              backup. Work saved after that run is not in the backup, so a
              recovery can cost up to a day of changes. If you are about to make
              a large change and want a fresh restore point beforehand, ask us
              and we will take one.
            </p>
            <p>
              Since 10 September 2026, the nightly backup runs while the service
              stays running. We check database and file consistency around the
              backup. If consistency cannot be confirmed after three attempts,
              the process automatically falls back to the previous method, which
              briefly stops the service. The earlier nightly method caused
              around ten seconds of interruption per workspace each day.
            </p>
          </div>
        </section>

        <section id="restore-checks" aria-labelledby="restore-heading">
          <h2 id="restore-heading">How we check a restore</h2>
          <div className="mt-5 space-y-4 leading-7 text-slate-600">
            <p>
              We restore encrypted backups into isolated test instances on a
              private network. The HMAC is checked before decryption. We compare
              the restored data and files with the original and check the
              restored instance over HTTP.
            </p>
            <p>
              <strong>
                <time dateTime="2026-09-09">9 September 2026</time> — demo
                restore:
              </strong>{" "}
              The restored database matched the original counts for 11 pages,
              three books and 17 page revisions. Roles, permissions, settings,
              and the hash of page titles and update times matched. This demo
              had no uploaded attachments or images. HTTP retrieval was not
              verified in this first test.
            </p>
            <p>
              <strong>
                <time dateTime="2026-09-09">9 September 2026</time> — attachment
                and image restore:
              </strong>{" "}
              A separate temporary workspace supplied real test uploads. The
              restored attachment and image files matched byte-for-byte using
              SHA-256 comparisons; the upload manifest matched all 21 files,
              including generated image variants. Attachment and image database
              rows also matched. The restored login page, content page and image
              each returned HTTP 200; the page title and content, and the image
              content type, were checked.
            </p>
            <p>
              The live demo’s before-and-after fingerprints were identical in
              both tests. The isolated test resources were removed afterwards.
            </p>
          </div>
        </section>

        <section id="recovery" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">When something goes wrong</h2>
          <div className="mt-5 space-y-4 leading-7 text-slate-600">
            <p>
              Monitoring runs every ten minutes. When a backup has stopped the
              service, we restart the workspace and check that it is running and
              ready to serve requests before reporting the backup as successful.
              A failed recovery is reported as an error.
            </p>
            <p>
              For support or help restoring a backup, email{" "}
              <a
                className="text-moss underline"
                href="mailto:info@productivity-boost.com"
              >
                info@productivity-boost.com
              </a>
              .
            </p>
          </div>
        </section>

        <section
          id="limits"
          aria-labelledby="limits-heading"
          className="rounded-2xl border border-ink/15 bg-white p-6 sm:p-8"
        >
          <h2 id="limits-heading">What we do not promise today</h2>
          <div className="mt-5 space-y-4 leading-7 text-slate-600">
            <p>
              Backups currently live on the same server as the workspaces. A
              copy at a second location is in preparation and is not yet in
              operation.
            </p>
            <p>We do not offer a contractual availability commitment.</p>
            <p>
              Document intake is available in beta. Each upload sends extracted text,
              not the original file, to Chutes for AI drafting. Without an upload,
              this feature sends nothing to Chutes. Source text is removed on
              publication or rejection; intake records and drafts are deleted
              after 30 days from creation in the next hourly cleanup. Technical
              availability does not establish a provider DPA or international
              transfer safeguards. Until those prerequisites are documented, use
              only non-personal example documents. See our{" "}
              <Link className="text-moss underline" href="/legal/datenschutz">
                Privacy Policy
              </Link>{" "}
              for the processing conditions.
            </p>
          </div>
        </section>
      </div>
    </article>
  );
}
