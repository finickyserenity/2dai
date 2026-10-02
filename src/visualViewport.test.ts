import { describe, expect, it } from 'vitest'
import { appTop } from './visualViewport'

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
