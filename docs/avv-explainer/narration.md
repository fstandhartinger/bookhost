# AVV & Drittlandtransfer — Erklärvideo-Narration

Handhabung: Der Text je Szene entspricht exakt `scenes.json.<scene>.narration`; die Sprechfassung mit aufgelösten Abkürzungen steht in `scenes.json.<scene>.tts`. Prüfung: `python3 docs/avv-explainer/check_script.py`.

## s1 — Was ist das Thema?

„AVV und Drittlandtransfer für Chutes“ — was soll das heißen, geht es um Datenschutz, und musst du etwas tun? Kurz gesagt: Ja, das ist ein Datenschutzthema. Und vorweg: Nach dem aktuellen Stand musst du nichts tun.

## s2 — Der AVV

AVV heißt Auftragsverarbeitungsvertrag nach Artikel 28 DSGVO. Der Kunde verantwortet die Inhalte seines Wikis; er ist der Verantwortliche. BookHost verarbeitet sie in seinem Auftrag, und der AVV legt fest, was BookHost damit tun darf. Auch die Dienstleister von BookHost stehen dort, etwa Hetzner für die Server und der KI-Anbieter als Unterauftragsverarbeiter.

## s3 — Drittlandtransfer

Verlassen personenbezogene Daten die EU oder den EWR, spricht man von einem Drittlandtransfer. Nach Artikel 44 ff. DSGVO braucht so etwas eine Grundlage: etwa einen Angemessenheitsbeschluss oder EU-Standardvertragsklauseln mit einer dokumentierten Prüfung.

## s4 — Warum Chutes Thema war

Die KI-Funktionen — Dokument-Eingang und Antworten aus dem Wiki — schicken Kundentext an einen KI-Anbieter. Chutes sitzt außerhalb der EU. Für personenbezogene Kundendaten hätte es dafür eine Transfergrundlage und zusätzliche Unterlagen gebraucht.

## s5 — Die Entscheidung

Am 14. und 15. September 2026 entschied Florian sich für den EU-Weg: TensorX Limited aus Dublin, Irland. Laut Anbieter stehen die Rechner in Dublin und Helsinki, und Eingaben und Antworten werden nicht gespeichert. Die Datenschutzerklärung und der AVV von BookHost nennen TensorX.

## s6 — Stand heute

Die KI-Funktionen sind technisch als Beta verfügbar. Für personenbezogene Kundendaten gelten sie erst als freigegeben, wenn die Unterlagen von TensorX abschließend geprüft sind: der Vertrag zur Auftragsverarbeitung, die Unterauftragsverarbeiterliste und die Verarbeitungsorte. Bis dahin laufen nur Beispieldokumente ohne Personenbezug.

## s7 — Deine Aufgabe

Im Moment musst du nichts tun. Den letzten Prüfschritt bereiten wir vor, und erst danach werben wir bei Kunden mit den KI-Funktionen. Das ist eine Erklärung, keine Rechtsberatung.
