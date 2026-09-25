import Dexie, { type EntityTable } from 'dexie'
import type { AppSetting, ProjectFolder, Task, TaskEvent, TaskList, TaskSection } from './domain'
import { dateKey } from './domain'
import type { ServerConnection } from './sync/types'

const BACKUP_FORMAT = '2dai-backup'
const BACKUP_VERSION = 1

export interface TwoDaiBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  data: {
    lists: TaskList[]
    sections: TaskSection[]
    projects: ProjectFolder[]
    tasks: Task[]
    events: TaskEvent[]
    settings: AppSetting[]
  }
}

class TwoDaiDatabase extends Dexie {
  lists!: EntityTable<TaskList, 'id'>
  sections!: EntityTable<TaskSection, 'id'>
  projects!: EntityTable<ProjectFolder, 'id'>
  tasks!: EntityTable<Task, 'id'>
  events!: EntityTable<TaskEvent, 'id'>
  settings!: EntityTable<AppSetting, 'key'>
  servers!: EntityTable<ServerConnection, 'id'>

  constructor() {
    super('2dai-local')
    this.version(1).stores({
      lists: 'id, position',
      tasks: 'id, listId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
    })
    this.version(2).stores({
      lists: 'id, position',
      sections: 'id, listId, [listId+position]',
      projects: 'id, listId, archived, [listId+position]',
      tasks: 'id, listId, sectionId, projectId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
    })
    this.version(3).stores({
      lists: 'id, position',
      sections: 'id, listId, projectId, [listId+position]',
      projects: 'id, listId, archived, [listId+position]',
      tasks: 'id, listId, sectionId, projectId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
    })
    this.version(4).stores({
      lists: 'id, position',
      sections: 'id, listId, projectId, [listId+position]',
      projects: 'id, listId, archived, [listId+position]',
      tasks: 'id, listId, sectionId, projectId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
    }).upgrade(async (transaction) => {
      await transaction.table('tasks').toCollection().modify((task: Task & { plannerVisible?: boolean }) => {
        delete task.plannerVisible
      })
      await transaction.table('projects').toCollection().modify((project: ProjectFolder) => {
        if (project.includeInPlanner === undefined) project.includeInPlanner = true
      })
    })
    this.version(5).stores({
      lists: 'id, position',
      sections: 'id, listId, projectId, [listId+position]',
      projects: 'id, listId, archived, [listId+position]',
      tasks: 'id, listId, sectionId, projectId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
    }).upgrade(async (transaction) => {
      await transaction.table('tasks').toCollection().modify((task: Task) => {
        if (!task.intervalDays) task.scheduledForPlanner = false
      })
    })
    // Server connections for sync (DESIGN.md 1.1). Task data is untouched.
    this.version(6).stores({
      lists: 'id, position',
      sections: 'id, listId, projectId, [listId+position]',
      projects: 'id, listId, archived, [listId+position]',
      tasks: 'id, listId, sectionId, projectId, nextDueAt, archived, position, updatedAt',
      events: 'id, taskId, effectiveDate, createdAt',
      settings: 'key',
      servers: 'id, kind, instanceId',
    })

    this.on('populate', () => {
      const now = new Date().toISOString()
      const today = dateKey(new Date())

      return this.transaction('rw', this.lists, this.tasks, this.settings, async () => {
        await this.lists.bulkAdd([
          { id: 'personal', name: 'Personal', color: '#4d82b8', position: 0 },
          { id: 'household', name: 'Household', color: '#5b8f7a', position: 1 },
          { id: 'errands', name: 'Errands', color: '#b57a52', position: 2 },
        ])
        await this.tasks.bulkAdd([
          makeTask('review-schedule', 'personal', "Check today's schedule", 0, today, now, { preferredTime: '08:00', intervalDays: 1 }),
          makeTask('tidy-living-space', 'household', 'Tidy up', 1, today, now, { intervalDays: 1, effort: 2 }),
          makeTask('laundry', 'household', 'Do laundry', 2, dateKey(new Date(Date.now() + 2 * 86_400_000)), now, { intervalDays: 7, effort: 3 }),
          makeTask('household-waste', 'household', 'Take out the trash', 3, dateKey(new Date(Date.now() + 3 * 86_400_000)), now, { intervalDays: 7, effort: 2 }),
          makeTask('essential-supplies', 'errands', 'Pick up groceries', 4, dateKey(new Date(Date.now() + 4 * 86_400_000)), now, { intervalDays: 7, effort: 2 }),
          makeTask('recurring-expenses', 'personal', 'Check upcoming bills', 5, dateKey(new Date(Date.now() + 7 * 86_400_000)), now, { intervalDays: 30, effort: 2 }),
        ])
        await this.settings.add({ key: 'activeDay', value: today })
        await this.settings.add({ key: 'userName', value: 'User' })
      })
    })
  }
}

function makeTask(
  id: string,
  listId: string,
  title: string,
  position: number,
  nextDueAt: string,
  now: string,
  options: Partial<Task> = {},
): Task {
  return {
    id,
    listId,
    title,
    position,
    effort: 1,
    fixedInterval: false,
    nextDueAt,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...options,
  }
}

export const db = new TwoDaiDatabase()

export async function createBackup(): Promise<TwoDaiBackup> {
  const [lists, sections, projects, tasks, events, settings] = await db.transaction(
    'r',
    [db.lists, db.sections, db.projects, db.tasks, db.events, db.settings],
    () => Promise.all([
      db.lists.toArray(),
      db.sections.toArray(),
      db.projects.toArray(),
      db.tasks.toArray(),
      db.events.toArray(),
      db.settings.toArray(),
    ]),
  )

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { lists, sections, projects, tasks, events, settings },
  }
}

export async function restoreBackup(value: unknown): Promise<void> {
  if (!isBackup(value)) throw new Error('This file is not a valid 2dai backup.')

  const dataTables = [db.lists, db.sections, db.projects, db.tasks, db.events, db.settings]
  await db.transaction('rw', dataTables, async () => {
    await Promise.all(dataTables.map((table) => table.clear()))
    await db.lists.bulkAdd(value.data.lists)
    await db.sections.bulkAdd(value.data.sections)
    await db.projects.bulkAdd(value.data.projects)
    await db.tasks.bulkAdd(value.data.tasks)
    await db.events.bulkAdd(value.data.events)
    await db.settings.bulkAdd(value.data.settings)
  })
}

function isBackup(value: unknown): value is TwoDaiBackup {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !isRecord(value.data)) return false
  const { lists, sections, projects, tasks, events, settings } = value.data
  return isRecordArray(lists, ['id', 'name', 'color', 'position'])
    && isRecordArray(sections, ['id', 'listId', 'name', 'position'])
    && isRecordArray(projects, ['id', 'listId', 'name', 'position', 'archived'])
    && isRecordArray(tasks, ['id', 'listId', 'title', 'position', 'effort', 'fixedInterval', 'nextDueAt', 'archived', 'createdAt', 'updatedAt'])
    && isRecordArray(events, ['id', 'taskId', 'action', 'effectiveDate', 'createdAt'])
    && isRecordArray(settings, ['key', 'value'])
}

function isRecordArray(value: unknown, requiredKeys: string[]): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && requiredKeys.every((key) => key in item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}