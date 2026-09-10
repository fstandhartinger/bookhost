import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Move your existing BookStack",
  description:
    "Move an existing BookStack instance to BookHost with a database dump and file archive. See what we migrate, what you check, and how the switch-over works.",
  alternates: { canonical: "/migrate" },
  openGraph: {
    title: "Move your existing BookStack · BookHost",
    description:
      "A practical guide to moving an existing BookStack instance to BookHost.",
    url: "/migrate",
    type: "website",
  },
};

export default function MigrationPage() {
  return (
    <article className="section mx-auto max-w-4xl">
      <header className="max-w-3xl">
        <p className="eyebrow">EXISTING BOOKSTACK · MOVE WITH CONFIDENCE</p>
        <h1>Move your existing BookStack.</h1>
        <p className="lede">
          Bring your current BookStack content to a private BookHost workspace.
          We review the source first, preserve the content and permissions we
          can support, and keep your old instance running while the move is
          prepared.
        </p>
      </header>
      <div className="mt-16 space-y-16">
        <section>
          <p className="eyebrow">01 / PREPARE THE SOURCE</p>
          <h2>What you send us</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-600">
            Send a database dump of the BookStack database and one archive
            containing the <code>uploads</code> and <code>files</code> directories.
            Agree a shared snapshot time and freeze writes on the old system before exporting.
            The database dump and file archive must describe the same read-only source.
            Run these commands on your server, replacing the database name and
            paths with your own values:
          </p>
          <pre className="mt-6 overflow-x-auto rounded-xl bg-ink p-5 text-sm leading-7 text-white"><code>{`# Database dump (use either command)
mysqldump --single-transaction --routines --triggers bookstack > bookstack.sql
mariadb-dump --single-transaction --routines --triggers bookstack > bookstack.sql

# Standard BookStack: normalize private attachments to files/ (GNU tar)
tar -czf bookstack-files.tar.gz -C /path/to/bookstack/public uploads \
  --transform='s,^storage/uploads/files,files,' -C /path/to/bookstack storage/uploads/files

# LinuxServer: run inside the container with /config mounted (use instead)
tar -czf bookstack-files.tar.gz -C /config/www uploads files`}</code></pre>
          <p className="mt-5 text-sm leading-7 text-slate-600">
            We do not need login credentials for your server. Your old instance
            can continue serving read-only access while we work on the new one. Changes made after the export are not included in that import.
          </p>
        </section>
        <section>
          <p className="eyebrow">02 / REBUILD THE WORKSPACE</p>
          <h2>What we do</h2>
          <ul className="checklist mt-6">
            <li>Provision a new BookStack instance for your workspace.</li>
            <li>Import the database and the uploads/files archive.</li>
            <li>Run BookStack&apos;s own schema update so older supported versions are brought forward.</li>
            <li>When you supply the old base URL, rewrite matching links in supported current page HTML/Markdown, book and chapter descriptions, and image URLs. Settings, historical revisions and other fields require separate checks.</li>
            <li>Rebuild the search index and permissions.</li>
            <li>Create a recovery backup of the destination before starting the import.</li>
          </ul>
        </section>
        <section>
          <p className="eyebrow">03 / YOUR ADDRESS</p>
          <h2>Keep your own domain</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-600">
            Your workspace always has a bookhost.co address. Owners can add their
            own domain in the dashboard: enter it, add the DNS records we show,
            and we serve the workspace on both addresses once the certificate is
            issued. External sign-in providers and mail routing are not part of
            this step.
          </p>
        </section>
        <section>
          <p className="eyebrow">04 / YOUR ACCEPTANCE CHECK</p>
          <h2>What you check afterwards</h2>
          <ul className="checklist mt-6">
            <li>The number of books, pages and attachments is correct.</li>
            <li>Local password hashes are preserved. Verify sign-in as an administrator and as a regular member as part of acceptance.</li>
            <li>Images and attachments open correctly.</li>
            <li>Search finds the content you expect.</li>
          </ul>
        </section>
        <section>
          <p className="eyebrow">05 / PLAN THE CHANGE</p>
          <h2>Timing and switch-over</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-600">
            Agree a shared snapshot time, freeze writes, export both files, then check
            the imported workspace before cutover by DNS or bookmark change.
            Keep the old system read-only through acceptance and cutover. For a
            longer preparation period with resumed writes, arrange a final second
            import from a fresh, consistent snapshot under a new write freeze,
            repeat acceptance checks, then switch over. We do not switch anything
            off on your server.
          </p>
        </section>
        <section>
          <p className="eyebrow">06 / KNOW THE BOUNDARIES</p>
          <h2>What we do not migrate today</h2>
          <ul className="checklist mt-6">
            <li>Two-factor authentication (MFA) and external sign-in methods (LDAP, SAML, OIDC) require separate assessment and recovery or reconfiguration before cutover.</li>
            <li>S3 and other external file storage is not imported.</li>
            <li>We review very old BookStack versions before starting.</li>
            <li>Custom server extensions do not run on our hosting.</li>
          </ul>
        </section>
      </div>
      <section className="mt-16 rounded-2xl bg-[#e8edde] p-8">
        <h2>Ready to talk it through?</h2>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          Email <a className="underline" href="mailto:info@productivity-boost.com">info@productivity-boost.com</a> with your BookStack version and a short description of your setup. Start with 14 days free; no card is required.
        </p>
      </section>
    </article>
  );
}
