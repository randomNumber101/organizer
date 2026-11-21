# Organizer

Persönliche To-do- und Planungs-App (PWA) – Listen, Unteraufgaben, Priorität, Tags, Zeithorizonte,
Tages- und Zeitblock-Planung, Live-Sync zwischen Handy und Laptop.

**Stack:** React + TypeScript + Vite (PWA) · Cloudflare Worker mit Durable Object (SQLite, Live-Sync per WebSocket) · alles im Gratis-Tarif

## Bedienung

- **+** (oder Taste `n`) öffnet die Schnelleingabe:
  `Mails beantworten morgen 14 Uhr !1 #uni @Job`
  - `heute`, `morgen`, `übermorgen`, `montag` … `sonntag`, `am mo` …
  - `14 Uhr`, `14:30`, `um 9`, `9-10:30 Uhr` (Zeitblock, Standard 60 Min.)
  - `!1` … `!4` Priorität · `#tag` · `@liste` (wird angelegt, falls es sie nicht gibt)
- Unerledigte Tagesaufgaben ohne Uhrzeit wandern automatisch auf heute (↻ zeigt, wie oft).
  Verpasste Zeitblöcke landen unter **Überfällig** mit „Heute / Morgen / Backlog“.
- Erledigen einer Aufgabe erledigt ihre offenen Unteraufgaben mit (Rückgängig im Hinweis).

## Aufbau

- `src/` – die App (React). Spricht nur mit `/api/…`.
- `worker/index.ts` – Einstieg: liefert die App-Dateien aus, leitet `/api/*` an das Durable Object weiter.
- `worker/store.ts` – **ein** Durable Object `OrganizerStore` hält alles: SQLite-Datenbank, Anmeldung
  (Passwort aus dem Secret `APP_PASSWORD`, Sitzungen per Cookie), REST-API und die WebSocket-Verbindungen
  für den Live-Sync. Nächtliches Aufräumen per Alarm.
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

1. ✅ Grundgerüst: Login, Listen, Aufgaben + Unteraufgaben, Priorität, Tags, Heute/Demnächst/Horizonte, Live-Sync, installierbar
2. Planen: Kalender (Tag/Woche) mit Drag & Drop, Wiederholungen
3. Push-Erinnerungen (Durable-Object-Alarm zum genauen Zeitpunkt + Web Push)
4. Google Kalender bidirektional
5. Import aus Google Tasks
