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
    const keyboardOpen = viewport.height < root.clientHeight - 1
    const shortfall = keyboardOpen ? 0 : viewportShortfall(viewport.width, viewport.height, screen.width, screen.height, isStandalone())
    root.style.setProperty('--viewport-shortfall', `${shortfall}px`)
    root.style.setProperty('--app-height', `${viewport.height + shortfall}px`)
    root.style.setProperty('--app-top', `${appTop(viewport.height, viewport.offsetTop, root.clientHeight)}px`)
    if (viewport.height < lastHeight) revealFocusedField()
    lastHeight = viewport.height
  }

  // Rotating the installed app can leave the document scrolled by about the status bar's height
  // (iOS 26). WebKit keeps painting the fixed app where it was but hit-tests at the scrolled
  // position, so every tap lands tens of pixels off until the app is relaunched. The document
  // never scrolls on purpose, so put it back whenever the keyboard isn't the reason it moved;
  // rotation settles over a few frames, so check again once it has.
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const resetDocument = () => {
    if (!isDocumentOffset(window.scrollX, window.scrollY, viewport.offsetLeft, viewport.offsetTop, isEditing(), viewport.scale)) return
    window.scrollTo(0, 0)
    update()
  }
  const resetLater = () => {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(resetDocument, 300)
  }
  const resetNowAndLater = () => {
    resetDocument()
    resetLater()
  }

  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  viewport.addEventListener('resize', resetNowAndLater)
  window.addEventListener('orientationchange', resetNowAndLater)
  // The keyboard closing hands the page back without always scrolling it home. Focus is briefly
  // nowhere while it moves between fields, so only look once it has landed.
  document.addEventListener('focusout', resetLater)

  // On device, iOS 26 only handed the installed app the full screen (ending the short viewport
  // below) once page content reached past the short viewport; the fixed app frame doesn't count.
  // This invisible strut is that content. The page still can't be scrolled by hand (html is
  // overflow: hidden), and a stray scroll is put back above.
  if (isStandalone()) {
    const strut = document.createElement('div')
    strut.setAttribute('aria-hidden', 'true')
    strut.style.cssText = 'position: absolute; top: 0; left: 0; width: 1px; height: var(--app-height); visibility: hidden; pointer-events: none'
    document.body.append(strut)
  }
  update()
}

// Whether the document has been left away from the origin by something other than the keyboard
// (which pans it to the focused field) or a pinch-zoom (which pans it under the fingers).
export function isDocumentOffset(scrollX: number, scrollY: number, offsetLeft: number, offsetTop: number, editing: boolean, scale: number): boolean {
  if (editing || scale > 1.01) return false
  return Math.abs(scrollX) >= 1 || Math.abs(scrollY) >= 1 || Math.abs(offsetLeft) >= 1 || Math.abs(offsetTop) >= 1
}

function isEditing(): boolean {
  const field = document.activeElement
  if (!(field instanceof HTMLElement)) return false
  if (field.isContentEditable || field instanceof HTMLTextAreaElement) return true
  return field instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(field.type)
}

// iOS 26 sometimes sizes an installed app's viewport short of the screen in portrait, by the
// status bar's height (WebKit bug 301108). The page still draws all the way down, but anything
// sized or pinned to the viewport stops short, leaving an empty band at the bottom. Other times
// the visible area is full height while the document is still the short one, so measure what is
// visible, not the document. An installed phone app fills the screen, so the screen says how
// much is missing. A window narrower than the screen (iPad
// split view) is not full screen, and a big gap is something else, so both are left alone.
export function viewportShortfall(width: number, height: number, screenWidth: number, screenHeight: number, standalone: boolean): number {
  if (!standalone) return 0
  const landscape = width > height
  const fullWidth = landscape ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight)
  const fullHeight = landscape ? Math.min(screenWidth, screenHeight) : Math.max(screenWidth, screenHeight)
  if (Math.abs(fullWidth - width) > 1) return 0
  const shortfall = fullHeight - height
  return shortfall > 1 && shortfall <= 100 ? shortfall : 0
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches
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
