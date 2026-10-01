import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 500
// How long a tap waits for a second one when the element also handles double taps.
export const DOUBLE_TAP_MS = 250

// Handlers for an element that does one thing on tap and another when held (or right-clicked).
// The release that ends a long press does not also count as the tap. With a double-tap handler,
// a single tap waits briefly to make sure no second tap follows.
export function useLongPress(onLongPress: () => void, onTap?: () => void, onDoubleTap?: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const tapTimer = useRef<number | undefined>(undefined)
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

  useEffect(() => () => {
    cancel()
    window.clearTimeout(tapTimer.current)
  }, [])

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
      if (!onDoubleTap) {
        onTap?.()
        return
      }
      if (tapTimer.current !== undefined) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = undefined
        onDoubleTap()
        return
      }
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = undefined
        onTap?.()
      }, DOUBLE_TAP_MS)
    },
  }
}
