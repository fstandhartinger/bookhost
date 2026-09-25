import type { Metadata } from "next";
import Link from "next/link";
import { GuidePage } from "@/components/guide-page";
import { JsonLd } from "@/components/json-ld";
import {
  GUIDE_REVIEWED,
  guide,
  guideJsonLd,
  guideMetadata,
  relatedLinks,
} from "@/lib/guides";

const slug = "bookstack-backup-guide";
export const metadata: Metadata = guideMetadata(slug);

const databaseDump = `# Database dump (use either command)
mysqldump --single-transaction --routines --triggers bookstack > bookstack.sql
mariadb-dump --single-transaction --routines --triggers bookstack > bookstack.sql`;

const standardFiles = `# Standard install: configuration, images, attachments and themes
cd /path/to/bookstack
tar -czf bookstack-files.tar.gz .env public/uploads storage/uploads themes`;

const dockerBackup = `# Database: dump from the database container (name and password variable vary)
docker exec bookstack_db sh -c \\
  'exec mariadb-dump --single-transaction --routines --triggers -u root -p"$MYSQL_ROOT_PASSWORD" bookstack' \\
  > bookstack.sql

# Files: LinuxServer, run inside the container with /config mounted
tar -czf bookstack-files.tar.gz -C /config/www uploads files .env`;

const checksums = `sha256sum bookstack.sql bookstack-files.tar.gz > SHA256SUMS
tar -tzf bookstack-files.tar.gz > /dev/null && echo "archive readable"`;

const restoreStandard = `# 1. Import the database into the empty BookStack database
mysql -u bookstack -p bookstack < bookstack.sql

# 2. Bring the schema up to the installed version
php artisan migrate

# 3. Unpack files into the BookStack folder, then fix ownership
tar -xzf bookstack-files.tar.gz
sudo chown -R www-data:www-data public/uploads storage/uploads

# 4. If the address changed
php artisan bookstack:update-url https://old.example.com https://new.example.com

# 5. Rebuild derived data and clear caches
php artisan bookstack:regenerate-search
php artisan bookstack:regenerate-permissions
php artisan cache:clear && php artisan view:clear`;

export default function BookStackBackupGuidePage() {
  const { title } = guide(slug);
  return (
    <>
      <JsonLd data={guideJsonLd(slug)} />
      <GuidePage
        eyebrow="GUIDE · BACKUPS"
        title={title}
        lede="A practical guide for anyone running BookStack themselves: what to back up, the commands for a standard install and for the LinuxServer Docker image, how to restore, and how to prove the backup works before you need it."
        updated={GUIDE_REVIEWED}
        related={relatedLinks(slug)}
      >
        <h2>What a complete BookStack backup contains</h2>
        <p>
          BookStack keeps its data in two places: a MySQL or MariaDB database
          and a set of folders on disk. A backup that misses either one will
          not give you your wiki back.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Standard install</th>
              <th scope="col">LinuxServer image</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pages, users, roles, settings, revisions</td>
              <td>The BookStack database</td>
              <td>The database container</td>
            </tr>
            <tr>
              <td>Uploaded images</td>
              <td><code>public/uploads</code></td>
              <td><code>/config/www/uploads</code></td>
            </tr>
            <tr>
              <td>Attachments</td>
              <td><code>storage/uploads</code></td>
              <td><code>/config/www/files</code></td>
            </tr>
            <tr>
              <td>Configuration and <code>APP_KEY</code></td>
              <td><code>.env</code></td>
              <td><code>/config/www/.env</code> and your compose file</td>
            </tr>
            <tr>
              <td>Custom themes, if used</td>
              <td><code>themes</code></td>
              <td>The themes folder under <code>/config</code></td>
            </tr>
          </tbody>
        </table>
        <p>
          On the LinuxServer image, attachments are in{" "}
          <code>/config/www/files</code>, not <code>/config/files</code> where
          many people look first. Check your own paths before you rely on a
          script.
        </p>

        <h2>Why the APP_KEY matters</h2>
        <p>
          The <code>APP_KEY</code> in <code>.env</code> (or in your Docker
          environment) is used by BookStack to encrypt certain values. Restore
          a database without the matching key and anything encrypted with it
          cannot be read; multi-factor authentication settings are the usual
          casualty, which means locked-out users. Store a copy of the key
          securely and separately from the server, for example in your
          password manager. It is a secret: anyone with the key and a copy of
          the data has more than they should.
        </p>

        <h2>Take the database and files from the same moment</h2>
        <p>
          The database refers to image and attachment files by path. If
          someone uploads a file between your database dump and your file
          archive, the two no longer match. For a small team the simplest fix
          is to run both steps back to back at a quiet time. For a move or a
          planned upgrade, freeze writes first so both describe the same
          read-only source.
        </p>
        <p>
          <code>--single-transaction</code> gives a consistent database
          snapshot without locking InnoDB tables, so BookStack can keep
          running during the dump. BookHost’s own nightly job goes further: it
          compares database fingerprints and upload hashes around the backup
          and falls back to briefly stopping the application if they do not
          match after three attempts. The{" "}
          <Link href="/blog/how-we-test-every-bookstack-backup-restore">
            restore-testing write-up
          </Link>{" "}
          explains how.
        </p>

        <h2>Back up a standard install</h2>
        <p>
          Run these on the server, replacing the database name and path with
          your own. Add <code>-u</code> and <code>-p</code> options, or use a
          MySQL option file, if your user needs credentials.
        </p>
        <pre>
          <code>{databaseDump}</code>
        </pre>
        <pre>
          <code>{standardFiles}</code>
        </pre>

        <h2>Back up the LinuxServer Docker image</h2>
        <p>
          With the LinuxServer image, BookStack and its database run in
          separate containers. Dump the database from the database container
          and archive the files from <code>/config/www</code>. Container names
          and the password variable depend on your compose file; older MariaDB
          images may only ship <code>mysqldump</code>.
        </p>
        <pre>
          <code>{dockerBackup}</code>
        </pre>
        <p>
          Also keep a copy of your <code>docker-compose.yml</code> and any
          environment file it reads, because that is where <code>APP_KEY</code>,{" "}
          <code>APP_URL</code> and the database settings live.
        </p>

        <h2>Check the files before you store them</h2>
        <p>
          A backup job that writes an empty dump every night looks just like a
          working one until you need it. Record checksums and make sure the
          archive can be read:
        </p>
        <pre>
          <code>{checksums}</code>
        </pre>
        <p>
          Then copy the files to a different machine or storage provider, ideally
          encrypted. The dump contains users, password hashes, roles and
          settings, so treat it as confidential.
        </p>

        <h2>Restore a standard install</h2>
        <p>
          Install BookStack as usual on the target server, same version or
          newer, and point <code>.env</code> at an empty database. Put the old{" "}
          <code>APP_KEY</code> into the new <code>.env</code> before anyone
          signs in. Then:
        </p>
        <pre>
          <code>{restoreStandard}</code>
        </pre>
        <p>
          Adjust the web server user if it is not <code>www-data</code>. The
          URL update is only needed when the wiki moves to a new address.
        </p>

        <h2>Restore the LinuxServer image</h2>
        <ol>
          <li>Start a fresh database container and create the empty BookStack database.</li>
          <li>
            Import the dump with <code>mariadb</code> inside the database
            container, reading <code>bookstack.sql</code> from standard input.
          </li>
          <li>
            Start the BookStack container with the original{" "}
            <code>APP_KEY</code> and the correct <code>APP_URL</code>, then
            stop it again once it has created <code>/config/www</code>.
          </li>
          <li>
            Unpack <code>bookstack-files.tar.gz</code> into{" "}
            <code>/config/www</code> so <code>uploads</code> and{" "}
            <code>files</code> land in place.
          </li>
          <li>
            Start the container, read its log for migration errors, and run the
            search and permission rebuilds shown above if content looks
            incomplete.
          </li>
        </ol>

        <h2>Test your restores</h2>
        <p>
          A backup is evidence that something was written, not that you can
          recover your wiki. Restore into a separate instance on a private
          network, never over the live one, and check:
        </p>
        <ul className="checklist">
          <li>The number of books, chapters and pages matches the live wiki.</li>
          <li>Several recent pages open with the right title and content.</li>
          <li>Images display and attachments download.</li>
          <li>Search finds a page you know exists.</li>
          <li>An administrator and a regular member can both sign in.</li>
          <li>A user with multi-factor authentication can still sign in, a good sign that the <code>APP_KEY</code> is right.</li>
          <li>You wrote down the date, the backup used and the result.</li>
        </ul>
        <p>
          Counts alone do not prove everything is correct, but they catch the
          most common failure: an empty or partial import. Repeat the test
          after any change to your backup script, your server or your
          BookStack version.
        </p>

        <h2>How long to keep backups</h2>
        <p>
          Keep enough history to notice a problem before its last good copy is
          gone. A deleted chapter may not be missed for a week or two. A common
          pattern is daily backups for a couple of weeks plus a few weekly or
          monthly copies. Balance that against data protection: a backup keeps
          personal data that was deleted from the wiki, so write down your
          retention period and delete old copies on schedule.
        </p>
        <p>
          For comparison, BookHost makes daily backups and removes backups
          older than seven days at the next daily retention run; with
          scheduled runs, this can add up to 24 hours. A restore returns the
          workspace to its last nightly backup, so it can cost up to a day of
          changes. Backups currently live on the same server as the
          workspaces; a copy at a second location is in preparation. The{" "}
          <Link href="/reliability">reliability page</Link> has the details and
          the dated restore checks.
        </p>

        <h2>Moving instead of restoring</h2>
        <p>
          The same two artifacts, a database dump and a file archive, are what
          you need to move BookStack to another server or to managed hosting.
          If you are considering BookHost, the{" "}
          <Link href="/migrate">migration page</Link> uses the same dump
          commands and a tar command that normalises attachment paths, and{" "}
          <Link href="/blog/moving-self-hosted-bookstack-to-managed-hosting">
            this field report
          </Link>{" "}
          covers what breaks along the way. If you would rather not run backups
          at all, see <Link href="/pricing">pricing</Link> or our{" "}
          <Link href="/self-hosted-vs-managed-bookstack">
            self-hosted vs managed comparison
          </Link>
          .
        </p>
      </GuidePage>
    </>
  );
}
