import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Filter, Flag, Hourglass, Lock, Save, Unlock, X } from 'lucide-react'
import { useStore } from '../store'
import type { SavedView, TaskFilter, WhenFilter } from '../lib/types'
import { PRIORITY_LABEL } from '../lib/types'
import { WHEN_LABEL, allTags, filterCount, isFilterActive } from '../lib/filter'
import { useIsMobile } from '../hooks/useMedia'

const NO_VIEWS: SavedView[] = []
const toggle = <T,>(arr: T[] | undefined, v: T): T[] => (arr?.includes(v) ? arr.filter((x) => x !== v) : [...(arr ?? []), v])

/** Gespeicherte Ansichten als Chips + Filter-Knopf */
export function FilterBar() {
  const views = useStore((s) => s.prefs.views ?? NO_VIEWS)
  const activeViewId = useStore((s) => s.activeViewId)
  const filter = useStore((s) => s.filter)
  const search = useStore((s) => s.search)
  const applyView = useStore((s) => s.applyView)
  const setFilterOpen = useStore((s) => s.setFilterOpen)
  const active = isFilterActive(filter)
  const n = filterCount(filter)
  const view = views.find((v) => v.id === activeViewId)
  const dirty = !!view && JSON.stringify(view.filter) !== JSON.stringify(filter)

  return (
    <div className="filterbar">
      <button className={`filter-btn ${active ? 'on' : ''}`} onClick={() => setFilterOpen(true)} aria-label="Filter">
        <Filter size={15} />
        <span className="desktop-only">Filter</span>
        {n > 0 && <b>{n}</b>}
      </button>
      {(views.length > 0 || active) && (
        <div className="view-chips">
          <button className={`view-chip ${!active && !activeViewId ? 'on' : ''}`} onClick={() => applyView(null)}>
            Alle
          </button>
          {views.map((v) => (
            <button key={v.id} className={`view-chip ${v.id === activeViewId ? 'on' : ''}`} onClick={() => applyView(v.id === activeViewId ? null : v.id)}>
              {v.name}
              {v.id === activeViewId && dirty && <i className="dirty" title="geändert" />}
            </button>
          ))}
          {active && !activeViewId && (
            <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="view-chip on adhoc" onClick={() => applyView(null)} title="Filter entfernen">
              {n} Filter{search ? ' + Suche' : ''}
              <X size={12} />
            </motion.button>
          )}
        </div>
      )}
    </div>
  )
}

/** Filter einstellen und als Ansicht speichern */
export function FilterPanel() {
  const open = useStore((s) => s.filterOpen)
  const setFilterOpen = useStore((s) => s.setFilterOpen)
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('input') && setFilterOpen(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setFilterOpen])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="qa-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setFilterOpen(false)}>
          <motion.div
            className="qa filter-panel"
            role="dialog"
            aria-label="Filter"
            initial={isMobile ? { y: '100%' } : { y: -10, opacity: 0, scale: 0.98 }}
            animate={isMobile ? { y: 0 } : { y: 0, opacity: 1, scale: 1 }}
            exit={isMobile ? { y: '100%' } : { y: -10, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          >
            <PanelBody />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PanelBody() {
  const filter = useStore((s) => s.filter)
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const activeViewId = useStore((s) => s.activeViewId)
  const views = useStore((s) => s.prefs.views ?? NO_VIEWS)
  const { setFilter, setFilterOpen, saveView, deleteView, setPref } = useStore.getState()
  const [naming, setNaming] = useState<string | null>(null)
  const tags = useMemo(() => allTags(tasks).slice(0, 24), [tasks])
  const sortedLists = Object.values(lists)
    .filter((l) => !l.archived)
    .sort((a, b) => a.sort - b.sort)
  const view = views.find((v) => v.id === activeViewId)
  const set = (patch: Partial<TaskFilter>) => setFilter({ ...filter, ...patch }, activeViewId)

  return (
    <>
      <div className="tpl-head">
        <Filter size={17} style={{ color: 'var(--accent)' }} />
        <b>{view ? `Ansicht „${view.name}“` : 'Filter'}</b>
        <span style={{ flex: 1 }} />
        {isFilterActive(filter) && (
          <button className="btn sm ghost" onClick={() => setFilter({}, null)}>
            Zurücksetzen
          </button>
        )}
        <button className="icon-btn sm" aria-label="Schließen" onClick={() => setFilterOpen(false)}>
          <X size={16} />
        </button>
      </div>

      <div className="filter-body">
        <FilterGroup label="Liste">
          <button className={`opt ${filter.lists?.includes('inbox') ? 'on' : ''}`} onClick={() => set({ lists: toggle(filter.lists, 'inbox') })}>
            Unsortiert
          </button>
          {sortedLists.map((l) => (
            <button key={l.id} className={`opt ${filter.lists?.includes(l.id) ? 'on' : ''}`} onClick={() => set({ lists: toggle(filter.lists, l.id) })}>
              <span className="dot" style={{ background: l.color }} />
              {l.name}
            </button>
          ))}
        </FilterGroup>

        <FilterGroup label="Wann">
          {(Object.keys(WHEN_LABEL) as WhenFilter[]).map((w) => (
            <button key={w} className={`opt ${filter.when === w ? 'on' : ''}`} onClick={() => set({ when: filter.when === w ? null : w })}>
              {WHEN_LABEL[w]}
            </button>
          ))}
        </FilterGroup>

        <FilterGroup label="Priorität">
          {[1, 2, 3].map((p) => (
            <button key={p} className={`opt prio-${p} ${filter.priorities?.includes(p) ? 'on' : ''}`} onClick={() => set({ priorities: toggle(filter.priorities, p) })}>
              <Flag />
              {PRIORITY_LABEL[p as 1 | 2 | 3]}
            </button>
          ))}
        </FilterGroup>

        <FilterGroup label="Frist & Status">
          <button className={`opt ${filter.deadline === 'soon' ? 'on' : ''}`} onClick={() => set({ deadline: filter.deadline === 'soon' ? null : 'soon' })}>
            <Hourglass /> Frist in 7 Tagen
          </button>
          <button className={`opt ${filter.deadline === 'any' ? 'on' : ''}`} onClick={() => set({ deadline: filter.deadline === 'any' ? null : 'any' })}>
            <Hourglass /> Hat Frist
          </button>
          <button className={`opt ${filter.state === 'free' ? 'on' : ''}`} onClick={() => set({ state: filter.state === 'free' ? null : 'free' })}>
            <Unlock /> Machbar
          </button>
          <button className={`opt ${filter.state === 'blocked' ? 'on' : ''}`} onClick={() => set({ state: filter.state === 'blocked' ? null : 'blocked' })}>
            <Lock /> Wartet
          </button>
        </FilterGroup>

        {tags.length > 0 && (
          <FilterGroup label="Tags">
            {tags.map((t) => (
              <button key={t} className={`opt tag ${filter.tags?.includes(t) ? 'on' : ''}`} onClick={() => set({ tags: toggle(filter.tags, t) })}>
                #{t}
              </button>
            ))}
          </FilterGroup>
        )}
      </div>

      <div className="qa-foot">
        {naming !== null ? (
          <form
            className="tpl-form"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (!naming.trim()) return
              saveView(naming.trim())
              setNaming(null)
            }}
          >
            <input autoFocus className="field-input sm" placeholder="Name, z. B. „Uni diese Woche“" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
            <button className="btn sm primary" type="submit" disabled={!naming.trim()}>
              Speichern
            </button>
          </form>
        ) : (
          <>
            {view ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm ghost danger" onClick={() => deleteView(view.id)}>
                  Ansicht löschen
                </button>
                {JSON.stringify(view.filter) !== JSON.stringify(filter) && (
                  <button className="btn sm" onClick={() => setPref('views', views.map((v) => (v.id === view.id ? { ...v, filter } : v)))}>
                    <Save size={14} /> Änderungen übernehmen
                  </button>
                )}
              </div>
            ) : (
              <button className="btn sm ghost" disabled={!isFilterActive(filter)} onClick={() => setNaming('')}>
                <Save size={14} /> Als Ansicht speichern
              </button>
            )}
            <button className="btn sm primary" onClick={() => setFilterOpen(false)}>
              Fertig
            </button>
          </>
        )}
      </div>
    </>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-group">
      <div className="section-label">{label}</div>
      <div className="prop-value">{children}</div>
    </div>
  )
}
