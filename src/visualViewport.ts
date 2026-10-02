// iOS keeps the layout viewport full height when the keyboard opens and pans the page up to the
// focused field instead, carrying the top bar and view tabs out of sight. Sizing the app to the
// visible area keeps them on screen and leaves the scrolling to the content beneath them.
export function fitAppToVisualViewport() {
  const viewport = window.visualViewport
  if (!viewport) return
  const root = document.documentElement
  let lastHeight = viewport.height

  const update = () => {
    // A pinch-zoom shrinks the visual viewport too; let the page zoom normally instead of refitting it.
    if (viewport.scale > 1.01) {
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
      return
    }
    root.style.setProperty('--app-height', `${viewport.height}px`)
    root.style.setProperty('--app-top', `${appTop(viewport.height, viewport.offsetTop, root.clientHeight)}px`)
    if (viewport.height < lastHeight) revealFocusedField()
    lastHeight = viewport.height
  }

  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
}

// How far down to place the app so it sits in the visible area. Only the keyboard pushing the page
// up is followed; a rubber-band bounce also moves the offset, and chasing it would drag the app
// the opposite way to the finger.
export function appTop(visibleHeight: number, offsetTop: number, layoutHeight: number): number {
  const keyboardOpen = visibleHeight < layoutHeight - 1
  return keyboardOpen ? Math.min(Math.max(0, offsetTop), layoutHeight - visibleHeight) : 0
}

// The browser scrolled the field into view before the app shrank, so it may now sit below the fold.
function revealFocusedField() {
  const field = document.activeElement
  const scroller = field?.closest('.view-scroll')
  if (!field || !scroller) return
  const fieldBox = field.getBoundingClientRect()
  const scrollerBox = scroller.getBoundingClientRect()
  const margin = 12
  if (fieldBox.bottom > scrollerBox.bottom - margin) scroller.scrollTop += fieldBox.bottom - scrollerBox.bottom + margin
  else if (fieldBox.top < scrollerBox.top + margin) scroller.scrollTop -= scrollerBox.top - fieldBox.top + margin
}
