# Organizer

Persönliche To-do- und Planungs-App (PWA) – Listen, Unteraufgaben, Priorität, Tags, Zeithorizonte,
Tages- und Zeitblock-Planung, Live-Sync zwischen Handy und Laptop.

**Stack:** React + TypeScript + Vite (PWA) · Cloudflare Worker mit Durable Object (SQLite, Live-Sync per WebSocket) · alles im Gratis-Tarif

## Bedienung

- **Board** – Spalten = Listen, ganz links der Stapel **Unsortiert**. Karten per Drag & Drop verschieben und sortieren
  (Handy: lange drücken), Spalten am Titel verschieben. Umschalter **Woche**: Spalten = die nächsten 7 Tage.
- **Einsortieren** – Knopf im Stapel „Unsortiert“: Karte für Karte einer Liste (Taste 1–9) und optional einem Tag (H/M/W/N) zuordnen.
- **Heute** – Aufgaben des Tages links, Zeitraster mit Google-Terminen rechts. Aufgaben ins Raster ziehen = einplanen,
  Blöcke verschieben, unten am Block ziehen = Dauer ändern, zurück in „Zu planen“ ziehen = Uhrzeit weg.
- **Kalender** – Wochenansicht (Handy: 3 Tage). Klick auf einen Termin → „Als Aufgabe übernehmen“. Klick in eine freie Stelle → neue Aufgabe zu der Uhrzeit.
- **Eingabesprache** – überall, wo man Aufgaben tippt (Schnelleingabe `N`, Spalten, „Heute“, Strg+K, Unteraufgaben
  und auch beim Umbenennen im Aufgaben-Blatt). Erkannte Teile werden farbig markiert und als Felder übernommen:
  - Tag: `heute`, `morgen`, `Freitag`, `nächsten Fr`, `in 3 Tagen`, `nächste Woche`, `am Wochenende`, `12.12.`, `3. Januar`
  - Uhrzeit: `14 Uhr`, `um 9`, `9:30`, `14–16 Uhr`, `morgen früh`, `heute Abend`, `nachmittags`
  - Frist: `bis Freitag`, `bis morgen früh`, `bis 12.12. 18 Uhr`, `Frist Monatsende` (Fristen mit Uhrzeit erinnern 1 Std. vorher)
  - Dauer: `30 min`, `2h`, `1h30` · Wiederholen: `täglich`, `werktags`, `jeden Montag`, `montags und donnerstags`, `alle 2 Wochen`, `jeden 1.`
  - Wichtigkeit: `dringend`, `wichtig`, `prio 2`, `unwichtig`, `!1`–`!3` · Horizont: `kurzfristig`, `langfristig`, `irgendwann`
  - Verknüpfen: `warte auf 4`, `warte auf Folien`, `unter 7`, `unter Präsentation` – jede Aufgabe hat eine kleine **Nummer** (auf der Karte)
  - `@liste`, `#tag`, `// Notiz` · Text in `"Anführungszeichen"` bleibt wörtlich
  - Nach „warte auf“, „unter“, `@` und `#` kommen Vorschläge (`Tab` übernimmt, auf dem Handy antippen). Spickzettel: `?` in der Schnelleingabe.
- **Wiederholen** (täglich, werktags, wöchentlich …): Abhaken schiebt die Aufgabe auf den nächsten Termin.
- Unerledigte Tagesaufgaben wandern automatisch auf heute (↻ zeigt, wie oft). Alles hat „Rückgängig“.
- **Unteraufgaben** stehen direkt auf den Karten und lassen sich dort abhaken (ein-/ausblenden: Knopf oben oder Taste `U`).
- **Wartet auf**: im Aufgaben-Blatt eine andere Aufgabe wählen → die Aufgabe ist 🔒 blockiert, bis die andere erledigt ist.
- **Fristen** getrennt vom Plan-Tag: Chip wird gelb (≤ 3 Tage) bzw. rot; in „Heute“ unter „Fristen bald“.
- **Vorlagen**: Aufgabe (mit Unteraufgaben) → „Als Vorlage“; anlegen über Schnelleingabe, Spaltenmenü oder `Strg`+`K`.
- **Filter & Ansichten** (Taste `F`): Liste, Wann, Priorität, Frist, blockiert/machbar, Tags – als Ansicht speichern, synchron auf allen Geräten.
- **Befehle** (`Strg`/`⌘`+`K`): Aufgaben, Listen, Vorlagen, Ansichten finden, Aktionen ausführen – oder direkt neue Aufgabe tippen.
- **Tag planen / abschließen**: morgens Reste klären → Fokus wählen → automatisch in freie Lücken einplanen; abends Rückblick und Offenes bewusst verschieben.
- **Offline**: Änderungen wirken sofort und warten bei fehlendem Netz in einer Warteschlange (Anzeige oben), die App startet auch ohne Netz.
- **Erinnerungen** (Einstellungen): Push vor Aufgaben mit Uhrzeit, Morgenübersicht, Abend-Erinnerung.
- **Android**: „Teilen“ → Organizer legt eine Aufgabe an (Link in den Notizen); langes Drücken aufs App-Symbol: Neu / Tag planen / Heute.
- Tasten: `Strg`+`K` Befehle · `N` neu · `/` suchen · `F` Filter · `U` Unteraufgaben · `1` `2` `3` Ansicht · `T` heute · `Esc` schließen

## Google Kalender & Google Aufgaben

- Aufgaben **mit Uhrzeit** landen als Termin in einem eigenen Google-Kalender **„Organizer“** (mit Google-Erinnerung, solange in der App
  keine Push-Erinnerungen aktiv sind). Verschiebt oder löscht man sie dort, zieht die App nach; Termine, die man direkt im Kalender
  „Organizer“ anlegt, werden zu Aufgaben. Alle anderen Kalender werden nur angezeigt (Auswahl in den Einstellungen).
- Aufgaben **mit Tag, ohne Uhrzeit** landen als **Google Aufgabe** in der Liste **„Organizer“** – in der Google-Kalender-App am jeweiligen
  Tag mit Häkchen. Abhaken (auch wiederkehrende: die rücken vor), Umbenennen, Verschieben und neue Aufgaben in dieser Liste kommen
  zurück in die App (alle 10 Min. und beim Öffnen). In Google gelöscht → die Aufgabe bleibt in der App, nur ohne Tag.
  Bekommt eine Aufgabe eine Uhrzeit, wird aus der Google Aufgabe ein Termin. Ein/aus in den Einstellungen (aus = Liste wird in Google entfernt).

Einrichtung (einmalig): Google-Cloud-Projekt → **Google Calendar API** und **Google Tasks API** aktivieren → Zustimmungsbildschirm „Extern“,
auf **In Produktion** stellen → OAuth-Client „Webanwendung“ mit Weiterleitungs-URI `https://<deine-domain>/api/google/callback`
→ im Worker die Variablen `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` setzen → in der App unter Einstellungen verbinden.
Berechtigungen: `calendar.readonly` (lesen), `calendar.app.created` (nur der eigene Kalender „Organizer“ wird beschrieben) und `tasks` (Google Aufgaben;
die App schreibt nur in ihre Liste „Organizer“). Wer schon vor 0.5 verbunden war: Tasks API aktivieren und in den Einstellungen „Neu verbinden“.

## Aufbau

- `src/` – die App (React). Spricht nur mit `/api/…`.
- `worker/index.ts` – Einstieg: liefert die App-Dateien aus, leitet `/api/*` an das Durable Object weiter.
- `worker/store.ts` – **ein** Durable Object `OrganizerStore` hält alles: SQLite-Datenbank, Anmeldung
  (Passwort aus dem Secret `APP_PASSWORD`, Sitzungen per Cookie), REST-API und die WebSocket-Verbindungen
  für den Live-Sync. Nächtliches Aufräumen per Alarm.
- `worker/google.ts` – schlanker Google-Client (OAuth mit PKCE, Calendar- und Tasks-API).
- `worker/push.ts` – Web-Push ohne Bibliothek: VAPID-Signatur per WebCrypto, leerer „Stups“; der Service Worker
  (`src/sw.ts`) holt den Inhalt danach über `/api/push/pending` ab.
- `src/lib/lang.ts` – Eingabesprache (Parser mit Positionen für die Markierung), `src/lib/compose.ts` macht daraus Felder,
  `src/components/SmartField.tsx` ist das Eingabefeld mit Markierung und Vorschlägen.
- `src/lib/ops.ts` – Offline-Warteschlange: jede Änderung ist eine Operation mit eigener id (Header `X-Op-Id`),
  der Server erkennt Wiederholungen und führt nichts doppelt aus.
- `shared/` – Wiederholungen und Zeitzonen-Rechnung, von App und Worker gemeinsam genutzt.
- `worker/migrations.ts` – Datenbankschema; fehlende Migrationen spielt das Objekt beim Start selbst ein.
  Nur neue Migrationen anhängen, bestehende nie ändern.

## Entwicklung

```bash
npm install
cp .dev.vars.example .dev.vars   # lokales Passwort
npm run preview                  # baut die App und startet Worker + Datenbank lokal auf :8787
npm run typecheck
```

Für schnelles UI-Arbeiten: `npm run dev:api` (Worker auf :8787) und parallel `npm run dev` (Vite mit Proxy).

## Deployment (Cloudflare Workers Builds)

- Code hochladen: `push.cmd` doppelklicken (committet alles und pusht nach GitHub). `tokens/` ist ausgeschlossen.
- Cloudflare baut bei jedem Push auf `main` automatisch: Build-Befehl `npm run build`, Deploy-Befehl `npx wrangler deploy`.
- Einmalig im Dashboard unter Worker → Settings → Variables and Secrets: Secret **`APP_PASSWORD`** setzen.

## Fahrplan

1. ✅ Grundgerüst, Live-Sync, installierbar
2. ✅ Board mit Drag & Drop, Stapel „Unsortiert“, Wochenplanung, Tagesplaner, Kalender, Wiederholungen
3. ✅ Google Kalender in beide Richtungen
4. ✅ Push-Erinnerungen, Offline-Warteschlange, Tag-planen-Ritual, Fristen, Blockaden, Vorlagen, Filter, Befehlspalette
5. ✅ Eingabesprache, Aufgabennummern, geschätzte Dauer, Fristen mit Uhrzeit
6. ✅ Google Aufgaben in beide Richtungen
7. Import aus anderen Google-Aufgabenlisten (TasksBoard)

## Versionen

- **0.5** (22.11.2026): Aufgaben mit Tag als Google Aufgaben (Liste „Organizer“, in beide Richtungen); Fix: erstmals eingeplante Aufgaben kamen nicht immer im Google Kalender an
- **0.4** (22.11.2026): Eingabesprache mit Markierung und Vorschlägen, Aufgabennummern, geschätzte Dauer, Fristen mit Uhrzeit (+ Erinnerung)
- **0.3** (22.11.2026): Tag planen/abschließen, Fristen, „Wartet auf“, Unteraufgaben auf Karten, Vorlagen, Filter & Ansichten,
  Befehlspalette, Offline-Modus, Push-Erinnerungen + Morgenübersicht, Teilen-Ziel & App-Verknüpfungen
- **0.2** (21.11.2026): Board mit Drag & Drop, Stapel „Unsortiert“, Woche, Heute-Planer, Kalender, Wiederholungen, Google Kalender
- **0.1** (21.11.2026): Grundgerüst
