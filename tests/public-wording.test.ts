import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public wording matches implemented behaviour", () => {
  it("A05 app/migrate/page.tsx 0", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("You can sign in with the credentials from your existing system. Your old passwords remain valid; our initial password expires.");
    expect(text).toContain("Local password hashes are preserved. Verify sign-in as an administrator and as a regular member as part of acceptance.");
  });
  it("A05 app/migrate/page.tsx 1", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("External login methods such as LDAP, SAML and OIDC need to be configured again on the new instance.");
    expect(text).toContain("Two-factor authentication (MFA) and external sign-in methods (LDAP, SAML, OIDC) require separate assessment and recovery or reconfiguration before cutover.");
  });
  it("A06 app/migrate/page.tsx 2", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("directories.\n            Run these commands");
    expect(text).toContain("Agree a shared snapshot time and freeze writes on the old system before exporting.\n            The database dump and file archive must describe the same read-only source.\n            Run these commands on your server, replacing the database name and\n            paths with your own values:");
  });
  it("A06 app/migrate/page.tsx 3", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("can continue running while we work on the new one.");
    expect(text).toContain("can continue serving read-only access while we work on the new one. Changes made after the export are not included in that import.");
  });
  it("A06 app/migrate/page.tsx 4", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("The usual process lets your old instance keep serving people while\n            the new instance is prepared and checked. Once you are happy, the\n            switch is a DNS or bookmark change to the new address. We do not\n            switch anything off on your server.");
    expect(text).toContain("Agree a shared snapshot time, freeze writes, export both files, then check\n            the imported workspace before cutover by DNS or bookmark change.\n            Keep the old system read-only through acceptance and cutover. For a\n            longer preparation period with resumed writes, arrange a final second\n            import from a fresh, consistent snapshot under a new write freeze,\n            repeat acceptance checks, then switch over. We do not switch anything\n            off on your server.");
  });
  it("A11 app/migrate/page.tsx 5", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("# Archive the BookStack uploads and files directories\ntar -czf bookstack-files.tar.gz -C /path/to/bookstack uploads files");
    expect(text).toContain("# Standard BookStack: normalize private attachments to files/ (GNU tar)\ntar -czf bookstack-files.tar.gz -C /path/to/bookstack/public uploads \\\n  --transform='s,^storage/uploads/files,files,' -C /path/to/bookstack storage/uploads/files\n\n# LinuxServer: run inside the container with /config mounted (use instead)\ntar -czf bookstack-files.tar.gz -C /config/www uploads files");
  });
  it("A12 app/migrate/page.tsx 6", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("Create a backup before every change we make.");
    expect(text).toContain("Create a recovery backup of the destination before starting the import.");
  });
  it("A13 app/migrate/page.tsx 7", async () => {
    const text = await readFile("app/migrate/page.tsx", "utf8");
    expect(text).not.toContain("Rewrite absolute links from the old address to the new one.");
    expect(text).toContain("When you supply the old base URL, rewrite matching links in supported current page HTML/Markdown, book and chapter descriptions, and image URLs. Settings, historical revisions and other fields require separate checks.");
  });
  it("A01/A10 content/legal/datenschutz.md 8", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("Wir handeln nach seiner Weisung als Auftragsverarbeiter; Chutes wird erst nach Erf\u00fcllung der in [Anlage 3 des AVV](avv.md) genannten Voraussetzungen als Unterauftragsverarbeiter eingesetzt.");
    expect(text).toContain("Wir handeln nach seiner Weisung als Auftragsverarbeiter. Chutes ist der KI-Dienst der technisch verf\u00fcgbaren Upload-Beta; die [Auftragsverarbeiterliste in Anlage 3 des AVV](avv.md) beschreibt den Datenumfang und die Voraussetzungen f\u00fcr personenbezogene Inhalte.");
  });
  it("A01/A10 content/legal/datenschutz.md 9", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("Die [Chutes-Nutzungsbedingungen](https://chutes.ai/terms) nennen Chutes Global Corp und das Recht von Nevis. Eine verbindliche Gesch\u00e4ftsanschrift und konkrete Inferenzl\u00e4nder sind \u00f6ffentlich nicht abschlie\u00dfend belegt; wir behaupten daher weder einen US-Sitz noch ausschlie\u00dflich europ\u00e4ische Verarbeitung. Details zu Standorten und Transfergarantien erhalten Kunden auf Anfrage und vor ihrer Freischaltung. Ohne dokumentierten Art.-28-Vertrag und zul\u00e4ssige Drittlandgarantien bleibt die KI-Verarbeitung deaktiviert. Inhalte \u00f6ffentlicher LLM-API-Anfragen werden bei Chutes nur f\u00fcr die jeweilige Anfrage im Arbeitsspeicher verarbeitet und nicht dar\u00fcber hinaus gespeichert. Bei BookHost gespeicherte Eingangsdokumente und Vorschl\u00e4ge unterliegen den L\u00f6schfristen f\u00fcr Kundeninhalte in Abschnitt 10; technische Anwendungsprotokolle werden nach 14 Tagen gel\u00f6scht.");
    expect(text).toContain("Die Upload-Beta ist technisch verf\u00fcgbar. Bei jedem Upload wird der extrahierte Text, nicht die Originaldatei, an Chutes Global Corp zur Erstellung eines Seitenentwurfs mit Zusammenfassung, Tags und Pr\u00fcfliste \u00fcbermittelt. Ohne Upload findet \u00fcber diese Funktion keine \u00dcbermittlung an Chutes statt. Originaldateien werden bei BookHost tempor\u00e4r gespeichert und nach Abschluss des Verarbeitungsversuchs entfernt; nach Unterbrechungen erfolgt die Bereinigung beim Start oder im st\u00fcndlichen Lauf f\u00fcr tempor\u00e4re Verzeichnisse, die \u00e4lter als 30 Minuten sind. Gespeicherter Quelltext wird bei Ver\u00f6ffentlichung oder Ablehnung entfernt. Intake-Eintr\u00e4ge einschlie\u00dflich Entw\u00fcrfen werden unabh\u00e4ngig von der Vertragslaufzeit nach 30 Tagen ab Erstellung beim n\u00e4chsten st\u00fcndlichen Bereinigungslauf gel\u00f6scht. F\u00fcr ver\u00f6ffentlichte BookStack-Seiten und Sicherungen gelten die Vertragsende-Fristen. Diese Beschreibung der technischen Verarbeitung belegt keinen abgeschlossenen Art.-28-Vertrag und keine dokumentierten Drittlandgarantien. Verbindliche Gesch\u00e4ftsanschrift, konkrete Inferenz- und Metadatenl\u00e4nder sowie beteiligte GPU-Unterauftragnehmer sind \u00f6ffentlich nicht abschlie\u00dfend belegt. Eine EU-exklusive Verarbeitung wird nicht zugesagt. Vor Nutzung mit personenbezogenen Kundeninhalten sind die Vertrags- und Transfernachweise gem\u00e4\u00df Anlage 3 des AVV erforderlich; bis dahin darf die Beta nur mit nicht personenbezogenen Beispieldokumenten genutzt werden. Diese Nutzungsbeschr\u00e4nkung ist keine technische Upload-Sperre. Anwendungsprotokolle werden nach 14 Tagen gel\u00f6scht.");
  });
  it("A01/A10 content/legal/avv.md 10", async () => {
    const text = await readFile("content/legal/avv.md", "utf8");
    expect(text).not.toContain("Die Upload-Beta ist technisch verf\u00fcgbar; der Kunde veranlasst die Inferenz \u00fcber Chutes mit jedem Upload. Dies ersetzt nicht die vor dem ersten Upload personenbezogener Kundeninhalte erforderlichen Vertrags- und Transfernachweise. Verbindliche Gesch\u00e4ftsanschrift, konkrete Inferenz- und Metadatenl\u00e4nder sowie beteiligte GPU-Unterauftragnehmer sind \u00f6ffentlich nicht abschlie\u00dfend belegt. Wir sagen keine EU-exklusive Verarbeitung zu. Der Kunde erh\u00e4lt diese Angaben und die f\u00fcr seinen Einsatz ma\u00dfgeblichen Vertrags- und Transferinformationen vor dem ersten Upload personenbezogener Kundeninhalte in Textform \u00fcber info@productivity-boost.com. Bis dahin darf die technisch verf\u00fcgbare Beta nur mit nicht personenbezogenen Beispieldokumenten genutzt werden. Inhalte \u00f6ffentlicher LLM-API-Anfragen werden bei Chutes nur w\u00e4hrend der Anfrage im Arbeitsspeicher verarbeitet und nicht dar\u00fcber hinaus gespeichert. Originaldateien werden nur vor\u00fcbergehend zur Textextraktion verarbeitet. Gespeicherter Quelltext wird bei Ver\u00f6ffentlichung oder Ablehnung entfernt; Intake-Eintr\u00e4ge einschlie\u00dflich Entw\u00fcrfen werden nach 30 Tagen beim st\u00fcndlichen Bereinigungslauf gel\u00f6scht. F\u00fcr ver\u00f6ffentlichte BookStack-Seiten und Sicherungen gilt Abschnitt 8; Anwendungsprotokolle nach 14 Tagen, Sicherheitsprotokolle nach 30 Tagen.");
    expect(text).toContain("Die Upload-Beta ist technisch verf\u00fcgbar. Bei jedem Upload wird der extrahierte Text, nicht die Originaldatei, an Chutes Global Corp zur Erstellung eines Seitenentwurfs mit Zusammenfassung, Tags und Pr\u00fcfliste \u00fcbermittelt. Ohne Upload findet \u00fcber diese Funktion keine \u00dcbermittlung an Chutes statt. Originaldateien werden bei BookHost tempor\u00e4r gespeichert und nach Abschluss des Verarbeitungsversuchs entfernt; nach Unterbrechungen erfolgt die Bereinigung beim Start oder im st\u00fcndlichen Lauf f\u00fcr tempor\u00e4re Verzeichnisse, die \u00e4lter als 30 Minuten sind. Gespeicherter Quelltext wird bei Ver\u00f6ffentlichung oder Ablehnung entfernt. Intake-Eintr\u00e4ge einschlie\u00dflich Entw\u00fcrfen werden unabh\u00e4ngig von der Vertragslaufzeit nach 30 Tagen ab Erstellung beim n\u00e4chsten st\u00fcndlichen Bereinigungslauf gel\u00f6scht. F\u00fcr ver\u00f6ffentlichte BookStack-Seiten und Sicherungen gelten die Vertragsende-Fristen. Diese Beschreibung der technischen Verarbeitung belegt keinen abgeschlossenen Art.-28-Vertrag und keine dokumentierten Drittlandgarantien. Verbindliche Gesch\u00e4ftsanschrift, konkrete Inferenz- und Metadatenl\u00e4nder sowie beteiligte GPU-Unterauftragnehmer sind \u00f6ffentlich nicht abschlie\u00dfend belegt. Wir sagen keine EU-exklusive Verarbeitung zu. Vor Nutzung mit personenbezogenen Kundeninhalten sind die nachstehenden Vertrags- und Transfernachweise erforderlich; bis dahin darf die Beta nur mit nicht personenbezogenen Beispieldokumenten genutzt werden. Diese Nutzungsbeschr\u00e4nkung ist keine technische Upload-Sperre. F\u00fcr ver\u00f6ffentlichte BookStack-Seiten und Sicherungen gilt Abschnitt 8; Anwendungsprotokolle nach 14 Tagen, Sicherheitsprotokolle nach 30 Tagen.");
  });
  it("A01 content/legal/datenschutz.md 11", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("F\u00fcr Chutes sind Sitz und Datenfl\u00fcsse vor der Aktivierung abschlie\u00dfend zu dokumentieren;");
    expect(text).toContain("F\u00fcr die Nutzung von Chutes mit personenbezogenen Kundeninhalten sind Sitz und Datenfl\u00fcsse abschlie\u00dfend zu dokumentieren;");
  });
  it("A01 app/reliability/page.tsx 12", async () => {
    const text = await readFile("app/reliability/page.tsx", "utf8");
    expect(text).not.toContain("Document intake is a beta feature. AI processing remains disabled\n              while we do not have a documented data processing agreement with\n              the model provider and the required safeguards for international\n              transfers. See our");
    expect(text).toContain("Document intake is available in beta. Each upload sends extracted text,\n              not the original file, to Chutes for AI drafting. Without an upload,\n              this feature sends nothing to Chutes. Source text is removed on\n              publication or rejection; intake records and drafts are deleted\n              after 30 days from creation in the next hourly cleanup. Technical\n              availability does not establish a provider DPA or international\n              transfer safeguards. Until those prerequisites are documented, use\n              only non-personal example documents. See our");
  });
  it("A07 content/legal/avv.md 13", async () => {
    const text = await readFile("content/legal/avv.md", "utf8");
    expect(text).not.toContain("F\u00fcr die Inferenz werden ausschlie\u00dflich vereinbarte TEE-Modelle genutzt. Die tats\u00e4chliche TEE-Eigenschaft des gew\u00e4hlten Endpunkts wird gepr\u00fcft; eine beliebige Modellbezeichnung gen\u00fcgt nicht. Ohne zul\u00e4ssigen Endpunkt wird der Vorgang gestoppt.");
    expect(text).toContain("Die Standardkonfiguration verwendet Modellnamen mit TEE-Kennzeichnung. Der Inferenzpfad pr\u00fcft keine TEE-Attestierung und sperrt abweichend konfigurierte Modellnamen nicht. Die Modellbezeichnung allein belegt daher keine tats\u00e4chliche TEE-Eigenschaft.");
  });
  it("A07 content/legal/datenschutz.md 14", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("Als KI-Dienst ist Chutes, betrieben von Chutes Global Corp, vorgesehen. Die Inferenz erfolgt in einem Trusted Execution Environment (TEE).");
    expect(text).toContain("Als KI-Dienst wird Chutes, betrieben von Chutes Global Corp, genutzt. Die Standardkonfiguration verwendet Modellnamen mit TEE-Kennzeichnung; der Inferenzpfad pr\u00fcft keine TEE-Attestierung und sperrt abweichend konfigurierte Modellnamen nicht.");
  });
  it("A07 content/legal/avv.md 15", async () => {
    const text = await readFile("content/legal/avv.md", "utf8");
    expect(text).not.toContain("KI-Inferenz in einem Trusted Execution Environment (TEE) |");
    expect(text).toContain("KI-Inferenz; Standardmodellnamen mit TEE-Kennzeichnung, keine technische Attestierungspr\u00fcfung |");
  });
  it("A14 content/legal/datenschutz.md 16", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("T\u00e4gliche Sicherungen werden sieben Tage aufbewahrt.");
    expect(text).toContain("Die laufende Backup-Rotation entfernt Sicherungen, die \u00e4lter als sieben Tage sind, beim n\u00e4chsten t\u00e4glichen Lauf; bei planm\u00e4\u00dfigem Betrieb k\u00f6nnen bis zu 24 Stunden hinzukommen.");
  });
  it("A14 content/legal/avv.md 17", async () => {
    const text = await readFile("content/legal/avv.md", "utf8");
    expect(text).not.toContain("Ihre Aufbewahrung betr\u00e4gt sieben Tage.");
    expect(text).toContain("Die laufende Backup-Rotation entfernt Sicherungen, die \u00e4lter als sieben Tage sind, beim n\u00e4chsten t\u00e4glichen Lauf; bei planm\u00e4\u00dfigem Betrieb k\u00f6nnen bis zu 24 Stunden hinzukommen.");
  });
  it("A14 content/legal/agb.md 18", async () => {
    const text = await readFile("content/legal/agb.md", "utf8");
    expect(text).not.toContain("t\u00e4gliche Backups mit sieben Tagen Aufbewahrung");
    expect(text).toContain("t\u00e4gliche Backups mit altersbasierter Rotation gem\u00e4\u00df Abschnitt 6");
  });
  it("A14 content/legal/agb.md 19", async () => {
    const text = await readFile("content/legal/agb.md", "utf8");
    expect(text).not.toContain("Wir erstellen t\u00e4glich Sicherungen der f\u00fcr die Wiederherstellung erforderlichen Instanzdaten und bewahren sie sieben Tage auf.");
    expect(text).toContain("Wir erstellen t\u00e4glich Sicherungen der f\u00fcr die Wiederherstellung erforderlichen Instanzdaten. Die laufende Backup-Rotation entfernt Sicherungen, die \u00e4lter als sieben Tage sind, beim n\u00e4chsten t\u00e4glichen Lauf; bei planm\u00e4\u00dfigem Betrieb k\u00f6nnen bis zu 24 Stunden hinzukommen.");
  });
  it("A14 lib/landing-copy.ts 20", async () => {
    const text = await readFile("lib/landing-copy.ts", "utf8");
    expect(text).not.toContain("We make daily backups and retain them for seven days.");
    expect(text).toContain("We make daily backups. Backups older than seven days are removed at the next daily retention run; with scheduled runs, this can add up to 24 hours.");
  });
  it("A14 lib/landing-copy.ts 21", async () => {
    const text = await readFile("lib/landing-copy.ts", "utf8");
    expect(text).not.toContain("Your instance is backed up daily, with seven days of retained backups and restore help through support.");
    expect(text).toContain("Your instance is backed up daily, with restore help through support. Backups older than seven days are removed at the next daily retention run; with scheduled runs, this can add up to 24 hours.");
  });
  it("A14 app/reliability/page.tsx 22", async () => {
    const text = await readFile("app/reliability/page.tsx", "utf8");
    expect(text).not.toContain("keep seven days of backups locally. A first backup is triggered");
    expect(text).toContain("remove local backups older than seven days at the next daily retention\n              run; with scheduled runs, this can add up to 24 hours. A first backup is triggered");
  });
  it("A14 content/blog/how-we-test-every-bookstack-backup-restore.md 23", async () => {
    const text = await readFile("content/blog/how-we-test-every-bookstack-backup-restore.md", "utf8");
    expect(text).not.toContain("Local retention is **seven elapsed days**, based on UTC backup dates, rather than a fixed number of archives.");
    expect(text).toContain("Backups older than seven days are removed at the next daily retention run; with scheduled runs, this can add up to 24 hours. Backup ages use UTC dates, rather than a fixed number of archives.");
  });
  it("A17 content/blog/how-we-test-every-bookstack-backup-restore.md 24", async () => {
    const text = await readFile("content/blog/how-we-test-every-bookstack-backup-restore.md", "utf8");
    expect(text).not.toContain("Our backup job is scheduled daily. It briefly stops the selected team\u2019s BookStack application, takes a consistent MariaDB dump and archives the application files, uploads and configuration. It also saves the deployment definition and a small set of content measurements for later comparison. The application then resumes; an already stopped tenant stays stopped. The interruption matters because a database and its uploaded files need to describe the same wiki.");
    expect(text).toContain("Updated 10 September 2026: the daily backup job now tries a hot backup while BookStack remains running. It compares database/content fingerprints and upload hashes around the dump and file archive. After three inconsistent hot attempts, it falls back to a cold backup that briefly stops the application and then resumes it. An already stopped tenant is skipped and stays stopped. The backup also saves the deployment definition and content measurements for later comparison.");
  });
  it("A15 content/legal/datenschutz.md 25", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("Wir speichern kein Klartextpasswort.");
    expect(text).toContain("Das Dashboard-Passwort speichern wir nicht im Klartext. F\u00fcr neu angelegte BookStack-Zug\u00e4nge h\u00e4lt die Kontoverwaltung dagegen generierte Initialpassw\u00f6rter im Klartext zur einmaligen Anzeige bereit. Beim Abruf wird der jeweilige Wert in der Kontoverwaltung gel\u00f6scht; f\u00fcr dort noch nicht abgerufene Werte gibt es keine zeitgesteuerte Ablaufbereinigung.");
  });
  it("A16 lib/landing-copy.ts 26", async () => {
    const text = await readFile("lib/landing-copy.ts", "utf8");
    expect(text).not.toContain("Review the proposed page, summary, tags and reviewer checklist alongside the source.");
    expect(text).toContain("Review the proposed page, summary, tags and reviewer checklist alongside the source preview (first 2,000 characters). Keep your original document for the full comparison.");
  });
  it("A16 content/blog/bookstack-hosted-with-reviewed-document-intake.md 27", async () => {
    const text = await readFile("content/blog/bookstack-hosted-with-reviewed-document-intake.md", "utf8");
    expect(text).not.toContain("A person checks the source, edits the proposal and chooses where it belongs.");
    expect(text).toContain("A person checks the source preview (first 2,000 characters), uses their original document for the full comparison, edits the proposal and chooses where it belongs.");
  });
  it("A18 app/page.tsx 28", async () => {
    const text = await readFile("app/page.tsx", "utf8");
    expect(text).not.toContain("wissen.app.mintapis.com)");
    expect(text).toContain("demo.bookhost.co)");
  });
  it("A19 content/legal/datenschutz.md 29", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).not.toContain("ein aus der IP-Adresse abgeleiteter Z\u00e4hler f\u00fcr h\u00f6chstens eine Stunde im Arbeitsspeicher gehalten");
    expect(text).toContain("ein aus der IP-Adresse abgeleiteter Z\u00e4hler im Arbeitsspeicher gef\u00fchrt. Seine G\u00fcltigkeit endet nach einer Stunde; abgelaufene Eintr\u00e4ge werden beim n\u00e4chsten Aufruf der Ratenbegrenzung entfernt");
  });
  it("A20 content/legal/datenschutz.md 30", async () => {
    const text = await readFile("content/legal/datenschutz.md", "utf8");
    expect(text).toContain("| Control-Plane: `wissen-checkout` | Zuordnung des Checkouts auf `/welcome`; HttpOnly, SameSite=Lax, Secure bei HTTPS | 24 Stunden |\n| BookStack: `bookstack_session`");
  });
});

it("answers the self-hoster's first question near the top of the home page", async () => {
  // The BookStack installation docs send us people who already run their own
  // instance. The pointer to what moving involves must stay above the fold.
  const fs = await import("node:fs/promises");
  const source = await fs.readFile("app/page.tsx", "utf8");
  const hero = source.slice(0, source.indexOf("<PaymentNote />"));
  expect(hero).toContain('href="/migrate"');
});

it("says what a restore cannot bring back", async () => {
  // We sell tested restores. Then we owe the reader the other half: a daily
  // backup means a recovery can cost the changes made since the last run.
  const fs = await import("node:fs/promises");
  const source = await fs.readFile("app/reliability/page.tsx", "utf8");
  expect(source).toMatch(/last nightly\s+backup/);
  expect(source).toMatch(/up to a day of changes/);
});

it("keeps the honest caveat next to the restore evidence", async () => {
  // The post may state what we verified, but never without saying that not
  // every nightly backup is restore-tested automatically.
  const fs = await import("node:fs/promises");
  const post = await fs.readFile(
    "content/blog/how-we-test-every-bookstack-backup-restore.md",
    "utf8",
  );
  expect(post).toContain("we do not currently restore-test every");
  expect(post).toMatch(/matched by SHA-256/);
});
