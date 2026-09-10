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
            Run these commands on your server, replacing the database name and
            paths with your own values:
          </p>
          <pre className="mt-6 overflow-x-auto rounded-xl bg-ink p-5 text-sm leading-7 text-white"><code>{`# Database dump (use either command)
mysqldump --single-transaction --routines --triggers bookstack > bookstack.sql
mariadb-dump --single-transaction --routines --triggers bookstack > bookstack.sql

# Archive the BookStack uploads and files directories
tar -czf bookstack-files.tar.gz -C /path/to/bookstack uploads files`}</code></pre>
          <p className="mt-5 text-sm leading-7 text-slate-600">
            We do not need login credentials for your server. Your old instance
            can continue running while we work on the new one.
          </p>
        </section>
        <section>
          <p className="eyebrow">02 / REBUILD THE WORKSPACE</p>
          <h2>What we do</h2>
          <ul className="checklist mt-6">
            <li>Provision a new BookStack instance for your workspace.</li>
            <li>Import the database and the uploads/files archive.</li>
            <li>Run BookStack&apos;s own schema update so older supported versions are brought forward.</li>
            <li>Rewrite absolute links from the old address to the new one.</li>
            <li>Rebuild the search index and permissions.</li>
            <li>Create a backup before every change we make.</li>
          </ul>
        </section>
        <section>
          <p className="eyebrow">03 / YOUR ACCEPTANCE CHECK</p>
          <h2>What you check afterwards</h2>
          <ul className="checklist mt-6">
            <li>The number of books, pages and attachments is correct.</li>
            <li>You can sign in with the credentials from your existing system. Your old passwords remain valid; our initial password expires.</li>
            <li>Images and attachments open correctly.</li>
            <li>Search finds the content you expect.</li>
          </ul>
        </section>
        <section>
          <p className="eyebrow">04 / PLAN THE CHANGE</p>
          <h2>Timing and switch-over</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-600">
            The usual process lets your old instance keep serving people while
            the new instance is prepared and checked. Once you are happy, the
            switch is a DNS or bookmark change to the new address. We do not
            switch anything off on your server.
          </p>
        </section>
        <section>
          <p className="eyebrow">05 / KNOW THE BOUNDARIES</p>
          <h2>What we do not migrate today</h2>
          <ul className="checklist mt-6">
            <li>External login methods such as LDAP, SAML and OIDC need to be configured again on the new instance.</li>
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
