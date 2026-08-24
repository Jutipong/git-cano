import { useEffect, useRef } from 'react'
import type { MenuItem } from '@shared/types'

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export default function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // defer so the triggering contextmenu event doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('contextmenu', close)
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null

  const style = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - (menu.items.length + 1) * 30),
  }

  return (
    <div ref={ref} className="context-menu" style={style}>
      {menu.items.map((item, index) =>
        item.separatorBefore ? (
          <div key={index} className="context-menu-separator" />
        ) : (
          <button
            key={index}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose()
              item.action?.()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
