import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'User' })).toBeVisible()
})

test('starts new users with neutral lists and routine tasks', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await expect(page.locator('.list-grid strong')).toHaveText(['Errands', 'Household', 'Personal'])

  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await expect(page.getByRole('button', { name: "Check today's schedule", exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check upcoming bills', exact: true })).toBeVisible()

  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await expect(page.getByRole('button', { name: 'Tidy up', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Do laundry', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take out the trash', exact: true })).toBeVisible()

  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Errands\b/ }).click()
  await expect(page.getByRole('button', { name: 'Pick up groceries', exact: true })).toBeVisible()
})

test('customizes and persists the header name', async ({ page }) => {
  await page.getByRole('button', { name: 'Change name User' }).click()
  const name = page.getByRole('textbox', { name: 'Header name' })
  await name.fill('Alex')
  await name.press('Enter')
  await expect(page.getByRole('heading', { name: 'Alex' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Alex' })).toBeVisible()

  await page.getByRole('button', { name: 'Change name Alex' }).click()
  await page.getByRole('textbox', { name: 'Header name' }).fill('Discarded')
  await page.getByRole('textbox', { name: 'Header name' }).press('Escape')
  await expect(page.getByRole('heading', { name: 'Alex' })).toBeVisible()
})

test('renders Start New Day when an open page crosses midnight', async ({ page }) => {
  // beforeEach already stored the real today as the active day, so stay on that date.
  const now = new Date()
  await page.clock.install({ time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59) })
  await page.reload()
  await expect(page.getByRole('button', { name: /Start new day/ })).not.toBeVisible()

  await page.clock.runFor(2_000)
  await expect(page.getByRole('button', { name: /Start new day/ })).toBeVisible()
})

test('creates a future-dated task from its subject and edits it with the date picker', async ({ page }) => {
  const now = new Date()
  const month = 4
  const day = 20
  const candidate = new Date(now.getFullYear(), month - 1, day, 12)
  if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) candidate.setFullYear(candidate.getFullYear() + 1)
  const expectedDate = `${candidate.getFullYear()}-04-20`

  const entry = page.getByRole('textbox', { name: 'New task' })
  await expect(page.getByRole('option', { name: 'Personal', exact: true })).toBeAttached()
  await entry.fill('E2E dated task 4/20 2:30p')
  await entry.press('Enter')

  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await expect(page.getByRole('button', { name: 'E2E dated task', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Options for E2E dated task' }).click()

  await expect(page.getByLabel('Due date')).toHaveValue(expectedDate)
  await expect(page.getByLabel('Weekday time')).toHaveValue('14:30')
  await page.getByLabel('Due date').fill(`${candidate.getFullYear()}-12-12`)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Options for E2E dated task' }).click()
  await expect(page.getByLabel('Due date')).toHaveValue(`${candidate.getFullYear()}-12-12`)
})

test('adds, edits, and completes tasks offline without randomUUID', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined })
  })
  await page.reload()
  await page.context().setOffline(true)

  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Offline task')
  await entry.press('Enter')
  await expect(page.getByText('Offline task', { exact: true })).toBeVisible()

  await page.getByText('Offline task', { exact: true }).click()
  await page.getByRole('button', { name: 'Options for Offline task' }).click()
  await page.getByLabel('Subject').fill('Offline task edited')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Offline task edited', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Complete Offline task edited' }).click()
  await expect(page.getByRole('button', { name: 'Uncheck Offline task edited' })).toHaveAttribute('aria-pressed', 'true')

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('2dai-local')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const transaction = database.transaction(['tasks', 'events'], 'readonly')
    const tasksRequest = transaction.objectStore('tasks').getAll()
    const eventsRequest = transaction.objectStore('events').getAll()
    const [tasks, events] = await Promise.all([
      new Promise<Array<{ id: string; title: string; archived: boolean }>>((resolve, reject) => {
        tasksRequest.onerror = () => reject(tasksRequest.error)
        tasksRequest.onsuccess = () => resolve(tasksRequest.result)
      }),
      new Promise<Array<{ taskId: string; action: string }>>((resolve, reject) => {
        eventsRequest.onerror = () => reject(eventsRequest.error)
        eventsRequest.onsuccess = () => resolve(eventsRequest.result)
      }),
    ])
    const task = tasks.find((item) => item.title === 'Offline task edited')
    return { task, completed: events.some((event) => event.taskId === task?.id && event.action === 'completed') }
  })
  expect(stored.task).toMatchObject({ title: 'Offline task edited', archived: true })
  expect(stored.completed).toBe(true)
})

test('completes a delayed task from its checkbox', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Delayed then done task')
  await entry.press('Enter')

  await page.getByRole('button', { name: 'Delay Delayed then done task' }).click()
  await page.getByLabel('Show managed').check()
  await expect(page.getByRole('button', { name: 'Undo delay for Delayed then done task' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Complete Delayed then done task' }).click()
  await expect(page.getByRole('button', { name: 'Uncheck Delayed then done task' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Undo delay for Delayed then done task' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Uncheck Delayed then done task' }).click()
  await expect(page.getByRole('button', { name: 'Complete Delayed then done task' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Delay Delayed then done task' })).toBeVisible()
})

test('leaves completion times untouched when catching up on a previous day', async ({ page }) => {
  await page.clock.install({ time: Date.now() + 86_400_000 })
  await page.reload()
  await expect(page.getByRole('button', { name: /Start new day/ })).toBeVisible()

  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Forgotten task every 3 days')
  await entry.press('Enter')
  await page.getByRole('button', { name: /^Complete Forgotten task/ }).click()
  await page.getByLabel('Show managed').check()
  await expect(page.getByRole('button', { name: /^Uncheck Forgotten task/ })).toHaveAttribute('aria-pressed', 'true')

  const task = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('2dai-local')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const request = database.transaction('tasks', 'readonly').objectStore('tasks').getAll()
    const tasks = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    return tasks.find((item) => String(item.title).startsWith('Forgotten task'))
  })
  expect(task).toBeDefined()
  expect(task?.lastCompletedAt).toBeUndefined()
  expect(task?.weekdayPreferredTime).toBeUndefined()
  expect(task?.weekendPreferredTime).toBeUndefined()
})

test('keeps the task list in place while the task options panel is open', async ({ page }) => {
  // Wide enough that the planner rows keep their options button, short enough to scroll.
  await page.setViewportSize({ width: 900, height: 420 })
  const entry = page.getByRole('textbox', { name: 'New task' })
  for (const title of ['Scroll lock one', 'Scroll lock two', 'Scroll lock three', 'Scroll lock four']) {
    await entry.fill(title)
    await entry.press('Enter')
    await expect(page.getByRole('button', { name: `Complete ${title}` })).toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, 120))
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Options for Scroll lock one' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const opened = await page.evaluate(() => window.scrollY)

  // Wheel over both the dimmed backdrop and the panel itself.
  await page.mouse.move(450, 20)
  await page.mouse.wheel(0, 300)
  await page.mouse.move(450, 300)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden')

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden')
  expect(await page.evaluate(() => window.scrollY)).toBe(opened)
})

test('keeps the next checkbox inactive after completing a task on touch devices', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch hover regression')

  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('First touch task')
  await entry.press('Enter')
  await expect(page.getByRole('button', { name: 'Complete First touch task' })).toBeVisible()
  await entry.fill('Second touch task')
  await entry.press('Enter')
  await expect(page.getByRole('button', { name: 'Complete Second touch task' })).toBeVisible()

  await page.getByRole('button', { name: 'Complete First touch task' }).tap()

  const nextCheckbox = page.getByRole('button', { name: 'Complete Second touch task' })
  await expect(nextCheckbox).toHaveAttribute('aria-pressed', 'false')
  await expect(nextCheckbox).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('constrains a task due date with multiple calendar filters', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Filtered due task')
  await entry.press('Enter')

  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await page.getByRole('button', { name: 'Options for Filtered due task' }).click()

  const filters = page.getByLabel('Due filters')
  await expect(filters).toHaveAttribute('rows', '2')
  await page.getByLabel('Due date').fill('2026-09-17')
  await filters.fill('monday, q4')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Options for Filtered due task' }).click()
  await expect(page.getByLabel('Due date')).toHaveValue('2026-10-05')
  await expect(page.getByLabel('Due filters')).toHaveValue('monday, q4')
})

test('sorts lists and section options while persisting section display preferences', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  const names = await page.locator('.list-grid strong').allTextContents()
  const sortedNames = [...names].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }))
  expect(names).toEqual(sortedNames)

  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await page.getByRole('button', { name: 'New section' }).click()
  await page.getByRole('textbox', { name: 'Section name' }).fill('Persistent section')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'Collapse Persistent section' }).click()
  await expect(page.getByRole('button', { name: 'Expand Persistent section' })).toBeVisible()

  await page.getByRole('button', { name: 'New section' }).click()
  await page.getByRole('textbox', { name: 'Section name' }).fill('Alpha 10')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'New section' }).click()
  await page.getByRole('textbox', { name: 'Section name' }).fill('Alpha 2')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'Move Alpha 2 up' }).click()

  const sectionNames = page.locator('.raw-section-heading > strong')
  await expect(sectionNames).toHaveText(['Todo', 'Persistent section', 'Alpha 2', 'Alpha 10'])

  const todoEntry = page.getByRole('textbox', { name: 'Add task to Todo' })
  await todoEntry.fill('Section option test')
  await todoEntry.press('Enter')
  await page.getByRole('button', { name: 'Options for Section option test' }).click()
  await expect(page.getByLabel('Section', { exact: true }).locator('option')).toHaveText(['Todo', 'Alpha 2', 'Alpha 10', 'Persistent section'])
  await page.getByRole('button', { name: 'Done' }).click()

  await page.reload()
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await expect(page.getByRole('button', { name: 'Expand Persistent section' })).toBeVisible()
  await expect(page.locator('.raw-section-heading > strong')).toHaveText(['Todo', 'Persistent section', 'Alpha 2', 'Alpha 10'])
})

test('searches every list and manages archived task results', async ({ page }) => {
  await page.getByRole('textbox', { name: 'New task' }).fill('Archived search target')
  await page.getByRole('textbox', { name: 'New task' }).press('Enter')

  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'Search all tasks' }).fill('laundry')
  const activeResult = page.getByRole('region', { name: 'Task search results' })
  await expect(activeResult.getByRole('button', { name: 'Open Do laundry' })).toContainText('Household')
  await activeResult.getByRole('button', { name: 'Open Do laundry' }).click()
  await expect(page.locator('#task-laundry')).toHaveClass(/focused/)

  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await page.getByRole('button', { name: 'Options for Archived search target' }).click()
  await page.getByRole('button', { name: 'Archive task' }).click()
  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()

  const search = page.getByRole('textbox', { name: 'Search all tasks' })
  await page.getByRole('checkbox', { name: 'Show archived' }).check()
  await expect(page.getByRole('button', { name: 'Restore Archived search target' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show archived' }).uncheck()
  await search.fill('Archived search target')
  await expect(page.getByText('No matching tasks.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show archived' }).check()
  await expect(page.getByText('Archived search target')).toBeVisible()
  await page.getByRole('button', { name: 'Restore Archived search target' }).click()
  await expect(page.getByRole('button', { name: 'Open Archived search target' })).toBeEnabled()

  await page.getByRole('button', { name: 'Open Archived search target' }).click()
  await page.getByRole('button', { name: 'Options for Archived search target' }).click()
  await page.getByRole('button', { name: 'Archive task' }).click()
  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'Search all tasks' }).fill('Archived search target')
  await page.getByRole('checkbox', { name: 'Show archived' }).check()
  await page.getByRole('button', { name: 'Delete Archived search target permanently' }).click()
  await expect(page.getByText('Archived search target')).not.toBeVisible()
})

test('exports every local data store as a JSON backup', async ({ page }) => {
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export data/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^2dai-backup-\d{4}-\d{2}-\d{2}\.json$/)

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const backup = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
    format: string
    version: number
    data: Record<string, unknown[]>
  }
  expect(backup).toMatchObject({ format: '2dai-backup', version: 1 })
  expect(Object.keys(backup.data).sort()).toEqual(['events', 'lists', 'projects', 'sections', 'settings', 'tasks'])
  expect(backup.data.lists.length).toBeGreaterThan(0)
  expect(backup.data.tasks.length).toBeGreaterThan(0)
})

test('refreshes the app from Settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Open menu' }).click()
  const loaded = page.waitForEvent('load')
  await page.getByRole('button', { name: /Refresh app/ }).click()
  await loaded
  await expect(page.getByRole('heading', { name: 'User' })).toBeVisible()
})