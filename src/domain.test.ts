import { describe, expect, it } from 'vitest'
import {
  addDays,
  dateKey,
  DEFAULT_DARK_END,
  DEFAULT_DARK_START,
  isDarkHours,
  nextThemeChange,
  dueDateMatchesFilters,
  extractLinks,
  extractPhoneNumbers,
  formatFriendlyDate,
  isWeekend,
  nextAllowedDueDate,
  nextDueDate,
  parseTaskInput,
  preferredTimeFor,
  type Task,
  delayTargetDate,
  durationFromEffort,
  effortFromDuration,
  effortFromTracked,
  isTracking,
  trackedMilliseconds,
} from './domain'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    listId: 'list-1',
    title: 'Test task',
    position: 0,
    effort: 1,
    fixedInterval: false,
    nextDueAt: '2026-09-17',
    archived: false,
    createdAt: '2026-09-17T12:00:00.000Z',
    updatedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  }
}

describe('parseTaskInput', () => {
  it('keeps a plain title unchanged', () => {
    expect(parseTaskInput('Call the dentist', '2026-09-17')).toEqual({
      title: 'Call the dentist',
      preferredTime: undefined,
      dueDate: undefined,
      intervalDays: undefined,
      fixedInterval: false,
    })
  })

  it.each([
    ['Breakfast 7a', 'Breakfast', '07:00'],
    ['Lunch at 12:15 pm', 'Lunch', '12:15'],
    ['Call Mom 12am', 'Call Mom', '00:00'],
  ])('extracts time from %s', (input, title, preferredTime) => {
    expect(parseTaskInput(input, '2026-09-17')).toMatchObject({ title, preferredTime })
  })

  it('extracts recurrence, fixed scheduling, date, and time together', () => {
    expect(parseTaskInput('Pay bill 4/20 at 2:30p 30d!', '2026-09-17')).toEqual({
      title: 'Pay bill',
      preferredTime: '14:30',
      dueDate: '2027-04-20',
      intervalDays: 30,
      fixedInterval: true,
    })
  })

  it('uses the current year for today or a future month and day', () => {
    expect(parseTaskInput('Same day 9/17', '2026-09-17').dueDate).toBe('2026-09-17')
    expect(parseTaskInput('Later 10/5', new Date(2026, 8, 17, 12)).dueDate).toBe('2026-10-05')
  })

  it('pins the due date to the next named weekday', () => {
    // 2026-09-17 is a Thursday.
    expect(parseTaskInput('Call the bank monday', '2026-09-17')).toMatchObject({ title: 'Call the bank', dueDate: '2026-09-21' })
    expect(parseTaskInput('Gym Fri 6a', '2026-09-17')).toMatchObject({ title: 'Gym', dueDate: '2026-09-18', preferredTime: '06:00' })
    expect(parseTaskInput('Thursday review', '2026-09-17').dueDate).toBe('2026-09-17')
    expect(parseTaskInput('Next Thursday review', '2026-09-17')).toMatchObject({ title: 'review', dueDate: '2026-09-24' })
    expect(parseTaskInput('Weds 4/20', '2026-09-17')).toMatchObject({ title: 'Weds', dueDate: '2027-04-20' })
    expect(parseTaskInput('Monday-morning stretch', '2026-09-17')).toMatchObject({ title: 'Monday-morning stretch', dueDate: undefined })
  })

  it('uses next year after the month and day have passed', () => {
    expect(parseTaskInput('Taxes 4/15', '2026-09-17')).toMatchObject({ title: 'Taxes', dueDate: '2027-04-15' })
  })

  it.each(['Bad 2/30', 'Bad 13/1', 'Fraction 4/20th'])('leaves invalid or embedded dates in the title: %s', (input) => {
    expect(parseTaskInput(input, '2026-09-17')).toMatchObject({ title: input, dueDate: undefined })
  })
})

describe('date utilities', () => {
  it('formats local date keys and adds days across month boundaries', () => {
    const date = new Date(2026, 0, 31, 12)
    expect(dateKey(date)).toBe('2026-01-31')
    expect(dateKey(addDays(date, 1))).toBe('2026-02-01')
    expect(dateKey(date)).toBe('2026-01-31')
  })

  it('detects weekends from strings and Date objects', () => {
    expect(isWeekend('2026-09-19')).toBe(true)
    expect(isWeekend(new Date(2026, 8, 20, 12))).toBe(true)
    expect(isWeekend('2026-09-21')).toBe(false)
  })

  it('formats a friendly date', () => {
    expect(formatFriendlyDate(new Date(2026, 8, 17, 12))).toContain('Sep 17')
  })
})

describe('preferredTimeFor', () => {
  it('prefers the matching day type and falls back through legacy values', () => {
    const scheduled = task({
      preferredTime: '11:00',
      weekdayPreferredTime: '08:00',
      weekendPreferredTime: '09:00',
    })
    expect(preferredTimeFor(scheduled, '2026-09-18')).toBe('08:00')
    expect(preferredTimeFor(scheduled, '2026-09-19')).toBe('09:00')
    expect(preferredTimeFor(task({ weekendPreferredTime: '09:00' }), '2026-09-18')).toBe('09:00')
    expect(preferredTimeFor(task({ preferredTime: '11:00' }), '2026-09-19')).toBe('11:00')
    expect(preferredTimeFor(task(), '2026-09-18')).toBeUndefined()
  })
})

describe('nextDueDate', () => {
  const completedAt = new Date(2026, 8, 17, 12)

  it('moves one-off tasks to the following day', () => {
    expect(nextDueDate(task(), completedAt)).toBe('2026-09-18')
  })

  it('schedules flexible recurrence from completion', () => {
    expect(nextDueDate(task({ intervalDays: 7 }), completedAt)).toBe('2026-09-24')
  })

  it('advances fixed recurrence from its prior schedule until it is future', () => {
    expect(nextDueDate(task({ intervalDays: 7, fixedInterval: true, nextDueAt: '2026-09-01' }), completedAt)).toBe('2026-09-22')
  })

  it('advances recurrence to the first date allowed by its filters', () => {
    expect(nextDueDate(task({ intervalDays: 1, dueFilters: 'monday q4' }), completedAt)).toBe('2026-10-05')
  })
})

describe('due date filters', () => {
  it.each([
    ['m', '2026-09-21'], ['mon', '2026-09-21'], ['monday', '2026-09-21'],
    ['tu', '2026-09-22'], ['th', '2026-09-24'], ['sa', '2026-09-19'], ['su', '2026-09-20'],
  ])('supports unambiguous weekday alias %s', (filter, date) => {
    expect(dueDateMatchesFilters(date, filter)).toBe(true)
  })

  it('requires extra characters for ambiguous s and t weekday aliases', () => {
    expect(dueDateMatchesFilters('2026-09-21', 's t')).toBe(true)
    expect(dueDateMatchesFilters('2026-09-19', 'tu')).toBe(false)
    expect(dueDateMatchesFilters('2026-09-24', 'th')).toBe(true)
  })

  it('supports weekday, weekend, month, season, quarter, and ordinal filters', () => {
    expect(dueDateMatchesFilters('2026-09-18', 'weekday')).toBe(true)
    expect(dueDateMatchesFilters('2026-09-19', 'weekend')).toBe(true)
    expect(dueDateMatchesFilters('2026-03-14', 'march spring q1 14th')).toBe(true)
    expect(dueDateMatchesFilters('2026-07-14', 'march spring q1 14th')).toBe(false)
  })

  it('treats values in one category as alternatives and categories as intersections', () => {
    expect(dueDateMatchesFilters('2026-10-05', 'mon, fri q4')).toBe(true)
    expect(dueDateMatchesFilters('2026-10-06', 'mon, fri q4')).toBe(false)
    expect(dueDateMatchesFilters('2027-01-01', 'mon, fri q4')).toBe(false)
  })

  it('finds the first allowed date on or after a proposed due date', () => {
    expect(nextAllowedDueDate('2026-09-17', 'monday, q4')).toBe('2026-10-05')
    expect(nextAllowedDueDate('2026-09-17', '14th spring')).toBe('2027-03-14')
  })
})
describe('delayTargetDate', () => {
  const target = (option: Parameters<typeof delayTargetDate>[0], day: string) => dateKey(delayTargetDate(option, day))

  it('delays by one day', () => {
    expect(target('day', '2026-09-30')).toBe('2026-10-01')
  })

  it('finds the upcoming weekend day', () => {
    expect(target('weekend', '2026-09-21')).toBe('2026-09-26')
    expect(target('weekend', '2026-09-25')).toBe('2026-09-26')
    expect(target('weekend', '2026-09-26')).toBe('2026-09-27')
    expect(target('weekend', '2026-09-27')).toBe('2026-10-03')
  })

  it('finds the following Monday', () => {
    expect(target('week', '2026-09-21')).toBe('2026-09-28')
    expect(target('week', '2026-09-26')).toBe('2026-09-28')
    expect(target('week', '2026-09-27')).toBe('2026-09-28')
  })

  it('finds the first day of the next month', () => {
    expect(target('month', '2026-09-21')).toBe('2026-10-01')
    expect(target('month', '2026-12-31')).toBe('2027-01-01')
  })
})

describe('effort tracking', () => {
  it('counts one effort per started five minutes', () => {
    expect(effortFromTracked(0)).toBe(1)
    expect(effortFromTracked(5 * 60_000)).toBe(1)
    expect(effortFromTracked(5 * 60_000 + 1)).toBe(2)
    expect(effortFromTracked(61 * 60_000)).toBe(13)
  })

  it('converts hours and minutes into effort and back', () => {
    expect(effortFromDuration(0, 0)).toBe(1)
    expect(effortFromDuration(0, 15)).toBe(3)
    expect(effortFromDuration(0, 17)).toBe(4)
    expect(effortFromDuration(2, 30)).toBe(30)
    expect(effortFromDuration(Number.NaN, -5)).toBe(1)
    expect(durationFromEffort(3)).toEqual({ hours: 0, minutes: 15 })
    expect(durationFromEffort(30)).toEqual({ hours: 2, minutes: 30 })
  })

  it('adds the running stretch to paused time', () => {
    const now = new Date('2026-09-21T10:10:00Z')
    expect(trackedMilliseconds({}, now)).toBe(0)
    expect(trackedMilliseconds({ trackedMs: 90_000 }, now)).toBe(90_000)
    expect(trackedMilliseconds({ trackedMs: 90_000, trackingStartedAt: '2026-09-21T10:00:00Z' }, now)).toBe(690_000)
    expect(trackedMilliseconds({ trackingStartedAt: '2026-09-21T10:20:00Z' }, now)).toBe(0)
  })

  it('treats a paused timer at zero as tracking', () => {
    expect(isTracking({})).toBe(false)
    expect(isTracking({ trackedMs: 0 })).toBe(true)
    expect(isTracking({ trackingStartedAt: '2026-09-21T10:00:00Z' })).toBe(true)
  })
})

describe('theme schedule', () => {
  it('treats the default window as night from 10:30pm until 8:30am', () => {
    expect(isDarkHours(new Date(2026, 8, 22, 22, 29), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(false)
    expect(isDarkHours(new Date(2026, 8, 22, 22, 30), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(true)
    expect(isDarkHours(new Date(2026, 8, 23, 3, 0), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(true)
    expect(isDarkHours(new Date(2026, 8, 23, 8, 29), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(true)
    expect(isDarkHours(new Date(2026, 8, 23, 8, 30), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(false)
    expect(isDarkHours(new Date(2026, 8, 23, 14, 0), DEFAULT_DARK_START, DEFAULT_DARK_END)).toBe(false)
  })

  it('supports a window that does not cross midnight and an empty window', () => {
    expect(isDarkHours(new Date(2026, 8, 22, 13, 0), '12:00', '14:00')).toBe(true)
    expect(isDarkHours(new Date(2026, 8, 22, 15, 0), '12:00', '14:00')).toBe(false)
    expect(isDarkHours(new Date(2026, 8, 22, 12, 0), '12:00', '12:00')).toBe(false)
  })

  it('finds the next boundary in either direction', () => {
    expect(nextThemeChange(new Date(2026, 8, 22, 14, 0), DEFAULT_DARK_START, DEFAULT_DARK_END)).toEqual(new Date(2026, 8, 22, 22, 30))
    expect(nextThemeChange(new Date(2026, 8, 22, 23, 0), DEFAULT_DARK_START, DEFAULT_DARK_END)).toEqual(new Date(2026, 8, 23, 8, 30))
    expect(nextThemeChange(new Date(2026, 8, 22, 22, 30), DEFAULT_DARK_START, DEFAULT_DARK_END)).toEqual(new Date(2026, 8, 23, 8, 30))
  })
})

describe('task links', () => {
  it('finds web links and trims trailing punctuation', () => {
    expect(extractLinks('Read https://example.com/docs, then www.example.org/a?b=1). Again https://example.com/docs')).toEqual([
      { href: 'https://example.com/docs', label: 'example.com/docs' },
      { href: 'https://www.example.org/a?b=1', label: 'www.example.org/a?b=1' },
    ])
    expect(extractLinks('No links here 4/20 2:30p')).toEqual([])
  })

  it('finds phone numbers but not dates or times', () => {
    expect(extractPhoneNumbers('Call (555) 123-4567 or +44 20 7946 0958 about 2026-09-22 at 2:30, ref 12/25/2026')).toEqual([
      { href: 'tel:5551234567', label: '(555) 123-4567' },
      { href: 'tel:+442079460958', label: '+44 20 7946 0958' },
    ])
    expect(extractPhoneNumbers('Order 123456 and 1000000 units')).toEqual([{ href: 'tel:1000000', label: '1000000' }])
  })
})
