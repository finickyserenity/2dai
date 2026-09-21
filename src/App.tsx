import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FolderKanban,
  LibraryBig,
  ListTodo,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipForward,
  Star,
  Upload,
  X,
} from 'lucide-react'
import { createBackup, db, restoreBackup } from './db'
import { createId } from './id'
import { ListWorkspace } from './ListWorkspace'
import {
  addDays,
  dateKey,
  delayTargetDate,
  effortFromTracked,
  EFFORT_UNIT_MS,
  formatFriendlyDate,
  isTracking,
  isWeekend,
  nextAllowedDueDate,
  nextDueDate,
  parseTaskInput,
  preferredTimeFor,
  trackedMilliseconds,
  type DelayTarget,
  type Task,
  type TaskAction,
  type TaskEvent,
} from './domain'
import './App.css'

type PlannerView = 'today' | 'week' | 'month'
type View = PlannerView | 'sheets'

interface AppLocation {
  view: View
  listId?: string
  projectId?: string
  taskId?: string
}

const viewLabels: Record<View, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  sheets: 'Lists',
}

interface AppProps {
  onRefreshApp: () => Promise<void>
}

function App({ onRefreshApp }: AppProps) {
  const [view, setView] = useState<View>('today')
  const [entry, setEntry] = useState('')
  const [entryListId, setEntryListId] = useState('personal')
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [delayMenuTaskId, setDelayMenuTaskId] = useState<string>()
  const [trackingTaskId, setTrackingTaskId] = useState<string>()
  const [taskTitleDraft, setTaskTitleDraft] = useState('')
  const [dueFiltersDraft, setDueFiltersDraft] = useState('')
  const [lastCompletedDraft, setLastCompletedDraft] = useState('')
  const [lastCompletedTouched, setLastCompletedTouched] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [sheetListId, setSheetListId] = useState<string>()
  const [sheetProjectId, setSheetProjectId] = useState<string>()
  const [sheetTaskId, setSheetTaskId] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [currentDay, setCurrentDay] = useState(() => dateKey(new Date()))
  const [editingUserName, setEditingUserName] = useState(false)
  const [userNameDraft, setUserNameDraft] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)
  const cancelUserNameEditRef = useRef(false)

  useEffect(() => {
    function applyLocation(location: AppLocation) {
      setView(location.view)
      setSheetListId(location.listId)
      setSheetProjectId(location.projectId)
      setSheetTaskId(location.taskId)
    }

    function handlePopState(event: PopStateEvent) {
      const location = event.state?.twoDaiLocation as AppLocation | undefined
      if (location) applyLocation(location)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const updateCurrentDay = () => setCurrentDay(dateKey(new Date()))
    const scheduleNextHour = () => {
      const now = new Date()
      const nextHour = new Date(now)
      nextHour.setHours(now.getHours() + 1, 0, 0, 0)
      timer = setTimeout(() => {
        updateCurrentDay()
        scheduleNextHour()
      }, nextHour.getTime() - now.getTime())
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) updateCurrentDay()
    }

    scheduleNextHour()
    window.addEventListener('focus', updateCurrentDay)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', updateCurrentDay)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const snapshot = useLiveQuery(async () => {
    const [tasks, lists, sections, projects, activeDaySetting, userNameSetting, events] = await Promise.all([
      db.tasks.toArray(),
      db.lists.orderBy('position').toArray(),
      db.sections.toArray(),
      db.projects.toArray(),
      db.settings.get('activeDay'),
      db.settings.get('userName'),
      db.events.toArray(),
    ])
    return { tasks, lists, sections, projects, events, activeDay: activeDaySetting?.value ?? dateKey(new Date()), userName: userNameSetting?.value ?? 'User' }
  }, [], { tasks: [], lists: [], sections: [], projects: [], events: [], activeDay: dateKey(new Date()), userName: 'User' })

  const today = currentDay
  const activeDate = new Date(`${snapshot.activeDay}T12:00:00`)
  const isNewDayAvailable = snapshot.activeDay < today
  const managedEvents = snapshot.events
    .filter((event) => event.effectiveDate === snapshot.activeDay)
    .reduce((events, event) => {
      const existing = events.get(event.taskId)
      if (!existing || existing.createdAt < event.createdAt) events.set(event.taskId, event)
      return events
    }, new Map<string, TaskEvent>())
  const completedIds = new Set([...managedEvents].filter(([, event]) => event.action === 'completed').map(([taskId]) => taskId))
  const managedIds = new Set(managedEvents.keys())
  const visibleTasks = view === 'sheets' ? [] : tasksForView(snapshot.tasks, view, activeDate, managedIds, showCompleted)
  const dueProjects = view === 'sheets' ? [] : snapshot.projects
    .filter((project) => !project.archived && project.includeInPlanner !== false)
    .map((project) => ({
      project,
      tasks: tasksForProjectView(snapshot.tasks, project.id, view, activeDate, managedIds),
    }))
    .filter((group) => group.tasks.length > 0)
  const listById = new Map(snapshot.lists.map((list) => [list.id, list]))
  const effort = visibleTasks.reduce((sum, task) => sum + task.effort, 0)
    + dueProjects.flatMap((group) => group.tasks).reduce((sum, task) => sum + task.effort, 0)
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId)
  const delayMenuTask = snapshot.tasks.find((task) => task.id === delayMenuTaskId)
  const trackingTask = snapshot.tasks.find((task) => task.id === trackingTaskId && isTracking(task))

  const isSheetOpen = Boolean(selectedTask || delayMenuTask || trackingTask)
  useLayoutEffect(() => {
    if (!isSheetOpen) return
    // Keep the list behind a sheet from scrolling. Where the scrollbar takes up room, pad by its
    // width so hiding it does not shift the page sideways.
    const root = document.documentElement
    const scrollbarWidth = window.innerWidth - root.clientWidth
    root.style.overflow = 'hidden'
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      root.style.overflow = ''
      root.style.paddingRight = ''
    }
  }, [isSheetOpen])

  async function addTask(event: FormEvent) {
    event.preventDefault()
    const parsed = parseTaskInput(entry, snapshot.activeDay)
    if (!parsed.title) return

    const now = new Date().toISOString()
    await db.transaction('rw', db.lists, db.tasks, async () => {
      if (!await db.lists.get(entryListId)) return
      await db.tasks.add({
        id: createId(),
        listId: entryListId,
        title: parsed.title,
        ...preferredTimeChanges(parsed.preferredTime, snapshot.activeDay, 'explicit'),
        intervalDays: parsed.intervalDays,
        position: Date.now(),
        effort: 1,
        fixedInterval: parsed.fixedInterval,
        nextDueAt: parsed.dueDate ?? snapshot.activeDay,
        scheduledForPlanner: parsed.intervalDays ? undefined : true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      })
    })
    setEntry('')
  }

  async function manageTask(task: Task, action: TaskAction, delayTarget: DelayTarget = 'day') {
    const now = new Date()
    const effectiveDate = snapshot.activeDay
    // Checking off a previous day's task: the current time says nothing about when it was really done.
    const isCatchUp = effectiveDate < dateKey(now)
    await db.transaction('rw', db.tasks, db.events, async () => {
      let storedTask = await db.tasks.get(task.id)
      if (!storedTask) return
      const existingEvent = managedEvents.get(task.id)
      if (existingEvent) {
        // A delayed or skipped task can still be completed; any other mismatch is ignored.
        if (existingEvent.action !== action && action !== 'completed') return
        const previousCompletion = snapshot.events
          .filter((event) => event.taskId === task.id && event.action === 'completed' && event.createdAt < existingEvent.createdAt)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
        await db.events.delete(existingEvent.id)
        await db.tasks.update(task.id, {
          nextDueAt: existingEvent.previousNextDueAt ?? existingEvent.effectiveDate,
          lastCompletedAt: existingEvent.previousLastCompletedAt ?? previousCompletion?.createdAt,
          archived: existingEvent.previousArchived ?? false,
          // A completion that consumed a timer hands it back paused, so it never counts the time spent checked off.
          ...existingEvent.previousTrackedMs !== undefined
            ? { effort: existingEvent.previousEffort ?? storedTask.effort, trackedMs: existingEvent.previousTrackedMs, trackingStartedAt: undefined }
            : {},
          ...existingEvent.hasPreferredTimeSnapshot
            ? {
                preferredTime: existingEvent.previousPreferredTime,
                preferredTimeSource: existingEvent.previousPreferredTimeSource,
              }
            : {},
          ...existingEvent.hasDayTypeTimeSnapshot
            ? {
                weekdayPreferredTime: existingEvent.previousWeekdayPreferredTime,
                weekdayPreferredTimeSource: existingEvent.previousWeekdayPreferredTimeSource,
                weekendPreferredTime: existingEvent.previousWeekendPreferredTime,
                weekendPreferredTimeSource: existingEvent.previousWeekendPreferredTimeSource,
              }
            : {},
          updatedAt: now.toISOString(),
        })
        if (existingEvent.action === action) return
        storedTask = await db.tasks.get(task.id)
        if (!storedTask) return
      }

      const tracked = isTracking(storedTask) ? trackedMilliseconds(storedTask, now) : undefined
      // Putting a task off stops its clock, but keeps the time already spent.
      const pausedTracking = tracked === undefined ? {} : { trackedMs: tracked, trackingStartedAt: undefined }

      await db.events.add({
        id: createId(),
        taskId: task.id,
        action,
        effectiveDate,
        createdAt: now.toISOString(),
        previousNextDueAt: storedTask.nextDueAt,
        previousLastCompletedAt: storedTask.lastCompletedAt,
        previousArchived: storedTask.archived,
        previousPreferredTime: storedTask.preferredTime,
        previousPreferredTimeSource: storedTask.preferredTimeSource,
        hasPreferredTimeSnapshot: true,
        previousWeekdayPreferredTime: storedTask.weekdayPreferredTime,
        previousWeekdayPreferredTimeSource: storedTask.weekdayPreferredTimeSource,
        previousWeekendPreferredTime: storedTask.weekendPreferredTime,
        previousWeekendPreferredTimeSource: storedTask.weekendPreferredTimeSource,
        hasDayTypeTimeSnapshot: true,
        ...action === 'completed' && tracked !== undefined
          ? { previousEffort: storedTask.effort, previousTrackedMs: tracked }
          : {},
      })

      if (action === 'delayed') {
        await db.tasks.update(task.id, {
          nextDueAt: nextAllowedDueDate(delayTargetDate(delayTarget, effectiveDate), storedTask.dueFilters),
          ...pausedTracking,
          updatedAt: now.toISOString(),
        })
        return
      }

      await db.tasks.update(task.id, {
        nextDueAt: nextDueDate(storedTask, new Date(`${effectiveDate}T12:00:00`)),
        lastCompletedAt: action === 'completed' && !isCatchUp ? now.toISOString() : storedTask.lastCompletedAt,
        archived: action === 'completed' && !storedTask.intervalDays,
        ...action === 'completed' && !isCatchUp
          ? observedTimeChanges(storedTask, effectiveDate, timeKey(now))
          : {},
        ...action !== 'completed'
          ? pausedTracking
          : tracked !== undefined
            ? { effort: effortFromTracked(tracked), trackedMs: undefined, trackingStartedAt: undefined }
            : {},
        updatedAt: now.toISOString(),
      })
    })
  }

  async function updateTracking(task: Task, change: 'start' | 'pause' | 'reset') {
    const now = new Date()
    await db.transaction('rw', db.tasks, async () => {
      const storedTask = await db.tasks.get(task.id)
      if (!storedTask) return
      const elapsed = trackedMilliseconds(storedTask, now)
      await db.tasks.update(task.id, {
        trackedMs: change === 'reset' ? undefined : elapsed,
        trackingStartedAt: change === 'start' ? now.toISOString() : undefined,
        updatedAt: now.toISOString(),
      })
    })
    if (change === 'reset') setTrackingTaskId(undefined)
  }

  async function startNewDay() {
    await db.settings.put({ key: 'activeDay', value: today })
  }

  async function exportData() {
    const backup = await createBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `2dai-backup-${dateKey(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)
    setBackupMessage('Backup downloaded.')
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBackupMessage('')
    setIsImporting(true)
    try {
      const backup: unknown = JSON.parse(await file.text())
      if (!window.confirm('Importing this backup will replace all data currently stored on this device. Continue?')) return
      await restoreBackup(backup)
      setSelectedTaskId(undefined)
      setSheetListId(undefined)
      setSheetProjectId(undefined)
      setSheetTaskId(undefined)
      setBackupMessage('Backup restored successfully.')
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'The backup could not be imported.')
    } finally {
      setIsImporting(false)
    }
  }

  async function refreshFromServer() {
    setBackupMessage('Checking for updates...')
    setIsRefreshing(true)
    try {
      await onRefreshApp()
    } catch {
      setBackupMessage('The update check failed. Check your connection and try again.')
      setIsRefreshing(false)
    }
  }

  async function updateTask(changes: Partial<Task>) {
    if (!selectedTask) return
    await db.transaction('rw', db.lists, db.projects, db.sections, db.tasks, async () => {
      const targetListId = changes.listId ?? selectedTask.listId
      if (!await db.lists.get(targetListId)) return
      if (changes.projectId && !await db.projects.get(changes.projectId)) return
      if (changes.sectionId && !await db.sections.get(changes.sectionId)) return
      await db.tasks.update(selectedTask.id, { ...changes, updatedAt: new Date().toISOString() })
    })
  }

  function openTaskOptions(taskId: string) {
    const task = snapshot.tasks.find((item) => item.id === taskId)
    setTaskTitleDraft(task?.title ?? '')
    setDueFiltersDraft(task?.dueFilters ?? '')
    setLastCompletedDraft(task?.lastCompletedAt ? dateKey(new Date(task.lastCompletedAt)) : '')
    setLastCompletedTouched(false)
    setSelectedTaskId(taskId)
  }

  function closeTaskOptions() {
    setSelectedTaskId(undefined)
    setLastCompletedTouched(false)
  }

  async function saveTaskOptions() {
    if (selectedTask) {
      const title = taskTitleDraft.trim()
      if (!title) return
      const changes: Partial<Task> = title !== selectedTask.title ? { title } : {}
      const dueFilters = dueFiltersDraft.trim()
      if (dueFilters !== (selectedTask.dueFilters ?? '')) changes.dueFilters = dueFilters || undefined
      if (lastCompletedTouched) {
        if (!lastCompletedDraft) {
          changes.lastCompletedAt = undefined
        } else {
          const completedAt = new Date(`${lastCompletedDraft}T12:00:00`)
          changes.lastCompletedAt = completedAt.toISOString()
          if (selectedTask.intervalDays) {
            changes.nextDueAt = nextAllowedDueDate(addDays(completedAt, selectedTask.intervalDays), dueFilters)
            changes.archived = false
          }
        }
      }
      if (!changes.nextDueAt) changes.nextDueAt = nextAllowedDueDate(selectedTask.nextDueAt, dueFilters)
      if (Object.keys(changes).length) await updateTask(changes)
    }
    closeTaskOptions()
  }

  function openSheet(listId?: string, projectId?: string) {
    setSheetListId(listId)
    setSheetProjectId(projectId)
    setSheetTaskId(undefined)
    setView('sheets')
  }

  function openTaskInList(task: Task) {
    const currentLocation: AppLocation = { view, listId: sheetListId, projectId: sheetProjectId, taskId: sheetTaskId }
    const destination: AppLocation = { view: 'sheets', listId: task.listId, projectId: task.projectId, taskId: task.id }
    window.history.replaceState({ ...window.history.state, twoDaiLocation: currentLocation }, '')
    window.history.pushState({ twoDaiLocation: destination }, '')
    setSheetListId(task.listId)
    setSheetProjectId(task.projectId)
    setSheetTaskId(task.id)
    setView('sheets')
  }

  function startEditingUserName() {
    setUserNameDraft(snapshot.userName)
    setEditingUserName(true)
  }

  async function saveUserName() {
    if (cancelUserNameEditRef.current) {
      cancelUserNameEditRef.current = false
      setEditingUserName(false)
      return
    }
    const userName = userNameDraft.trim()
    if (userName && userName !== snapshot.userName) await db.settings.put({ key: 'userName', value: userName })
    setEditingUserName(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">2DAI</div>
        <div>
          <p className="eyebrow">Your day</p>
          <h1>
            {editingUserName
              ? <input autoFocus value={userNameDraft} maxLength={40} aria-label="Header name" onChange={(event) => setUserNameDraft(event.target.value)} onBlur={saveUserName} onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') { cancelUserNameEditRef.current = true; event.currentTarget.blur() }
                }} />
              : <button type="button" onClick={startEditingUserName} aria-label={`Change name ${snapshot.userName}`}>{snapshot.userName}</button>}
          </h1>
        </div>
        <button
          className="menu-button"
          type="button"
          onClick={() => { setSettingsOpen((open) => !open); setBackupMessage('') }}
          aria-expanded={settingsOpen}
          aria-controls="settings-panel"
          aria-label={settingsOpen ? 'Close settings' : 'Open menu'}
        >
          {settingsOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {settingsOpen && (
        <>
          <div className="settings-backdrop" role="presentation" onClick={() => setSettingsOpen(false)} />
          <aside className="settings-panel" id="settings-panel" aria-labelledby="settings-title">
            <nav className="settings-tabs" aria-label="Menu sections">
              <button className="active" type="button"><Settings size={17} />Settings</button>
            </nav>
            <div className="settings-content">
              <p className="eyebrow">Data management</p>
              <h2 id="settings-title">Settings</h2>
              <p className="settings-intro">Check for app updates, download a complete backup, or restore your data on this device.</p>
              <div className="backup-actions">
                <button type="button" onClick={refreshFromServer} disabled={isRefreshing}>
                  <RotateCcw size={19} />
                  <span><strong>{isRefreshing ? 'Checking for updates...' : 'Refresh app'}</strong><small>Load the latest version from the server</small></span>
                </button>
                <button type="button" onClick={exportData}>
                  <Download size={19} />
                  <span><strong>Export data</strong><small>Download a JSON backup</small></span>
                </button>
                <button type="button" onClick={() => backupInputRef.current?.click()} disabled={isImporting}>
                  <Upload size={19} />
                  <span><strong>{isImporting ? 'Importing…' : 'Import data'}</strong><small>Restore from a JSON backup</small></span>
                </button>
                <input ref={backupInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importData} />
              </div>
              {backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}
            </div>
          </aside>
        </>
      )}

      <main className={view === 'sheets' ? 'lists-main' : ''}>
        {view !== 'sheets' && <section className="day-heading">
          <div>
            <p className="date-label">{formatFriendlyDate(activeDate)}</p>
            <h2>{viewLabels[view]}</h2>
          </div>
          <div className="effort-meter" aria-label={`${effort} effort points`}>
            <span>Effort</span>
            <strong>{effort}</strong>
          </div>
        </section>}

        <nav className="view-tabs" aria-label="Planning range">
          {(['today', 'week', 'month', 'sheets'] as const).map((item) => (
            <button className={view === item ? 'active' : ''} key={item} type="button" onClick={() => setView(item)}>
              {item === 'today' ? <ListTodo size={17} /> : item === 'sheets' ? <LibraryBig size={17} /> : <CalendarDays size={17} />}
              {viewLabels[item]}
            </button>
          ))}
        </nav>

        {view === 'sheets' && (
          <ListWorkspace
            lists={snapshot.lists}
            sections={snapshot.sections}
            projects={snapshot.projects}
            tasks={snapshot.tasks}
            initialListId={sheetListId}
            initialProjectId={sheetProjectId}
            focusedTaskId={sheetTaskId}
            activeDay={snapshot.activeDay}
            managedTaskIds={completedIds}
            onLocationChange={openSheet}
            onOpenTask={openTaskInList}
            onManage={manageTask}
            onEdit={openTaskOptions}
          />
        )}

        {view === 'today' && (
          <form className="quick-add" onSubmit={addTask}>
            <Plus size={21} aria-hidden="true" />
            <input value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="Add a task, try ‘Call Mom 2:30p 7d!’" aria-label="New task" />
            <select value={entryListId} onChange={(event) => setEntryListId(event.target.value)} aria-label="Task list">
              {snapshot.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <button type="submit" disabled={!entry.trim()}>Add</button>
          </form>
        )}

        {isNewDayAvailable && view === 'today' && (
          <button className="new-day" type="button" onClick={startNewDay}>
            <span className="new-day-icon"><RotateCcw size={19} /></span>
            <span><strong>Start new day</strong><small>{formatFriendlyDate(new Date(`${today}T12:00:00`))}</small></span>
            <ChevronRight size={20} />
          </button>
        )}

        {view !== 'sheets' && <section className="task-section" aria-live="polite">
          <div className="section-label">
            <span>{view === 'today' ? `${visibleTasks.length + dueProjects.length} items` : 'Upcoming'}</span>
            {(view === 'today' || view === 'week' || view === 'month') && (
              <label><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} /> Show managed</label>
            )}
          </div>

          <div className="task-list">
            {dueProjects.map(({ project, tasks }) => {
              const list = listById.get(project.listId)
              return (
                <article className="task-row project-rollup" key={project.id}>
                  <span className="project-rollup-icon"><FolderKanban size={19} /></span>
                  <button className="task-copy" type="button" onClick={() => openSheet(project.listId, project.id)}>
                    <span className="task-title">{project.name}</span>
                    <span className="task-meta"><i style={{ background: list?.color }} /> {list?.name} · {tasks.length} due inside</span>
                  </button>
                  <button className="rollup-open" type="button" onClick={() => openSheet(project.listId, project.id)} aria-label={`Open ${project.name}`}><ChevronRight size={19} /></button>
                </article>
              )
            })}
            {visibleTasks.map((task, index) => {
              const list = listById.get(task.listId)
              const managedAction = managedEvents.get(task.id)?.action
              const isManaged = Boolean(managedAction)
              const isNotDue = task.nextDueAt > snapshot.activeDay
              const preferredTime = preferredTimeFor(task, activeDate)
              const groupDate = isManaged ? snapshot.activeDay : task.nextDueAt
              const previousTask = visibleTasks[index - 1]
              const previousGroupDate = previousTask && managedEvents.has(previousTask.id) ? snapshot.activeDay : previousTask?.nextDueAt
              const groupKey = view === 'month' ? weekGroupKey(groupDate) : groupDate
              const previousGroupKey = previousGroupDate && (view === 'month' ? weekGroupKey(previousGroupDate) : previousGroupDate)
              const isRare = (view === 'week' || view === 'month') && (!task.intervalDays || task.intervalDays >= 180)
              return (
                <Fragment key={task.id}>
                  {view === 'week' && groupDate !== previousGroupDate && <div className="task-day-divider">{formatDayGroup(groupDate, snapshot.activeDay)}</div>}
                  {view === 'month' && groupKey !== previousGroupKey && <MonthWeekDivider value={groupDate} />}
                  <article className={`task-row${isManaged ? ' managed' : ''}${isNotDue ? ' not-due' : ''}`}>
                    <button className="complete-button" type="button" onClick={() => manageTask(task, 'completed')} aria-pressed={managedAction === 'completed'} aria-label={`${managedAction === 'completed' ? 'Uncheck' : 'Complete'} ${task.title}`}><Check size={20} /></button>
                    <button className="task-copy" type="button" onClick={() => openTaskInList(task)}>
                      <span className={`task-title${isRare ? ' rare' : ''}`}>{isRare && <Star className="task-title-star" size={15} fill="currentColor" aria-hidden="true" />}{task.title}</span>
                      <span className="task-meta">
                        <i style={{ background: list?.color }} /> {list?.name ?? 'Unsorted'}
                        {preferredTime && <><Clock3 size={13} /> {formatTime(preferredTime)}</>}
                        {view !== 'today' && <span className="task-due">Due {formatFriendlyDate(new Date(`${task.nextDueAt}T12:00:00`))}</span>}
                      </span>
                    </button>
                    <div className="task-actions">
                      {!isManaged && <DelayButton title={task.title} onDelay={() => manageTask(task, 'delayed')} onOpenMenu={() => setDelayMenuTaskId(task.id)} />}
                      {managedAction === 'delayed' && <button type="button" onClick={() => manageTask(task, 'delayed')} title="Undo delay" aria-pressed="true" aria-label={`Undo delay for ${task.title}`}><Clock3 size={18} /></button>}
                      {managedAction === 'skipped' && <button type="button" onClick={() => manageTask(task, 'skipped')} title="Undo skip" aria-pressed="true" aria-label={`Undo skip for ${task.title}`}><SkipForward size={18} /></button>}
                      {!isManaged && (isTracking(task)
                        ? <EffortBadge task={task} onOpen={() => setTrackingTaskId(task.id)} />
                        : <button type="button" onClick={() => updateTracking(task, 'start')} title="Track effort" aria-label={`Track effort for ${task.title}`}><Play size={18} /></button>)}
                      <button type="button" onClick={() => openTaskOptions(task.id)} title="Task options" aria-label={`Options for ${task.title}`}><MoreHorizontal size={19} /></button>
                    </div>
                  </article>
                </Fragment>
              )
            })}
            {!visibleTasks.length && !dueProjects.length && (
              <div className="empty-state"><Check size={26} /><strong>Nothing waiting here</strong><span>{view === 'today' ? 'Add a task or take the win.' : view === 'week' ? 'No weekly or one-time tasks are due in this range.' : 'No monthly or one-time tasks are due in this range.'}</span></div>
            )}
          </div>
        </section>}
      </main>

      {delayMenuTask && (
        <SheetBackdrop onClose={() => setDelayMenuTaskId(undefined)}>
          <section className="options-sheet" role="dialog" aria-modal="true" aria-labelledby="delay-menu-title">
            <div className="sheet-handle" />
            <div className="sheet-heading">
              <div><p className="eyebrow">Put off</p><h3 id="delay-menu-title">{delayMenuTask.title}</h3></div>
              <button className="text-button" type="button" onClick={() => setDelayMenuTaskId(undefined)}>Cancel</button>
            </div>
            <div className="sheet-menu">
              {DELAY_TARGETS.map(({ target, label }) => (
                <button key={target} type="button" onClick={() => { setDelayMenuTaskId(undefined); void manageTask(delayMenuTask, 'delayed', target) }}>
                  <Clock3 size={18} /><span>{label}</span>
                  <small>{formatFriendlyDate(new Date(`${nextAllowedDueDate(delayTargetDate(target, snapshot.activeDay), delayMenuTask.dueFilters)}T12:00:00`))}</small>
                </button>
              ))}
              <button type="button" onClick={() => { setDelayMenuTaskId(undefined); void manageTask(delayMenuTask, 'skipped') }}>
                <SkipForward size={18} /><span>Skip this occurrence</span>
                <small>{formatFriendlyDate(new Date(`${nextDueDate(delayMenuTask, activeDate)}T12:00:00`))}</small>
              </button>
            </div>
          </section>
        </SheetBackdrop>
      )}

      {trackingTask && <TrackingSheet task={trackingTask} list={listById.get(trackingTask.listId)?.name} onChange={(change) => updateTracking(trackingTask, change)} onClose={() => setTrackingTaskId(undefined)} />}

      {selectedTask && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={closeTaskOptions}>
          <section className="options-sheet" role="dialog" aria-modal="true" aria-labelledby="options-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-heading">
              <div><p className="eyebrow">Task options</p><h3 id="options-title">{selectedTask.title}</h3></div>
              <button className="text-button" type="button" disabled={!taskTitleDraft.trim()} onClick={saveTaskOptions}>Done</button>
            </div>
            <div className="option-grid">
              <label className="subject-field">Subject<input value={taskTitleDraft} onChange={(event) => setTaskTitleDraft(event.target.value)} /></label>
              <label>List<select value={selectedTask.listId} onChange={(event) => updateTask({ listId: event.target.value })}>{snapshot.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
              <label>Section<select aria-label="Section" value={selectedTask.sectionId ?? ''} onChange={(event) => updateTask({ sectionId: event.target.value || undefined })}><option value="">Todo</option>{snapshot.sections.filter((section) => section.listId === selectedTask.listId).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
              <label>Project<select value={selectedTask.projectId ?? ''} onChange={(event) => updateTask({ projectId: event.target.value || undefined })}><option value="">Top level</option>{snapshot.projects.filter((project) => project.listId === selectedTask.listId && !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label>Effort<input type="number" min="1" max="10" value={selectedTask.effort} onChange={(event) => updateTask({ effort: Number(event.target.value) })} /></label>
              <label>Repeat every<input type="number" min="1" placeholder="Days" value={selectedTask.intervalDays ?? ''} onChange={(event) => updateTask({ intervalDays: event.target.value ? Number(event.target.value) : undefined })} /></label>
              <label>{isWeekend(activeDate) ? 'Weekend time' : 'Weekday time'}<input type="time" value={preferredTimeFor(selectedTask, activeDate) ?? ''} onChange={(event) => updateTask(preferredTimeChanges(event.target.value || undefined, activeDate, 'explicit'))} /></label>
              <label>Due date<input type="date" value={selectedTask.nextDueAt} onChange={(event) => event.target.value && updateTask({ nextDueAt: event.target.value, archived: false, scheduledForPlanner: selectedTask.intervalDays ? undefined : true })} /></label>
              <label>Last completed<input type="date" value={lastCompletedDraft} onClick={() => setLastCompletedTouched(true)} onChange={(event) => { setLastCompletedDraft(event.target.value); setLastCompletedTouched(true) }} /></label>
              <label className="due-filters-field">Due filters<textarea rows={2} value={dueFiltersDraft} onChange={(event) => setDueFiltersDraft(event.target.value)} placeholder="weekday, mon, q1, 14th" /></label>
            </div>
            <label className="toggle-row"><span><strong>Fixed schedule</strong><small>Repeat from the scheduled date, not completion</small></span><input type="checkbox" checked={selectedTask.fixedInterval} onChange={(event) => updateTask({ fixedInterval: event.target.checked })} /></label>
            <button className="archive-button" type="button" onClick={async () => { await updateTask({ archived: true }); closeTaskOptions() }}>Archive task</button>
          </section>
        </div>
      )}
    </div>
  )
}

const DELAY_TARGETS: Array<{ target: DelayTarget; label: string }> = [
  { target: 'day', label: 'Delay one day' },
  { target: 'weekend', label: 'Until the weekend' },
  { target: 'week', label: 'Until next week' },
  { target: 'month', label: 'Until next month' },
]

const LONG_PRESS_MS = 500

function DelayButton({ title, onDelay, onOpenMenu }: { title: string; onDelay: () => void; onOpenMenu: () => void }) {
  const timer = useRef<number | undefined>(undefined)
  const menuOpened = useRef(false)

  function cancel() {
    window.clearTimeout(timer.current)
  }

  function openMenu() {
    cancel()
    if (menuOpened.current) return
    menuOpened.current = true
    onOpenMenu()
  }

  useEffect(() => cancel, [])

  return (
    <button
      className="delay-button"
      type="button"
      title="Delay one day (hold for more)"
      aria-label={`Delay ${title}`}
      aria-haspopup="dialog"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        menuOpened.current = false
        timer.current = window.setTimeout(openMenu, LONG_PRESS_MS)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => { event.preventDefault(); openMenu() }}
      onClick={() => {
        // The release that ends a long press must not also delay the task.
        if (menuOpened.current) { menuOpened.current = false; return }
        onDelay()
      }}
    ><Clock3 size={18} /></button>
  )
}

function SheetBackdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const pressedBackdrop = useRef(false)
  // Only a press that both starts and ends on the dimmed area closes the sheet, so the
  // finger lifting from the long press that opened it cannot dismiss it again.
  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget }}
      onClick={(event) => { if (event.target === event.currentTarget && pressedBackdrop.current) onClose() }}
    >{children}</div>
  )
}

function useNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(interval)
  }, [active, intervalMs])
  return now
}

function EffortBadge({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const running = Boolean(task.trackingStartedAt)
  const effort = effortFromTracked(trackedMilliseconds(task, useNow(running, 1_000)))
  return (
    <button className={`effort-badge${running ? ' running' : ''}`} type="button" onClick={onOpen} title={running ? 'Tracking effort' : 'Effort tracking paused'} aria-label={`Effort ${effort} for ${task.title}, ${running ? 'tracking' : 'paused'}`}>
      <span>{effort}</span>
    </button>
  )
}

function TrackingSheet({ task, list, onChange, onClose }: { task: Task; list?: string; onChange: (change: 'start' | 'pause' | 'reset') => void; onClose: () => void }) {
  const running = Boolean(task.trackingStartedAt)
  const elapsed = trackedMilliseconds(task, useNow(running, 1_000))
  const effort = effortFromTracked(elapsed)
  return (
    <SheetBackdrop onClose={onClose}>
      <section className="options-sheet" role="dialog" aria-modal="true" aria-labelledby="tracking-title">
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div><p className="eyebrow">Tracking effort{list ? ` · ${list}` : ''}</p><h3 id="tracking-title">{task.title}</h3></div>
          <button className="text-button" type="button" onClick={onClose}>Continue</button>
        </div>
        <dl className="tracking-stats">
          <div><dt>{running ? 'Running since' : 'Status'}</dt><dd>{running ? formatTime(timeKey(new Date(task.trackingStartedAt!))) : 'Paused'}</dd></div>
          <div><dt>Time spent</dt><dd aria-label="Time spent">{formatElapsed(elapsed)}</dd></div>
          <div><dt>Effort so far</dt><dd aria-label="Effort so far">{effort}</dd></div>
          <div><dt>Saved effort</dt><dd>{task.effort}</dd></div>
        </dl>
        <p className="tracking-note">Effort counts 1 for every {EFFORT_UNIT_MS / 60_000} minutes started. Checking off the task saves {effort} as its effort and stops the timer.</p>
        <div className="tracking-actions">
          {running
            ? <button type="button" onClick={() => onChange('pause')}><Pause size={17} /> Pause</button>
            : <button type="button" onClick={() => onChange('start')}><Play size={17} /> Resume</button>}
          <button type="button" onClick={() => onChange('reset')}><RotateCcw size={17} /> Reset</button>
        </div>
      </section>
    </SheetBackdrop>
  )
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000)
  const hours = Math.floor(seconds / 3_600)
  const rest = `${String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return hours ? `${hours}:${rest}` : rest
}

function tasksForView(tasks: Task[], view: PlannerView, activeDate: Date, managedIds: Set<string>, showCompleted: boolean): Task[] {
  const start = dateKey(activeDate)
  const end = dateKey(addDays(activeDate, view === 'week' ? 7 : 31))
  return tasks
    .filter((task) => !task.projectId)
    .filter((task) => Boolean(task.intervalDays) || task.scheduledForPlanner === true)
    .filter((task) => !task.archived || (showCompleted && managedIds.has(task.id)))
    .filter((task) => {
      if (view === 'today') return managedIds.has(task.id) ? showCompleted : task.nextDueAt <= start
      if (view === 'week') {
        if (task.intervalDays && task.intervalDays < 7) return false
        if (managedIds.has(task.id)) return showCompleted
        return task.nextDueAt > start && task.nextDueAt <= end
      }
      if (task.intervalDays && task.intervalDays < 28) return false
      if (managedIds.has(task.id)) return showCompleted
      return task.nextDueAt > start && task.nextDueAt <= end
    })
    .sort((left, right) => view !== 'today'
      ? ((view === 'week' || view === 'month') && managedIds.has(left.id) ? start : left.nextDueAt).localeCompare((view === 'week' || view === 'month') && managedIds.has(right.id) ? start : right.nextDueAt) || left.position - right.position
      : (preferredTimeFor(left, activeDate) ?? '99:99').localeCompare(preferredTimeFor(right, activeDate) ?? '99:99') || left.position - right.position)
}

function tasksForProjectView(tasks: Task[], projectId: string, view: PlannerView, activeDate: Date, managedIds: Set<string>): Task[] {
  const start = dateKey(activeDate)
  const end = dateKey(addDays(activeDate, view === 'week' ? 7 : 31))
  return tasks
    .filter((task) => task.projectId === projectId && !task.archived && !managedIds.has(task.id))
    .filter((task) => Boolean(task.intervalDays) || task.scheduledForPlanner === true)
    .filter((task) => {
      if (view === 'today') return task.nextDueAt <= start
      if (view === 'week' && task.intervalDays && task.intervalDays < 7) return false
      if (view === 'month' && task.intervalDays && task.intervalDays < 28) return false
      return task.nextDueAt > start && task.nextDueAt <= end
    })
}

function formatDayGroup(value: string, activeDay: string): string {
  if (value === activeDay) return 'Today'
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

function MonthWeekDivider({ value }: { value: string }) {
  const date = new Date(`${value}T12:00:00`)
  const start = startOfIsoWeek(date)
  const end = addDays(start, 6)
  const crossesMonth = start.getMonth() !== end.getMonth()
  const startLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start)
  const endLabel = new Intl.DateTimeFormat('en-US', { month: crossesMonth ? 'short' : undefined, day: 'numeric' }).format(end)

  return (
    <div className="task-week-divider">
      <span>Week {isoWeekNumber(date)}</span>
      <span>{startLabel}–{crossesMonth ? <strong>{endLabel}</strong> : endLabel}</span>
    </div>
  )
}

function weekGroupKey(value: string): string {
  return dateKey(startOfIsoWeek(new Date(`${value}T12:00:00`)))
}

function startOfIsoWeek(date: Date): Date {
  const day = date.getDay() || 7
  return addDays(date, 1 - day)
}

function isoWeekNumber(date: Date): number {
  const thursday = addDays(startOfIsoWeek(date), 3)
  const yearStart = new Date(thursday.getFullYear(), 0, 4, 12)
  return 1 + Math.round((startOfIsoWeek(thursday).getTime() - startOfIsoWeek(yearStart).getTime()) / 604_800_000)
}

function formatTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute))
}

function timeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function earliestTime(previous: string | undefined, current: string): string {
  return previous && previous < current ? previous : current
}

function preferredTimeChanges(value: string | undefined, day: Date | string, source: 'explicit' | 'observed'): Partial<Task> {
  return isWeekend(day)
    ? { weekendPreferredTime: value, weekendPreferredTimeSource: value ? source : undefined }
    : { weekdayPreferredTime: value, weekdayPreferredTimeSource: value ? source : undefined }
}

function observedTimeChanges(task: Task, day: Date | string, current: string): Partial<Task> {
  const weekend = isWeekend(day)
  const previous = weekend ? task.weekendPreferredTime : task.weekdayPreferredTime
  const source = weekend ? task.weekendPreferredTimeSource : task.weekdayPreferredTimeSource
  return source === 'explicit' ? {} : preferredTimeChanges(earliestTime(previous, current), day, 'observed')
}

export default App