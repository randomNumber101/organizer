import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className={`toast ${toast.kind}`} role="status">
      <span>{toast.msg}</span>
      {toast.undo && (
        <button
          className="link"
          onClick={() => {
            toast.undo?.()
            useStore.setState({ toast: null })
          }}
        >
          Rückgängig
        </button>
      )}
    </div>
  )
}
