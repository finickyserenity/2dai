import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 500

// Handlers for an element that does one thing on tap and another when held (or right-clicked).
// The release that ends a long press does not also count as the tap.
export function useLongPress(onLongPress: () => void, onTap?: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const held = useRef(false)

  function cancel() {
    window.clearTimeout(timer.current)
  }

  function fire() {
    cancel()
    if (held.current) return
    held.current = true
    onLongPress()
  }

  useEffect(() => cancel, [])

  return {
    onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return
      held.current = false
      timer.current = window.setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: MouseEvent) {
      event.preventDefault()
      fire()
    },
    onClick() {
      if (held.current) {
        held.current = false
        return
      }
      onTap?.()
    },
  }
}
