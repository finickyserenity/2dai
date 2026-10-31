import { describe, expect, it } from 'vitest'
import { appTop, isDocumentOffset, viewportShortfall } from './visualViewport'

describe('appTop', () => {
  it('keeps the app at the top while the keyboard is closed, even as the page bounces', () => {
    expect(appTop(844, 0, 844)).toBe(0)
    expect(appTop(844, -60, 844)).toBe(0)
    expect(appTop(844, 40, 844)).toBe(0)
  })

  it('follows the page up to the focused field while the keyboard is open', () => {
    expect(appTop(500, 200, 844)).toBe(200)
  })

  it('ignores a bounce past either end while the keyboard is open', () => {
    expect(appTop(500, -30, 844)).toBe(0)
    expect(appTop(500, 400, 844)).toBe(344)
  })
})

describe('isDocumentOffset', () => {
  it('leaves a document already at the origin alone', () => {
    expect(isDocumentOffset(0, 0, 0, 0, false, 1)).toBe(false)
    expect(isDocumentOffset(0, 0.4, 0, -0.4, false, 1)).toBe(false)
  })

  it('catches the page left scrolled by the status bar after a rotation', () => {
    expect(isDocumentOffset(0, -62, 0, -62, false, 1)).toBe(true)
    expect(isDocumentOffset(0, 62, 0, 0, false, 1)).toBe(true)
    expect(isDocumentOffset(0, 0, 0, 29, false, 1)).toBe(true)
    expect(isDocumentOffset(12, 0, 0, 0, false, 1)).toBe(true)
  })

  it('lets the keyboard and pinch-zoom pan the page', () => {
    expect(isDocumentOffset(0, 200, 0, 200, true, 1)).toBe(false)
    expect(isDocumentOffset(40, 80, 40, 80, false, 2)).toBe(false)
  })
})

describe('viewportShortfall', () => {
  it('makes up the status bar iOS 26 leaves off an installed app in portrait', () => {
    expect(viewportShortfall(440, 894, 440, 956, true)).toBe(62)
  })

  it('has nothing to add when the viewport already fills the screen', () => {
    expect(viewportShortfall(956, 440, 440, 956, true)).toBe(0)
    expect(viewportShortfall(440, 956, 440, 956, true)).toBe(0)
  })

  it('leaves browser tabs, split-screen windows and large gaps alone', () => {
    expect(viewportShortfall(440, 760, 440, 956, false)).toBe(0)
    expect(viewportShortfall(507, 1300, 1024, 1366, true)).toBe(0)
    expect(viewportShortfall(440, 600, 440, 956, true)).toBe(0)
  })
})
