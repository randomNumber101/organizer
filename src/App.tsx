import { useEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Plus } from 'lucide-react'
import { useStore } from './store'
import type { ViewName } from './lib/types'
import Login from './components/Login'
import { TabBar, TopBar } from './components/Chrome'
import BoardView from './views/BoardView'
import PlannerView from './views/PlannerView'
import CalendarView from './views/CalendarView'
import TaskSheet from './components/TaskSheet'
import QuickAdd from './components/QuickAdd'
import Triage from './components/Triage'
import SettingsSheet from './components/SettingsSheet'
import Toast from './components/Toast'
import Ritual from './components/Ritual'
import CommandPalette from './components/CommandPalette'
import TemplatePicker from './components/TemplatePicker'
import { FilterPanel } from './components/FilterBar'
import { todayStr } from './lib/dates'

const ORDER: ViewName[] = ['board', 'today', 'calendar']

export default function App() {
  const authed = useStore((s) => s.authed)
  const initAuth = useStore((s) => s.initAuth)
  const view = useStore((s) => s.view)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (!s.authed) return
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
        return
      }
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (s.quickAdd.open || s.triageOpen || s.selectedId || s.settingsOpen || s.paletteOpen || s.ritual || s.templatePicker || s.filterOpen) return
      if (e.key === 'n' || e.key === 'q') {
        e.preventDefault()
        s.openQuickAdd(s.view === 'today' ? { due_date: s.focusDay } : {})
      } else if (e.key === '1' || e.key === '2' || e.key === '3') s.setView(ORDER[Number(e.key) - 1])
      else if (e.key === 't') s.setFocusDay(todayStr())
      else if (e.key === 'f' && s.view !== 'calendar') s.setFilterOpen(true)
      else if (e.key === 'u') s.setShowSubtasks(!s.showSubtasks)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (authed === null) return <div className="center-screen muted">Lädt …</div>

  return (
    <MotionConfig reducedMotion="user">
      {!authed ? (
        <>
          <Login />
          <Toast />
        </>
      ) : (
        <div className="app">
          <TopBar />
          <main className="main">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={view}
                className="view"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {view === 'board' && <BoardView />}
                {view === 'today' && <PlannerView />}
                {view === 'calendar' && <CalendarView />}
              </motion.div>
            </AnimatePresence>
          </main>
          <TabBar />
          <Fab />
          <TaskSheet />
          <QuickAdd />
          <Triage />
          <SettingsSheet />
          <Ritual />
          <TemplatePicker />
          <FilterPanel />
          <CommandPalette />
          <Toast />
        </div>
      )}
    </MotionConfig>
  )
}

function Fab() {
  const openQuickAdd = useStore((s) => s.openQuickAdd)
  const view = useStore((s) => s.view)
  const focusDay = useStore((s) => s.focusDay)
  const dragging = useStore((s) => s.dragging)
  return (
    <AnimatePresence>
      {!dragging && (
        <motion.button
          className="fab"
          aria-label="Neue Aufgabe"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => openQuickAdd(view === 'today' ? { due_date: focusDay } : {})}
        >
          <Plus />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
