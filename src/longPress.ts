import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 500
// How long a tap waits for a second one when the element also handles double taps.
export const DOUBLE_TAP_MS = 250
// How far a finger may drift before the press counts as the start of a scroll or drag instead.
export const PRESS_SLOP_PX = 10

// Handlers for an element that does one thing on tap and another when held (or right-clicked).
// The release that ends a long press does not also count as the tap. With a double-tap handler,
// a single tap waits briefly to make sure no second tap follows. Moving the finger or scrolling
// anything while the press is pending gives up on the long press, so a scroll that happens to
// start on a row never opens its menu; a press that drifted is not a tap either.
export function useLongPress(onLongPress: () => void, onTap?: () => void, onDoubleTap?: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const tapTimer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  const start = useRef({ x: 0, y: 0 })
  const dragged = useRef(false)
  const stopWatchingScroll = useRef<(() => void) | undefined>(undefined)

  function cancel() {
    window.clearTimeout(timer.current)
    timer.current = undefined
    stopWatchingScroll.current?.()
    stopWatchingScroll.current = undefined
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
      dragged.current = false
      start.current = { x: event.clientX, y: event.clientY }
      cancel()
      timer.current = window.setTimeout(fire, LONG_PRESS_MS)
      // Scroll events do not bubble, so listen in the capture phase to hear any scroller.
      const onScroll = () => cancel()
      window.addEventListener('scroll', onScroll, true)
      stopWatchingScroll.current = () => window.removeEventListener('scroll', onScroll, true)
    },
    onPointerMove(event: PointerEvent) {
      if (timer.current === undefined) return
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > PRESS_SLOP_PX) {
        dragged.current = true
        cancel()
      }
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: MouseEvent) {
      event.preventDefault()
      fire()
    },
    onClick() {
      if (held.current || dragged.current) {
        held.current = false
        dragged.current = false
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
