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
- **Schnelleingabe** (**+**, Taste `N`): `Mails beantworten morgen 14 Uhr !1 #uni @Job`
  – `heute`, `morgen`, `übermorgen`, `montag` … · `14 Uhr`, `9-10:30 Uhr` · `!1`–`!4` · `#tag` · `@liste`
- **Wiederholen** (täglich, werktags, wöchentlich …): Abhaken schiebt die Aufgabe auf den nächsten Termin.
- Unerledigte Tagesaufgaben wandern automatisch auf heute (↻ zeigt, wie oft). Alles hat „Rückgängig“.
- Tasten: `N` neu · `/` suchen · `1` `2` `3` Ansicht · `T` heute · `Esc` schließen

## Google Kalender

Aufgaben mit Uhrzeit landen in einem eigenen Google-Kalender **„Organizer“** (inkl. Google-Erinnerungen aufs Handy).
Verschiebt oder löscht man sie dort, zieht die App nach; Termine, die man direkt im Kalender „Organizer“ anlegt, werden zu Aufgaben.
Alle anderen Kalender werden nur angezeigt (Auswahl in den Einstellungen).

Einrichtung (einmalig): Google-Cloud-Projekt → Google Calendar API aktivieren → Zustimmungsbildschirm „Extern“, auf
**In Produktion** stellen → OAuth-Client „Webanwendung“ mit Weiterleitungs-URI `https://<deine-domain>/api/google/callback`
→ im Worker die Variablen `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` setzen → in der App unter Einstellungen verbinden.
Berechtigungen: `calendar.readonly` (lesen) und `calendar.app.created` (nur der eigene Kalender „Organizer“ wird beschrieben).

## Aufbau

- `src/` – die App (React). Spricht nur mit `/api/…`.
- `worker/index.ts` – Einstieg: liefert die App-Dateien aus, leitet `/api/*` an das Durable Object weiter.
- `worker/store.ts` – **ein** Durable Object `OrganizerStore` hält alles: SQLite-Datenbank, Anmeldung
  (Passwort aus dem Secret `APP_PASSWORD`, Sitzungen per Cookie), REST-API und die WebSocket-Verbindungen
  für den Live-Sync. Nächtliches Aufräumen per Alarm.
- `worker/google.ts` – schlanker Google-Calendar-Client (OAuth mit PKCE, Termine lesen/schreiben).
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
4. Push-Erinnerungen direkt aus der App (bis dahin: Google-Kalender-Erinnerungen)
5. Import aus Google Tasks, Offline-Warteschlange
