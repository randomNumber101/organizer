import type { TokenKind } from '../lib/lang'

const ROWS: { kind: TokenKind; label: string; ex: string[] }[] = [
  { kind: 'date', label: 'Tag', ex: ['heute', 'morgen', 'Freitag', 'nächsten Fr', 'in 3 Tagen', 'nächste Woche', 'am Wochenende', '12.12.', '3. Januar'] },
  { kind: 'time', label: 'Uhrzeit', ex: ['14 Uhr', 'um 9', '9:30', '14–16 Uhr', 'von 9 bis 11 Uhr', 'morgen früh', 'heute Abend', 'nachmittags'] },
  { kind: 'deadline', label: 'Frist', ex: ['bis Freitag', 'bis morgen früh', 'bis 12.12. 18 Uhr', 'bis Ende der Woche', 'Frist Monatsende'] },
  { kind: 'duration', label: 'Dauer', ex: ['30 min', '2h', '1h30', 'für eine halbe Stunde'] },
  { kind: 'repeat', label: 'Wiederholen', ex: ['täglich', 'werktags', 'jeden Montag', 'montags und donnerstags', 'alle 2 Wochen', 'jeden 1.'] },
  { kind: 'prio', label: 'Wichtigkeit', ex: ['dringend (5)', 'wichtig (4)', 'prio 3', 'unwichtig (1)', '!0 … !5', '!!! / !!'] },
  { kind: 'horizon', label: 'Horizont', ex: ['kurzfristig', 'langfristig', 'irgendwann'] },
  { kind: 'wait', label: 'Wartet auf', ex: ['warte auf 4', 'warte auf Folien', 'warte auf 4 und 7'] },
  { kind: 'parent', label: 'Unteraufgabe', ex: ['unter 7', 'unter Präsentation', '^7'] },
  { kind: 'list', label: 'Liste & Tags', ex: ['@Uni', '#klausur'] },
  { kind: 'note', label: 'Notiz', ex: ['// alles danach landet in den Notizen'] },
]

/** Spickzettel für die Eingabesprache */
export default function LangHelp({ compact }: { compact?: boolean }) {
  return (
    <div className={`lang-help ${compact ? 'compact' : ''}`}>
      <div className="lang-grid">
        {ROWS.map((r) => (
          <div key={r.kind} className="lang-row">
            <span className="lang-label">{r.label}</span>
            <span className="lang-ex">
              {r.ex.map((e) => (
                <mark key={e} className={`tk tk-${r.kind}`}>
                  {e}
                </mark>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="muted small">
        Alles andere wird der Titel. Was in <b>"Anführungszeichen"</b> steht, bleibt wörtlich. Nach „warte auf“, „unter“, @ und # kommen Vorschläge – <kbd>Tab</kbd> übernimmt. Die Nummer einer Aufgabe steht klein auf ihrer Karte.
      </p>
    </div>
  )
}
