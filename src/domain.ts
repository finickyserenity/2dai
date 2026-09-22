export type TaskAction = 'completed' | 'delayed' | 'skipped'
export type DelayTarget = 'day' | 'weekend' | 'week' | 'month'

export const EFFORT_UNIT_MS = 5 * 60_000

export interface TaskList {
  id: string
  name: string
  color: string
  position: number
}

export interface TaskSection {
  id: string
  listId: string
  projectId?: string
  name: string
  position: number
}

export interface ProjectFolder {
  id: string
  listId: string
  name: string
  position: number
  includeInPlanner?: boolean
  archived: boolean
}

export interface Task {
  id: string
  listId: string
  sectionId?: string
  projectId?: string
  title: string
  notes?: string
  position: number
  effort: number
  intervalDays?: number
  fixedInterval: boolean
  dueFilters?: string
  preferredTime?: string
  preferredTimeSource?: 'explicit' | 'observed'
  weekdayPreferredTime?: string
  weekdayPreferredTimeSource?: 'explicit' | 'observed'
  weekendPreferredTime?: string
  weekendPreferredTimeSource?: 'explicit' | 'observed'
  lastCompletedAt?: string
  trackingStartedAt?: string
  trackedMs?: number
  nextDueAt: string
  scheduledForPlanner?: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface TaskEvent {
  id: string
  taskId: string
  action: TaskAction
  effectiveDate: string
  createdAt: string
  previousNextDueAt?: string
  previousLastCompletedAt?: string
  previousArchived?: boolean
  previousPreferredTime?: string
  previousPreferredTimeSource?: 'explicit' | 'observed'
  hasPreferredTimeSnapshot?: boolean
  previousWeekdayPreferredTime?: string
  previousWeekdayPreferredTimeSource?: 'explicit' | 'observed'
  previousWeekendPreferredTime?: string
  previousWeekendPreferredTimeSource?: 'explicit' | 'observed'
  hasDayTypeTimeSnapshot?: boolean
  previousEffort?: number
  previousTrackedMs?: number
}

export interface AppSetting {
  key: string
  value: string
}

export interface ParsedTaskInput {
  title: string
  preferredTime?: string
  dueDate?: string
  intervalDays?: number
  fixedInterval: boolean
}

const TIME_PATTERN = /(?:^|\s)(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a(?:m)?|p(?:m)?)(?=\s|$)/i
const RECURRENCE_PATTERN = /(?:^|\s)(\d+)d(!)?(?=\s|$)/i
const DATE_PATTERN = /(?:^|\s)(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?=\s|$)/

export function parseTaskInput(input: string, referenceDay: Date | string = new Date()): ParsedTaskInput {
  const recurrenceMatch = input.match(RECURRENCE_PATTERN)
  const withoutRecurrence = recurrenceMatch ? input.replace(recurrenceMatch[0], ' ') : input
  const timeMatch = withoutRecurrence.match(TIME_PATTERN)
  const withoutTime = timeMatch ? withoutRecurrence.replace(timeMatch[0], ' ') : withoutRecurrence
  const dateMatch = withoutTime.match(DATE_PATTERN)
  const dueDate = dateMatch ? resolveDueDate(Number(dateMatch[1]), Number(dateMatch[2]), referenceDay) : undefined
  let preferredTime: string | undefined

  if (timeMatch) {
    let hour = Number(timeMatch[1]) % 12
    if (timeMatch[3].toLowerCase().startsWith('p')) hour += 12
    preferredTime = `${String(hour).padStart(2, '0')}:${timeMatch[2] ?? '00'}`
  }

  return {
    title: (dateMatch && dueDate ? withoutTime.replace(dateMatch[0], ' ') : withoutTime).replace(/\s+/g, ' ').trim(),
    preferredTime,
    dueDate,
    intervalDays: recurrenceMatch ? Number(recurrenceMatch[1]) : undefined,
    fixedInterval: Boolean(recurrenceMatch?.[2]),
  }
}

function resolveDueDate(month: number, day: number, referenceDay: Date | string): string | undefined {
  const reference = typeof referenceDay === 'string' ? new Date(`${referenceDay}T12:00:00`) : referenceDay
  const candidate = new Date(reference.getFullYear(), month - 1, day, 12)
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return undefined
  if (dateKey(candidate) < dateKey(reference)) candidate.setFullYear(candidate.getFullYear() + 1)
  return dateKey(candidate)
}

export function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function isTracking(task: Pick<Task, 'trackingStartedAt' | 'trackedMs'>): boolean {
  return task.trackingStartedAt !== undefined || task.trackedMs !== undefined
}

export function trackedMilliseconds(task: Pick<Task, 'trackingStartedAt' | 'trackedMs'>, now: Date | number = Date.now()): number {
  const running = task.trackingStartedAt ? Math.max(0, Number(now) - new Date(task.trackingStartedAt).getTime()) : 0
  return (task.trackedMs ?? 0) + running
}

export function effortFromTracked(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / EFFORT_UNIT_MS))
}

export function delayTargetDate(target: DelayTarget, activeDay: Date | string): Date {
  const day = typeof activeDay === 'string' ? new Date(`${activeDay}T12:00:00`) : activeDay
  if (target === 'weekend') return addDays(day, day.getDay() === 6 ? 1 : 6 - day.getDay())
  if (target === 'week') return addDays(day, ((8 - day.getDay()) % 7) || 7)
  if (target === 'month') return new Date(day.getFullYear(), day.getMonth() + 1, 1, 12)
  return addDays(day, 1)
}

export function isWeekend(value: Date | string): boolean {
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : value
  return date.getDay() === 0 || date.getDay() === 6
}

export function preferredTimeFor(task: Task, value: Date | string): string | undefined {
  return isWeekend(value)
    ? task.weekendPreferredTime ?? task.weekdayPreferredTime ?? task.preferredTime
    : task.weekdayPreferredTime ?? task.weekendPreferredTime ?? task.preferredTime
}

const DAY_FILTERS: Record<string, number[]> = {
  weekday: [1, 2, 3, 4, 5],
  weekend: [0, 6],
  m: [1], mon: [1], monday: [1],
  tu: [2], tue: [2], tues: [2], tuesday: [2],
  w: [3], wed: [3], weds: [3], wednesday: [3],
  th: [4], thu: [4], thur: [4], thurs: [4], thursday: [4],
  f: [5], fri: [5], friday: [5],
  sa: [6], sat: [6], saturday: [6],
  su: [0], sun: [0], sunday: [0],
}

const MONTH_FILTERS: Record<string, number[]> = {
  jan: [0], january: [0], feb: [1], february: [1], mar: [2], march: [2], apr: [3], april: [3],
  may: [4], jun: [5], june: [5], jul: [6], july: [6], aug: [7], august: [7], sep: [8], sept: [8], september: [8],
  oct: [9], october: [9], nov: [10], november: [10], dec: [11], december: [11],
  winter: [11, 0, 1], spring: [2, 3, 4], summer: [5, 6, 7], fall: [8, 9, 10], autumn: [8, 9, 10],
  q1: [0, 1, 2], q2: [3, 4, 5], q3: [6, 7, 8], q4: [9, 10, 11],
}

interface DueFilterRules {
  days: Set<number>
  months: Set<number>
  monthDays: Set<number>
}

export function parseDueFilters(value = ''): DueFilterRules {
  const rules: DueFilterRules = { days: new Set(), months: new Set(), monthDays: new Set() }
  for (const token of value.toLocaleLowerCase().split(/[\s,]+/).filter(Boolean)) {
    DAY_FILTERS[token]?.forEach((day) => rules.days.add(day))
    MONTH_FILTERS[token]?.forEach((month) => rules.months.add(month))
    const ordinal = token.match(/^(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)$/)
    if (ordinal) rules.monthDays.add(Number(ordinal[1]))
  }
  return rules
}

export function dueDateMatchesFilters(value: Date | string, filters?: string): boolean {
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : value
  const rules = parseDueFilters(filters)
  return (!rules.days.size || rules.days.has(date.getDay()))
    && (!rules.months.size || rules.months.has(date.getMonth()))
    && (!rules.monthDays.size || rules.monthDays.has(date.getDate()))
}

export function nextAllowedDueDate(value: Date | string, filters?: string): string {
  const start = typeof value === 'string' ? new Date(`${value}T12:00:00`) : new Date(value)
  let candidate = start
  for (let offset = 0; offset < 366 * 8; offset += 1) {
    if (dueDateMatchesFilters(candidate, filters)) return dateKey(candidate)
    candidate = addDays(candidate, 1)
  }
  return dateKey(start)
}

export function nextDueDate(task: Task, completedAt: Date): string {
  if (!task.intervalDays) return nextAllowedDueDate(addDays(completedAt, 1), task.dueFilters)

  if (!task.fixedInterval) {
    return nextAllowedDueDate(addDays(completedAt, task.intervalDays), task.dueFilters)
  }

  const priorDueDate = new Date(`${task.nextDueAt}T12:00:00`)
  let nextDate = addDays(priorDueDate, task.intervalDays)
  while (nextDate <= completedAt) nextDate = addDays(nextDate, task.intervalDays)
  return nextAllowedDueDate(nextDate, task.dueFilters)
}

export function formatFriendlyDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}