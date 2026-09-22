import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Pencil,
  FolderKanban,
  Import,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { db } from './db'
import { submitOnLeave } from './forms'
import { createId } from './id'
import { ImportListDialog } from './ImportListDialog.tsx'
import { isWeekend, parseTaskInput, TITLE_MAX_LENGTH, type ProjectFolder, type Task, type TaskAction, type TaskList, type TaskSection } from './domain'

interface ListWorkspaceProps {
  lists: TaskList[]
  sections: TaskSection[]
  projects: ProjectFolder[]
  tasks: Task[]
  initialListId?: string
  initialProjectId?: string
  focusedTaskId?: string
  activeDay: string
  managedTaskIds: Set<string>
  onLocationChange: (listId?: string, projectId?: string) => void
  onOpenTask: (task: Task) => void
  onManage: (task: Task, action: TaskAction) => Promise<void>
  onEdit: (taskId: string) => void
}

export function ListWorkspace({
  lists,
  sections,
  projects,
  tasks,
  initialListId,
  initialProjectId,
  focusedTaskId,
  activeDay,
  managedTaskIds,
  onLocationChange,
  onOpenTask,
  onManage,
  onEdit,
}: ListWorkspaceProps) {
  const [search, setSearch] = useState('')
  const [creationMode, setCreationMode] = useState<'section' | 'project'>()
  const [creationName, setCreationName] = useState('')
  const activeList = lists.find((list) => list.id === initialListId)
  const activeProject = projects.find((project) => project.id === initialProjectId)

  useEffect(() => {
    if (!focusedTaskId) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`task-${focusedTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedTaskId, initialListId, initialProjectId])

  if (!activeList) {
    return <ListIndex lists={lists} sections={sections} tasks={tasks} projects={projects} onOpen={onLocationChange} onOpenTask={onOpenTask} />
  }

  const activeListId = activeList.id
  const listSections = sections
    .filter((section) => section.listId === activeListId)
    .filter((section) => activeProject ? section.projectId === activeProject.id : !section.projectId)
    .sort((a, b) => a.position - b.position)
  const listProjects = projects.filter((project) => project.listId === activeListId && !project.archived).sort((a, b) => a.position - b.position)
  const activeListTasks = tasks.filter((task) => task.listId === activeListId)
  const canDeleteList = activeListTasks.every((task) => task.archived)
  const activeProjectTasks = activeProject ? tasks.filter((task) => task.projectId === activeProject.id) : []
  const canDeleteProject = activeProjectTasks.every((task) => task.archived)
  const scopedTasks = tasks
    .filter((task) => task.listId === activeListId && (!task.archived || managedTaskIds.has(task.id)))
    .filter((task) => activeProject ? task.projectId === activeProject.id : !task.projectId)
    .filter((task) => task.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.position - b.position)

  async function createContainer(event: FormEvent) {
    event.preventDefault()
    const name = creationName.trim()
    if (!name || !creationMode) return
    const id = createId()
    if (creationMode === 'section') {
      await db.transaction('rw', db.lists, db.projects, db.sections, async () => {
        if (!await db.lists.get(activeListId)) return
        if (activeProject && !await db.projects.get(activeProject.id)) return
        await db.sections.add({ id, listId: activeListId, projectId: activeProject?.id, name, position: Date.now() })
      })
    } else {
      const created = await db.transaction('rw', db.lists, db.projects, async () => {
        if (!await db.lists.get(activeListId)) return false
        await db.projects.add({ id, listId: activeListId, name, position: Date.now(), includeInPlanner: true, archived: false })
        return true
      })
      if (created) onLocationChange(activeListId, id)
    }
    setCreationName('')
    setCreationMode(undefined)
  }

  async function deleteProject() {
    if (!activeProject) return
    const deleted = await db.transaction('rw', db.projects, db.sections, db.tasks, db.events, async () => {
      const storedTasks = await db.tasks.where('projectId').equals(activeProject.id).toArray()
      if (storedTasks.some((task) => !task.archived)) return false
      if (storedTasks.length) {
        await db.events.where('taskId').anyOf(storedTasks.map((task) => task.id)).delete()
        await db.tasks.bulkDelete(storedTasks.map((task) => task.id))
      }
      await db.sections.where('projectId').equals(activeProject.id).delete()
      await db.projects.delete(activeProject.id)
      return true
    })
    if (deleted) onLocationChange(activeListId)
  }

  async function setProjectPlannerInclusion(includeInPlanner: boolean) {
    if (!activeProject) return
    await db.projects.update(activeProject.id, { includeInPlanner })
  }

  async function moveSection(section: TaskSection, offset: -1 | 1) {
    const index = listSections.findIndex((item) => item.id === section.id)
    const other = listSections[index + offset]
    if (!other) return
    await db.transaction('rw', db.sections, async () => {
      await db.sections.update(section.id, { position: other.position })
      await db.sections.update(other.id, { position: section.position })
    })
  }

  async function deleteList() {
    if (activeProject) return
    const deleted = await db.transaction('rw', db.lists, db.projects, db.sections, db.tasks, db.events, async () => {
      const storedTasks = await db.tasks.where('listId').equals(activeListId).toArray()
      if (storedTasks.some((task) => !task.archived)) return false
      if (storedTasks.length) {
        await db.events.where('taskId').anyOf(storedTasks.map((task) => task.id)).delete()
        await db.tasks.bulkDelete(storedTasks.map((task) => task.id))
      }
      await db.sections.where('listId').equals(activeListId).delete()
      await db.projects.where('listId').equals(activeListId).delete()
      await db.lists.delete(activeListId)
      return true
    })
    if (deleted) onLocationChange()
  }

  return (
    <section className="list-workspace">
      <div className="list-breadcrumbs">
        <button type="button" onClick={() => onLocationChange()}><ArrowLeft size={17} /> Lists</button>
        <ChevronRight size={15} />
        <button type="button" onClick={() => onLocationChange(activeList.id)}>{activeList.name}</button>
        {activeProject && <><ChevronRight size={15} /><strong>{activeProject.name}</strong></>}
      </div>

      <div className="list-titlebar">
        <div>
          <p className="date-label">{activeProject ? 'Project folder' : 'Task list'}</p>
          <h2>{activeProject?.name ?? activeList.name}</h2>
          <span>{scopedTasks.length} visible tasks</span>
        </div>
        <div className="list-title-actions">
          {activeProject && <label className="project-planner-toggle"><input key={activeProject.id} type="checkbox" defaultChecked={activeProject.includeInPlanner !== false} onChange={(event) => setProjectPlannerInclusion(event.target.checked)} /> Show in planner</label>}
          {!activeProject && <button type="button" onClick={() => setCreationMode('project')}><FolderKanban size={17} /> New project</button>}
          <button type="button" onClick={() => setCreationMode('section')}><Plus size={17} /> New section</button>
          {!activeProject && <button className="danger-button" type="button" disabled={!canDeleteList} onClick={deleteList} title={canDeleteList ? 'Delete list and its archived tasks' : 'Archive every task before deleting this list'}><Trash2 size={17} /> Delete list</button>}
          {activeProject && <button className="danger-button" type="button" disabled={!canDeleteProject} onClick={deleteProject} title={canDeleteProject ? 'Delete project and its archived tasks' : 'Archive every task before deleting this project'}><Trash2 size={17} /> Delete project</button>}
        </div>
      </div>

      {creationMode && (
        <form className="inline-create" onSubmit={createContainer}>
          {creationMode === 'project' ? <FolderKanban size={18} /> : <Plus size={18} />}
          <input autoFocus value={creationName} onChange={(event) => setCreationName(event.target.value)} placeholder={creationMode === 'project' ? 'Project folder name' : 'Section name'} aria-label={creationMode === 'project' ? 'Project folder name' : 'Section name'} />
          <button type="submit" disabled={!creationName.trim()}>Create</button>
          <button type="button" onClick={() => setCreationMode(undefined)}>Cancel</button>
        </form>
      )}

      <div className="list-toolbar">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter this list" aria-label="Filter this list" />
      </div>

      {!activeProject && listProjects.length > 0 && (
        <div className="project-strip">
          {listProjects.map((project) => {
            const projectTasks = tasks.filter((task) => task.projectId === project.id && !task.archived)
            return (
              <button type="button" key={project.id} onClick={() => onLocationChange(activeList.id, project.id)}>
                <FolderKanban size={19} />
                <span><strong>{project.name}</strong><small>{projectTasks.length} tasks</small></span>
                <ChevronRight size={17} />
              </button>
            )
          })}
        </div>
      )}

      <SheetSection
        key={`todo:${activeList.id}:${activeProject?.id ?? 'root'}`}
        name="Todo"
        tasks={scopedTasks.filter((task) => !task.sectionId || !listSections.some((section) => section.id === task.sectionId))}
        focusedTaskId={focusedTaskId}
        listId={activeList.id}
        projectId={activeProject?.id}
        activeDay={activeDay}
        managedTaskIds={managedTaskIds}
        onManage={onManage}
        onEdit={onEdit}
      />
      {listSections.map((section, index) => (
        <SheetSection
          key={section.id}
          section={section}
          name={section.name}
          tasks={scopedTasks.filter((task) => task.sectionId === section.id)}
          sectionTasks={tasks.filter((task) => task.listId === activeList.id && task.projectId === activeProject?.id && task.sectionId === section.id)}
          focusedTaskId={focusedTaskId}
          listId={activeList.id}
          sectionId={section.id}
          projectId={activeProject?.id}
          activeDay={activeDay}
          managedTaskIds={managedTaskIds}
          onManage={onManage}
          onEdit={onEdit}
          onMoveSection={moveSection}
          canMoveSectionUp={index > 0}
          canMoveSectionDown={index < listSections.length - 1}
        />
      ))}
    </section>
  )
}

function ListIndex({ lists, sections, tasks, projects, onOpen, onOpenTask }: { lists: TaskList[]; sections: TaskSection[]; tasks: Task[]; projects: ProjectFolder[]; onOpen: (listId: string) => void; onOpenTask: (task: Task) => void }) {
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [taskSearch, setTaskSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const normalizedSearch = taskSearch.trim().toLocaleLowerCase()
  const matchingTasks = tasks
    .filter((task) => normalizedSearch ? showArchived || !task.archived : showArchived && task.archived)
    .filter((task) => !normalizedSearch || task.title.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true }))
  const listById = new Map(lists.map((list) => [list.id, list]))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const sectionById = new Map(sections.map((section) => [section.id, section]))

  async function addList(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    const id = createId()
    await db.lists.add({ id, name: cleanName, color: '#4d82b8', position: Date.now() })
    setName('')
    setCreating(false)
    onOpen(id)
  }

  async function restoreTask(task: Task) {
    await db.tasks.update(task.id, { archived: false, updatedAt: new Date().toISOString() })
  }

  async function deleteTask(task: Task) {
    await db.transaction('rw', db.tasks, db.events, async () => {
      await db.events.where('taskId').equals(task.id).delete()
      await db.tasks.delete(task.id)
    })
  }

  return (
    <section className="list-index">
      <div className="list-titlebar">
        <div><p className="date-label">Task library</p><h2>Lists</h2><span>Browse and organize complete task inventories</span></div>
        <div className="list-index-actions">
          <button type="button" onClick={() => setImporting(true)}><Import size={17} /> Import</button>
          <button type="button" aria-label="New list" onClick={() => setCreating(true)}><Plus size={17} /> New</button>
        </div>
      </div>
      {creating && (
        <form className="inline-create" onSubmit={addList}>
          <Plus size={18} />
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="List name" aria-label="List name" />
          <button type="submit" disabled={!name.trim()}>Create</button>
          <button type="button" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      )}
      <div className="task-search-toolbar">
        <Search size={18} aria-hidden="true" />
        <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks across all lists" aria-label="Search all tasks" />
        <label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
      </div>
      {(normalizedSearch || showArchived) && (
        <section className="task-search-results" aria-label="Task search results">
          <div className="section-label"><span>{matchingTasks.length} {matchingTasks.length === 1 ? 'result' : 'results'}</span></div>
          {matchingTasks.map((task) => {
            const list = listById.get(task.listId)
            const project = task.projectId ? projectById.get(task.projectId) : undefined
            const section = task.sectionId ? sectionById.get(task.sectionId) : undefined
            return (
              <article className={`task-search-result${task.archived ? ' archived' : ''}`} key={task.id}>
                <button className="task-search-copy" type="button" disabled={task.archived} onClick={() => onOpenTask(task)} aria-label={`Open ${task.title}`}>
                  <strong>{task.title}</strong>
                  <span><i style={{ background: list?.color }} /> {list?.name ?? 'Unknown list'}{project ? ` / ${project.name}` : ''}{section ? ` / ${section.name}` : ''}</span>
                </button>
                {task.archived ? (
                  <div className="task-search-actions">
                    <span>Archived</span>
                    <button type="button" onClick={() => restoreTask(task)} title="Restore task" aria-label={`Restore ${task.title}`}><RotateCcw size={17} /></button>
                    <button className="delete" type="button" onClick={() => deleteTask(task)} title="Delete task permanently" aria-label={`Delete ${task.title} permanently`}><Trash2 size={17} /></button>
                  </div>
                ) : <ChevronRight size={18} aria-hidden="true" />}
              </article>
            )
          })}
          {!matchingTasks.length && <div className="task-search-empty">{normalizedSearch ? 'No matching tasks.' : 'No archived tasks.'}</div>}
        </section>
      )}
      <div className="list-grid">
        {[...lists].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })).map((list) => {
          const count = tasks.filter((task) => task.listId === list.id && !task.archived).length
          const projectCount = projects.filter((project) => project.listId === list.id && !project.archived).length
          return (
            <button type="button" key={list.id} onClick={() => onOpen(list.id)}>
              <i style={{ background: list.color }} />
              <span><strong>{list.name}</strong><small>{count} tasks · {projectCount} projects</small></span>
              <ChevronRight size={19} />
            </button>
          )
        })}
      </div>
      {importing && <ImportListDialog onClose={() => setImporting(false)} onImported={(listId) => { setImporting(false); onOpen(listId) }} />}
    </section>
  )
}

interface SheetSectionProps {
  section?: TaskSection
  name: string
  tasks: Task[]
  sectionTasks?: Task[]
  focusedTaskId?: string
  listId: string
  sectionId?: string
  projectId?: string
  activeDay: string
  managedTaskIds: Set<string>
  onManage: (task: Task, action: TaskAction) => Promise<void>
  onEdit: (taskId: string) => void
  onMoveSection?: (section: TaskSection, offset: -1 | 1) => Promise<void>
  canMoveSectionUp?: boolean
  canMoveSectionDown?: boolean
}

function SheetSection({ section, name, tasks, sectionTasks = [], focusedTaskId, listId, sectionId, projectId, activeDay, managedTaskIds, onManage, onEdit, onMoveSection, canMoveSectionUp, canMoveSectionDown }: SheetSectionProps) {
  const [entry, setEntry] = useState('')
  const collapseStorageKey = `2dai:section-collapsed:${listId}:${projectId ?? 'root'}:${sectionId ?? 'todo'}`
  const [collapsed, setCollapsed] = useState(() => readCollapsedState(collapseStorageKey))
  const [renaming, setRenaming] = useState(false)
  const [sectionName, setSectionName] = useState(name)
  const canDelete = sectionTasks.every((task) => task.archived)

  useEffect(() => {
    try {
      if (collapsed) localStorage.setItem(collapseStorageKey, 'true')
      else localStorage.removeItem(collapseStorageKey)
    } catch {
      // The section remains usable when browser storage is unavailable.
    }
  }, [collapseStorageKey, collapsed])

  async function renameSection(event: FormEvent) {
    event.preventDefault()
    const cleanName = sectionName.trim()
    if (!section || !cleanName) return
    await db.sections.update(section.id, { name: cleanName })
    setRenaming(false)
  }

  async function deleteSection() {
    if (!section) return
    await db.transaction('rw', db.sections, db.tasks, db.events, async () => {
      const storedTasks = await db.tasks.where('sectionId').equals(section.id).filter((task) => (
        task.listId === section.listId && task.projectId === section.projectId
      )).toArray()
      if (storedTasks.some((task) => !task.archived)) return
      if (storedTasks.length) {
        await db.events.where('taskId').anyOf(storedTasks.map((task) => task.id)).delete()
        await db.tasks.bulkDelete(storedTasks.map((task) => task.id))
      }
      await db.sections.delete(section.id)
    })
  }

  async function addRow(event: FormEvent) {
    event.preventDefault()
    const parsed = parseTaskInput(entry, activeDay)
    if (!parsed.title) return
    const now = new Date().toISOString()
    await db.transaction('rw', db.lists, db.projects, db.sections, db.tasks, async () => {
      if (!await db.lists.get(listId)) return
      if (projectId && !await db.projects.get(projectId)) return
      if (sectionId && !await db.sections.get(sectionId)) return
      const preferredTime = parsed.preferredTime
      await db.tasks.add({
        id: createId(), listId, sectionId, projectId, title: parsed.title,
        ...isWeekend(activeDay)
          ? { weekendPreferredTime: preferredTime, weekendPreferredTimeSource: preferredTime ? 'explicit' as const : undefined }
          : { weekdayPreferredTime: preferredTime, weekdayPreferredTimeSource: preferredTime ? 'explicit' as const : undefined },
        position: Date.now(), effort: 1,
        intervalDays: parsed.intervalDays, fixedInterval: parsed.fixedInterval,
        nextDueAt: parsed.dueDate ?? activeDay, scheduledForPlanner: parsed.intervalDays ? undefined : Boolean(parsed.dueDate), archived: false,
        createdAt: now, updatedAt: now,
      })
    })
    setEntry('')
  }

  async function moveTask(task: Task, offset: -1 | 1) {
    const index = tasks.findIndex((item) => item.id === task.id)
    const other = tasks[index + offset]
    if (!other) return
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.update(task.id, { position: other.position })
      await db.tasks.update(other.id, { position: task.position })
    })
  }

  async function scheduleTask(task: Task) {
    await db.tasks.update(task.id, {
      nextDueAt: activeDay,
      scheduledForPlanner: true,
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <section className="raw-section">
      <div className="raw-section-heading" onClick={(event) => { if (!(event.target as Element).closest('button, form')) setCollapsed((value) => !value) }}>
        <button className="raw-section-toggle" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}>
          <ChevronRight className={collapsed ? '' : 'open'} size={17} />
        </button>
        {renaming ? (
          <form className="raw-section-rename" onSubmit={renameSection}>
            <input autoFocus value={sectionName} onChange={(event) => setSectionName(event.target.value)} aria-label="Section name" />
            <button type="submit" disabled={!sectionName.trim()}><Check size={16} /><span className="sr-only">Save section name</span></button>
            <button type="button" onClick={() => { setSectionName(name); setRenaming(false) }}><X size={16} /><span className="sr-only">Cancel rename</span></button>
          </form>
        ) : <strong>{name}</strong>}
        <span className="raw-section-count">{tasks.length}</span>
        {section && !renaming && (
          <div className="raw-section-actions">
            <button type="button" disabled={!canMoveSectionUp} onClick={() => onMoveSection?.(section, -1)} title="Move section up" aria-label={`Move ${name} up`}><ArrowUp size={15} /></button>
            <button type="button" disabled={!canMoveSectionDown} onClick={() => onMoveSection?.(section, 1)} title="Move section down" aria-label={`Move ${name} down`}><ArrowDown size={15} /></button>
            <button type="button" onClick={() => { setSectionName(name); setRenaming(true) }} title="Rename section" aria-label={`Rename ${name}`}><Pencil size={15} /></button>
            <button type="button" disabled={!canDelete} onClick={deleteSection} title={canDelete ? 'Delete section and its archived tasks' : 'Archive every task before deleting this section'} aria-label={`Delete ${name}`}><Trash2 size={15} /></button>
          </div>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="raw-table-heading"><span>Done</span><span>Task</span><span>Due</span><span>Repeat</span><span /></div>
          {tasks.map((task, index) => {
            const isManaged = managedTaskIds.has(task.id)
            const isNotDue = task.nextDueAt > activeDay
            const isUnscheduled = !task.intervalDays && task.scheduledForPlanner !== true
            return (
            <div id={`task-${task.id}`} className={`raw-task-row${isManaged ? ' managed' : ''}${isNotDue ? ' not-due' : ''}${focusedTaskId === task.id ? ' focused' : ''}`} key={task.id}>
              {isUnscheduled
                ? <button className="raw-check raw-schedule" type="button" onClick={() => scheduleTask(task)} aria-label={`Add ${task.title} to Today`} title="Add to Today"><Plus size={16} /></button>
                : <button className="raw-check" type="button" onClick={() => onManage(task, 'completed')} aria-pressed={isManaged} aria-label={`${isManaged ? 'Uncheck' : 'Complete'} ${task.title}`}><Check size={16} /></button>}
              <button className="raw-task-name" type="button" onClick={() => onEdit(task.id)}>{task.title}</button>
              <span>{shortDate(task.nextDueAt)}</span>
              <span>{task.intervalDays ? `${task.intervalDays}${task.fixedInterval ? '!' : ''}d` : '—'}</span>
              <div className="raw-row-actions">
                <button type="button" disabled={index === 0} onClick={() => moveTask(task, -1)} aria-label={`Move ${task.title} up`}><ArrowUp size={15} /></button>
                <button type="button" disabled={index === tasks.length - 1} onClick={() => moveTask(task, 1)} aria-label={`Move ${task.title} down`}><ArrowDown size={15} /></button>
                <button type="button" onClick={() => onEdit(task.id)} aria-label={`Options for ${task.title}`}><MoreHorizontal size={17} /></button>
              </div>
            </div>
            )
          })}
          <form className="raw-add-row" onSubmit={addRow}>
            <Plus size={17} />
            <input value={entry} maxLength={TITLE_MAX_LENGTH} onChange={(event) => setEntry(event.target.value)} onBlur={submitOnLeave} placeholder={`Add to ${name}`} aria-label={`Add task to ${name}`} />
            <button type="submit" disabled={!entry.trim()}>Add row</button>
          </form>
        </>
      )}
    </section>
  )
}

function readCollapsedState(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
}