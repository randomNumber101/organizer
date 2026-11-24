# Organizer

Persönliche To-do- und Planungs-App (PWA) – Listen, Unteraufgaben, Priorität, Tags, Zeithorizonte,
Tages- und Zeitblock-Planung, Live-Sync zwischen Handy und Laptop.

**Stack:** React + TypeScript + Vite (PWA) · Cloudflare Worker mit Durable Object (SQLite, Live-Sync per WebSocket) · alles im Gratis-Tarif

## Bedienung

- **Board** – Spalten = Listen, ganz links der Stapel **Unsortiert**. Karten per Drag & Drop verschieben und sortieren
  (Handy: lange drücken), Spalten am Titel verschieben. Umschalter **Woche**: Spalten = die nächsten 7 Tage.
- **Einsortieren** – Knopf im Stapel „Unsortiert“: Karte für Karte einer Liste (Taste 1–9) und optional einem Tag (H/M/W/N) zuordnen.
- **Heute** – den Tag gestalten, ohne Uhrzeiten: die Aufgaben des Tages in **eigener Reihenfolge** (am Griff ziehen,
  Menü „Als Nächstes“/„Ans Ende“), umschaltbar auf **Dauer** (Mini ≤ 5 min · Zwischendurch ≤ 15 min · Länger ≥ 30 min · ohne Dauer)
  und **Priorität**. Dauer-Chip antippen = schätzen. Oben **Als Nächstes** mit **Fokus-Timer** (Pause, +5 min, „Später“),
  Fortschritt, Zeit bis Tagesende und Hinweis, was bis zum nächsten Termin noch reinpasst. Darunter „Liegen geblieben“,
  „Wartet noch“, „Fristen bald“, „Erledigt“. Der Kalender ist über das Kalender-Symbol seitlich einblendbar (Handy: Blatt von unten).
- **Kalender** – Ansichten **Tag, 3 Tage, Woche, Monat, Jahr, Liste** (Tasten `D` `X` `W` `M` `J` `L`, blättern mit `←` `→`, `E` neuer Termin),
  Kalenderwochen, Mini-Monat zum Springen, Suche in Terminen, Kalender ein-/ausblenden und eigene Farben (Seitenleiste; am Handy: auf den Titel tippen).
  **Termine anlegen** durch Aufziehen im Raster (oder Klick/„+ Termin“) – der Titel versteht die Eingabesprache („Zahnarzt morgen 14 Uhr“);
  Kalender, Farbe, Wiederholung, Erinnerung, Ort, Beschreibung; wahlweise als Aufgabe. Termine **ziehen** (verschieben, auch im Monat auf andere Tage),
  unten am Block die Länge ändern, antippen zum Bearbeiten/Löschen (bei Serien: nur dieser oder alle). Kalender ohne Schreibrecht: nur ansehen.
  Seitenleiste „Einplanen“: Aufgaben ins Raster ziehen.
- **Eingabesprache** – überall, wo man Aufgaben tippt (Schnelleingabe `N`, Spalten, „Heute“, Strg+K, Unteraufgaben
  und auch beim Umbenennen im Aufgaben-Blatt). Erkannte Teile werden farbig markiert und als Felder übernommen:
  - Tag: `heute`, `morgen`, `Freitag`, `nächsten Fr`, `in 3 Tagen`, `nächste Woche`, `am Wochenende`, `12.12.`, `3. Januar`
  - Uhrzeit: `14 Uhr`, `um 9`, `9:30`, `14–16 Uhr`, `morgen früh`, `heute Abend`, `nachmittags`
  - Frist: `bis Freitag`, `bis morgen früh`, `bis 12.12. 18 Uhr`, `Frist Monatsende` (Fristen mit Uhrzeit erinnern 1 Std. vorher)
  - Dauer: `30 min`, `2h`, `1h30` · Wiederholen: `täglich`, `werktags`, `jeden Montag`, `montags und donnerstags`, `alle 2 Wochen`, `jeden 1.`
  - Wichtigkeit 0–5 (5 = dringend): `dringend` (5), `wichtig` (4), `prio 3`, `p2`, `unwichtig` (1), `!0`–`!5`, `!!!`/`!!` · Horizont: `kurzfristig`, `langfristig`, `irgendwann`
  - Verknüpfen: `warte auf 4`, `warte auf Folien`, `unter 7`, `unter Präsentation` – jede Aufgabe hat eine kleine **Nummer** (auf der Karte)
  - `@liste`, `#tag`, `// Notiz` · Text in `"Anführungszeichen"` bleibt wörtlich
  - Nach „warte auf“, „unter“, `@` und `#` kommen Vorschläge (`Tab` übernimmt, auf dem Handy antippen). Spickzettel: `?` in der Schnelleingabe.
- **Wiederholen** (täglich, werktags, wöchentlich …): Abhaken schiebt die Aufgabe auf den nächsten Termin.
- Unerledigte Tagesaufgaben wandern automatisch auf heute (↻ zeigt, wie oft). Alles hat „Rückgängig“.
- **Unteraufgaben** stehen direkt auf den Karten und lassen sich dort abhaken (ein-/ausblenden: Knopf oben oder Taste `U`).
- **Wartet auf**: im Aufgaben-Blatt eine andere Aufgabe wählen → die Aufgabe wartet, bis die andere erledigt ist. Sie bleibt ganz normal in
  den Listen, nur mit 🔒 und durchsichtiger; „Als Nächstes“ überspringt sie.
- **Wichtigkeit 0–5**: 0 = keine, 1 sehr niedrig … 4 hoch, 5 dringend (Skala im Aufgaben-Blatt und im Menü der Zeile, Zahl auf der Karte).
- **Ziehen überall**: Karten und Zeilen an jeder Stelle greifen (Handy: kurz halten oder am Griff ⋮⋮), auch in „Heute“ nach Dauer/Wichtigkeit –
  in eine andere Gruppe gezogen übernimmt die Aufgabe deren Dauer bzw. Wichtigkeit. Unteraufgaben im Aufgaben-Blatt sortieren sich auch per Ziehen.
- **Teilaufgaben** (große Aufgaben in Sitzungen): „Aufteilen …“ (2–4 Teile mit Dauer und Tag) oder **„Teil erledigt …“** (z. B. 1 h von 2 h
  geschafft – der Rest bleibt als nächster Teil: an derselben Stelle, später, morgen, an einem Tag). Mit **Strg** (⌘/Alt) gezogen spaltet
  man einen Teil ab und legt ihn woanders hin (Heute, Woche, Kalender-Raster). Teile sehen aus wie Blätter eines Stapels und tragen
  „Teil 1/2“; die Hauptaufgabe zeigt den Fortschritt und ist erledigt, sobald alle Teile erledigt sind. In Google: „Titel (Teil 1/2)“.
- **Fristen** getrennt vom Plan-Tag: Chip wird gelb (≤ 3 Tage) bzw. rot; in „Heute“ unter „Fristen bald“.
- **Vorlagen**: Aufgabe (mit Unteraufgaben) → „Als Vorlage“; anlegen über Schnelleingabe, Spaltenmenü oder `Strg`+`K`.
- **Filter & Ansichten** (Taste `F`): Liste, Wann, Priorität, Frist, blockiert/machbar, Tags – als Ansicht speichern, synchron auf allen Geräten.
- **Befehle** (`Strg`/`⌘`+`K`): Aufgaben, Listen, Vorlagen, Ansichten finden, Aktionen ausführen – oder direkt neue Aufgabe tippen.
- **Tag planen / abschließen**: morgens Reste klären → aus allen Aufgaben ohne Termin wählen (gruppiert: *Wichtig & Fristen*,
  *Kleinere Aufgaben*, *Alle anderen* nach Listen, mit Suche; Unteraufgaben stehen unter ihrer Aufgabe und lassen sich auch einzeln holen)
  → Reihenfolge per Ziehen und Dauer schätzen (ohne Uhrzeiten) → „Heute“ zeigt danach immer, was als Nächstes dran ist;
  abends Rückblick und Offenes bewusst verschieben.
- **Offline**: Änderungen wirken sofort und warten bei fehlendem Netz in einer Warteschlange (Anzeige oben), die App startet auch ohne Netz.
- **Erinnerungen** (Einstellungen): Push vor Aufgaben mit Uhrzeit und vor Google-Terminen, Morgenübersicht, Abend-Erinnerung.
- **Android**: „Teilen“ → Organizer legt eine Aufgabe an (Link in den Notizen); langes Drücken aufs App-Symbol: Neu / Tag planen / Heute.
- Tasten: `Strg`+`K` Befehle · `N` neu · `/` suchen · `F` Filter · `U` Unteraufgaben · `1` `2` `3` Ansicht · `T` heute · `Esc` schließen ·
  im Kalender `D` `X` `W` `M` `J` `L`, `←` `→`, `E`

## Google Kalender & Google Aufgaben

- Aufgaben **mit Uhrzeit** landen als Termin in einem eigenen Google-Kalender **„Organizer“** (mit Google-Erinnerung, solange in der App
  keine Push-Erinnerungen aktiv sind). Verschiebt oder löscht man sie dort, zieht die App nach; Termine, die man direkt im Kalender
  „Organizer“ anlegt, werden zu Aufgaben. In den anderen Kalendern (mit Schreibrecht) legst du Termine direkt in der App an und änderst sie.
- Aufgaben **mit Tag, ohne Uhrzeit** landen als **Google Aufgabe** in der Liste **„Organizer“** – in der Google-Kalender-App am jeweiligen
  Tag mit Häkchen. Abhaken (auch wiederkehrende: die rücken vor), Umbenennen, Verschieben und neue Aufgaben in dieser Liste kommen
  zurück in die App (alle 10 Min. und beim Öffnen). In Google gelöscht → die Aufgabe bleibt in der App, nur ohne Tag.
  Bekommt eine Aufgabe eine Uhrzeit, wird aus der Google Aufgabe ein Termin. Ein/aus in den Einstellungen (aus = Liste wird in Google entfernt).

Einrichtung (einmalig): Google-Cloud-Projekt → **Google Calendar API** und **Google Tasks API** aktivieren → Zustimmungsbildschirm „Extern“,
auf **In Produktion** stellen → OAuth-Client „Webanwendung“ mit Weiterleitungs-URI `https://<deine-domain>/api/google/callback`
→ im Worker die Variablen `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` setzen → in der App unter Einstellungen verbinden.
Berechtigungen: `calendar.readonly` (lesen), `calendar.app.created` (eigener Kalender „Organizer“), `calendar.events` (Termine, die du in der App
anlegst/änderst) und `tasks` (Google Aufgaben; die App schreibt nur in ihre Liste „Organizer“). Seit 0.8 neu: `calendar.events` – im Cloud-Projekt
unter „Datenzugriff“ ergänzen und in der App einmal „Neu verbinden“.

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
7. ✅ „Heute“ zum Erledigen (0.7), Kalender-App-Ersatz + Teilaufgaben + Wichtigkeit 0–5 (0.8)
8. Import aus anderen Google-Aufgabenlisten (TasksBoard)

## Versionen

- **0.8** (24.11.2026): Kalender mit Tag/3 Tage/Woche/Monat/Jahr/Liste, Termine anlegen/verschieben/ändern/löschen, Suche, Mini-Monat,
  Kalender ein/aus + Farben, Termin-Erinnerungen; Wichtigkeit 0–5; wartende Aufgaben normal in den Listen; überall ziehen (ganze Karte);
  Teilaufgaben (Aufteilen, Teil erledigt, Strg+Ziehen)
- **0.7** (24.11.2026): „Heute“ neu: Reihenfolge statt Uhrzeiten, Ansichten nach Dauer/Priorität, Als Nächstes + Fokus-Timer,
  Fortschritt & Zeitbudget, Lücken-Hinweis, Kalender nur seitlich; „Tag planen“ legt nur noch die Reihenfolge fest
- **0.6** (22.11.2026): Tag planen: Unteraufgaben unter ihrer Aufgabe, Vorschläge gruppiert (Wichtig/Kleinere/Alle anderen + Suche), Reihenfolge per Ziehen, Dauer 5 min–2 h
- **0.5** (22.11.2026): Aufgaben mit Tag als Google Aufgaben (Liste „Organizer“, in beide Richtungen); Fix: erstmals eingeplante Aufgaben kamen nicht immer im Google Kalender an
- **0.4** (22.11.2026): Eingabesprache mit Markierung und Vorschlägen, Aufgabennummern, geschätzte Dauer, Fristen mit Uhrzeit (+ Erinnerung)
- **0.3** (22.11.2026): Tag planen/abschließen, Fristen, „Wartet auf“, Unteraufgaben auf Karten, Vorlagen, Filter & Ansichten,
  Befehlspalette, Offline-Modus, Push-Erinnerungen + Morgenübersicht, Teilen-Ziel & App-Verknüpfungen
- **0.2** (21.11.2026): Board mit Drag & Drop, Stapel „Unsortiert“, Woche, Heute-Planer, Kalender, Wiederholungen, Google Kalender
- **0.1** (21.11.2026): Grundgerüst
