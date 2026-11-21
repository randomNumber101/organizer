import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { buildSections, viewDefaults, viewTitle } from '../lib/sections'
import TaskRow from '../components/TaskRow'
import ListHeader from '../components/ListHeader'

export default function MainView() {
  const { view, tasks, lists, loaded, setDrawer, openQuickAdd } = useStore()
  const sections = useMemo(() => buildSections(view, tasks), [view, tasks])
  const [openCollapsible, setOpenCollapsible] = useState<Record<string, boolean>>({})
  const title = viewTitle(view, lists)
  const empty = sections.every((s) => s.tasks.length === 0)

  return (
    <main className="main">
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label="Menü" onClick={() => setDrawer(true)}>
          ☰
        </button>
        <h1>{title}</h1>
      </header>

      {view.kind === 'list' && <ListHeader listId={view.listId} />}

      <div className="content">
        {!loaded && <p className="muted pad">Lädt …</p>}
        {loaded && empty && view.kind !== 'upcoming' && (
          <div className="empty">
            <p>{view.kind === 'today' ? 'Nichts für heute geplant. 🎉' : view.kind === 'done' ? 'Noch nichts erledigt.' : 'Hier ist noch nichts.'}</p>
            {view.kind !== 'done' && (
              <button className="btn" onClick={() => openQuickAdd(viewDefaults(view))}>
                Aufgabe hinzufügen
              </button>
            )}
          </div>
        )}

        {loaded &&
          sections.map((s) => {
            if (s.collapsible && !s.tasks.length) return null
            const hidden = s.collapsible && !openCollapsible[s.key]
            if (empty && view.kind !== 'upcoming' && !s.tasks.length) return null
            return (
              <section key={s.key} className={`section ${s.muted ? 'muted-section' : ''} ${s.overdue ? 'overdue' : ''}`}>
                {(s.title || s.addDefaults) && (
                  <div className="section-head">
                    {s.collapsible ? (
                      <button className="link section-title" onClick={() => setOpenCollapsible((o) => ({ ...o, [s.key]: !o[s.key] }))}>
                        {hidden ? '▸' : '▾'} {s.title}
                      </button>
                    ) : (
                      <h2 className="section-title">
                        {s.title}
                        {s.subtitle && s.subtitle !== s.title && <span className="muted"> · {s.subtitle}</span>}
                      </h2>
                    )}
                    {s.addDefaults && (
                      <button className="icon-btn small" aria-label="Aufgabe hier hinzufügen" onClick={() => openQuickAdd(s.addDefaults)}>
                        +
                      </button>
                    )}
                  </div>
                )}
                {!hidden && (
                  <ul className="task-list">
                    {s.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} showDate={s.showDate} overdue={s.overdue} />
                    ))}
                    {!s.tasks.length && view.kind === 'upcoming' && <li className="muted small pad-row">—</li>}
                  </ul>
                )}
              </section>
            )
          })}
      </div>
    </main>
  )
}
