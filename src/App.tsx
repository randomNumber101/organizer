import { useEffect } from 'react'
import { useStore } from './store'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import MainView from './views/MainView'
import TaskEditor from './components/TaskEditor'
import QuickAdd from './components/QuickAdd'
import Toast from './components/Toast'

export default function App() {
  const { authed, initAuth, selectedId, quickAdd, drawerOpen, setDrawer, openQuickAdd, select } = useStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') {
        if (useStore.getState().quickAdd.open) useStore.getState().closeQuickAdd()
        else select(null)
      } else if (!typing && (e.key === 'n' || e.key === 'q')) {
        e.preventDefault()
        openQuickAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openQuickAdd, select])

  if (authed === null) return <div className="center-screen muted">Lädt …</div>
  if (!authed)
    return (
      <>
        <Login />
        <Toast />
      </>
    )

  return (
    <div className={`app ${selectedId ? 'has-editor' : ''}`}>
      <Sidebar />
      {drawerOpen && <div className="scrim" onClick={() => setDrawer(false)} />}
      <MainView />
      {selectedId && <TaskEditor key={selectedId} id={selectedId} />}
      {quickAdd.open && <QuickAdd />}
      {!quickAdd.open && (
        <button className="fab" aria-label="Neue Aufgabe" onClick={() => openQuickAdd()}>
          +
        </button>
      )}
      <Toast />
    </div>
  )
}
