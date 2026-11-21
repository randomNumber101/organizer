import { AnimatePresence, motion } from 'motion/react'
import { Undo2 } from 'lucide-react'
import { useStore } from '../store'
import { useIsMobile } from '../hooks/useMedia'

export default function Toast() {
  const toast = useStore((s) => s.toast)
  const isMobile = useIsMobile()
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className={`toast ${toast.kind}`}
          role="status"
          initial={{ opacity: 0, y: isMobile ? -16 : 16, x: '-50%', scale: 0.97 }}
          animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
          exit={{ opacity: 0, y: isMobile ? -10 : 10, x: '-50%', scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        >
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              className="undo"
              onClick={() => {
                toast.undo?.()
                useStore.setState({ toast: null })
              }}
            >
              <Undo2 size={15} /> Rückgängig
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
