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
    root.style.setProperty('--app-top', `${viewport.offsetTop}px`)
    if (viewport.height < lastHeight) revealFocusedField()
    lastHeight = viewport.height
  }

  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
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
