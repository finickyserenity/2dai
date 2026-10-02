import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

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
  // While the field is open the heading already reads "Alex"; the button only returns once the name is saved.
  await expect(page.getByRole('button', { name: 'Change name Alex' })).toBeVisible()

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

  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(expectedDate)
  await expect(page.getByLabel('Weekday time', { exact: true })).toHaveValue('14:30')
  await page.getByLabel('Due date', { exact: true }).fill(`${candidate.getFullYear()}-12-12`)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Options for E2E dated task' }).click()
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(`${candidate.getFullYear()}-12-12`)
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

  await page.getByText('Offline task', { exact: true }).dblclick()
  await page.getByRole('button', { name: 'Options for Offline task' }).click()
  await page.getByLabel('Title').fill('Offline task edited')
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
  await filterToday(page, 'Show skipped')
  await expect(page.getByRole('button', { name: 'Undo delay for Delayed then done task' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Complete Delayed then done task' }).click()
  await expect(page.getByRole('button', { name: 'Undo delay for Delayed then done task' })).toHaveCount(0)
  await filterToday(page, 'Show done')
  await expect(page.getByRole('button', { name: 'Uncheck Delayed then done task' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Uncheck Delayed then done task' }).click()
  await filterToday(page, 'Show due')
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
  await filterToday(page, 'Show done')
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

  const content = page.locator('.view-scroll')
  await content.evaluate((element) => element.scrollTo(0, 120))
  const before = await content.evaluate((element) => element.scrollTop)
  expect(before).toBeGreaterThan(0)

  const rowEdges = () => page.locator('.task-row').first().evaluate((row) => { const box = row.getBoundingClientRect(); return [box.left, box.right] })
  const edgesBefore = await rowEdges()
  await page.getByRole('button', { name: 'Options for Scroll lock one' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await rowEdges()).toEqual(edgesBefore)
  const opened = await content.evaluate((element) => element.scrollTop)

  // Wheel over both the dimmed backdrop and the panel itself.
  await page.mouse.move(450, 20)
  await page.mouse.wheel(0, 300)
  await page.mouse.move(450, 300)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(200)
  expect(await content.evaluate((element) => element.scrollTop)).toBe(opened)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await content.evaluate((element) => element.scrollTop)).toBe(opened)
})

test('keeps the view tabs and list breadcrumbs on screen while the content beneath them scrolls', async ({ page }) => {
  // About the room left on a phone once the keyboard is up.
  await page.setViewportSize({ width: 390, height: 420 })
  const tabs = page.getByLabel('Planning range')
  const top = (locator: ReturnType<Page['locator']>) => locator.evaluate((element) => element.getBoundingClientRect().top)

  const tabsTop = await top(tabs)
  await page.locator('.view-scroll').evaluate((element) => element.scrollTo(0, element.scrollHeight))
  expect(await page.locator('.view-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await top(tabs)).toBe(tabsTop)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await tabs.getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  const breadcrumbs = page.locator('.list-breadcrumbs')
  const breadcrumbsTop = await top(breadcrumbs)
  await page.locator('.view-scroll').evaluate((element) => element.scrollTo(0, element.scrollHeight))
  expect(await page.locator('.view-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await top(breadcrumbs)).toBe(breadcrumbsTop)
  await expect(breadcrumbs.getByRole('button', { name: 'Lists' })).toBeInViewport()
  await expect(tabs).toBeInViewport()
})

test('opens a planner task\'s options on tap and shows it in its list on double tap', async ({ page }) => {
  // Collapse the section first so the double tap has to open it.
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await page.getByRole('button', { name: 'Collapse Todo' }).click()
  await expect(page.locator('#task-tidy-living-space')).toHaveCount(0)
  await page.getByLabel('Planning range').getByRole('button', { name: 'Today' }).click()

  const row = page.locator('.task-copy', { hasText: 'Tidy up' })
  await row.click()
  const dialog = page.getByRole('dialog', { name: 'Task options' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Title')).toHaveValue('Tidy up')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)

  await row.dblclick()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.list-breadcrumbs')).toContainText('Household')
  const listed = page.locator('#task-tidy-living-space')
  await expect(listed).toHaveClass(/focused/)
  await expect(listed).toBeInViewport()
  expect(await listed.evaluate((element) => getComputedStyle(element).animationName)).toBe('task-glow')

  // From the options sheet, View list goes back to the same row and replays the glow.
  await page.getByRole('button', { name: 'Options for Tidy up' }).click()
  await dialog.getByLabel('Title').fill('Tidy up the den')
  await dialog.getByRole('button', { name: 'View list' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#task-tidy-living-space')).toHaveClass(/focused/)
  await expect(page.getByRole('button', { name: 'Tidy up the den', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Options for Tidy up the den' }).click()
  await dialog.getByRole('button', { name: 'Archive task' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#task-tidy-living-space')).toHaveCount(0)
})

test('filters Today to due, done or skipped tasks, or hides daily and recurring ones, with effort to match', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  for (const title of ['Filter once', 'Filter weekly 7d']) {
    await entry.fill(title)
    await entry.press('Enter')
    await expect(entry).toHaveValue('')
  }
  const titles = page.locator('.task-list .task-title')
  const effort = page.locator('.effort-meter strong')
  // Seeded: "Check today's schedule" (daily, effort 1) and "Tidy up" (daily, effort 2).
  await expect(titles).toHaveCount(4)
  await expect(effort).toHaveText('5')

  await filterToday(page, 'Hide daily')
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Hiding daily')
  await expect(titles).toHaveText(['Filter once', 'Filter weekly'])
  await expect(effort).toHaveText('2')
  await filterToday(page, 'Hide recurring')
  await expect(titles).toHaveText(['Filter once'])
  await expect(effort).toHaveText('1')

  await filterToday(page, 'Show due')
  await page.getByRole('button', { name: 'Complete Filter once' }).click()
  await expect(page.getByRole('button', { name: 'Complete Filter once' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Delay Tidy up' }).click()

  await filterToday(page, 'Show done')
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Showing done')
  await expect(titles).toHaveText(['Filter once'])
  await expect(effort).toHaveText('1')
  await filterToday(page, 'Show skipped')
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Showing skipped')
  await expect(titles).toHaveText(['Tidy up'])
  await expect(effort).toHaveText('2')
  await filterToday(page, 'Show due')
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Showing due')
  await expect(effort).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Reset to show due' })).toHaveCount(0)

  // The x beside a filter returns to Show due.
  await filterToday(page, 'Show done')
  await page.getByRole('button', { name: 'Reset to show due' }).click()
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Showing due')
  await expect(page.getByRole('button', { name: 'Reset to show due' })).toHaveCount(0)

  // The menu marks the current filter, works from the keyboard and closes on an outside press.
  const trigger = page.locator('.section-label .filter-menu-trigger')
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Today filter' })
  await expect(menu.getByRole('menuitemradio', { name: 'Show due' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitemradio', { name: 'Show due' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('.section-label .filter-menu-label')).toHaveText('Showing skipped')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await trigger.click()
  await page.locator('.day-heading h2').click()
  await expect(menu).toHaveCount(0)
})

// Picks a planner filter (Today, Week or Month, whichever is showing).
async function filterToday(page: Page, option: string) {
  await page.locator('.section-label .filter-menu-trigger').click()
  await page.getByRole('menu').getByRole('menuitemradio', { name: option }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

async function filterTaskSearch(page: Page, option: string) {
  await page.locator('.task-search-toolbar .filter-menu-trigger').click()
  await page.getByRole('menu', { name: 'Task search filter' }).getByRole('menuitemradio', { name: option }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

test('filters Week and Month on their own, without the daily option', async ({ page }) => {
  const now = new Date()
  const inThreeDays = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 12)
  const entry = page.getByRole('textbox', { name: 'New task' })
  for (const title of ['Weekly chore 7d', `Next week thing ${inThreeDays.getMonth() + 1}/${inThreeDays.getDate()}`]) {
    await entry.fill(title)
    await entry.press('Enter')
    await expect(entry).toHaveValue('')
  }
  await page.getByRole('button', { name: 'Complete Weekly chore' }).click()
  await expect(page.getByRole('button', { name: 'Complete Weekly chore' })).toHaveCount(0)
  await filterToday(page, 'Show done')

  await page.getByLabel('Planning range').getByRole('button', { name: 'Week' }).click()
  const label = page.locator('.section-label .filter-menu-label')
  const titles = page.locator('.task-list .task-title')
  await expect(label).toHaveText('Showing due')
  await expect(page.getByRole('button', { name: 'Reset to show due' })).toHaveCount(0)
  await expect(titles.filter({ hasText: 'Next week thing' })).toHaveCount(1)
  await expect(titles.filter({ hasText: 'Weekly chore' })).toHaveCount(0)

  await page.locator('.section-label .filter-menu-trigger').click()
  await expect(page.getByRole('menu', { name: 'Week filter' }).getByRole('menuitemradio')).toHaveText(['Show due', 'Show done', 'Show skipped', 'Hide recurring'])
  await page.keyboard.press('Escape')

  await filterToday(page, 'Show done')
  await expect(titles).toHaveText(['Weekly chore'])
  await expect(page.locator('.effort-meter strong')).toHaveText('1')
  await filterToday(page, 'Hide recurring')
  await expect(titles).toHaveText(['Next week thing'])
  await page.getByRole('button', { name: 'Reset to show due' }).click()
  await expect(label).toHaveText('Showing due')

  await page.getByLabel('Planning range').getByRole('button', { name: 'Month' }).click()
  await expect(label).toHaveText('Showing due')
  await page.getByLabel('Planning range').getByRole('button', { name: 'Today' }).click()
  await expect(label).toHaveText('Showing done')
})

async function storedTask(page: Page, title: string) {
  return page.evaluate(async (taskTitle) => {
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
    return tasks.find((item) => item.title === taskTitle)
  }, title)
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test('offers longer delays and skipping from a long press on the delay button', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  for (const title of ['Long press week', 'Long press skip', 'Quick delay']) {
    await entry.fill(`${title} 2d`)
    await entry.press('Enter')
    await expect(page.getByRole('button', { name: `Delay ${title}` })).toBeVisible()
  }

  const today = new Date()
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  const nextMonday = new Date(noon)
  nextMonday.setDate(noon.getDate() + (((8 - noon.getDay()) % 7) || 7))

  const weekButton = page.getByRole('button', { name: 'Delay Long press week' })
  await weekButton.hover()
  await page.mouse.down()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByRole('dialog').getByRole('button')).toHaveText([/Cancel/, /Delay one day/, /Until the weekend/, /Until next week/, /Until next month/, /Skip this occurrence/])
  await expect(page.getByRole('button', { name: 'Undo delay for Long press week' })).toHaveCount(0)
  await page.getByRole('button', { name: /Until next week/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await filterToday(page, 'Show skipped')
  await expect(page.getByRole('button', { name: 'Undo delay for Long press week' })).toBeVisible()
  expect((await storedTask(page, 'Long press week'))?.nextDueAt).toBe(localDateKey(nextMonday))
  await filterToday(page, 'Show due')

  await page.getByRole('button', { name: 'Delay Long press skip' }).click({ button: 'right' })
  await page.getByRole('button', { name: /Skip this occurrence/ }).click()
  await filterToday(page, 'Show skipped')
  await expect(page.getByRole('button', { name: 'Undo skip for Long press skip' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo skip for Long press skip' }).click()
  await filterToday(page, 'Show due')
  await expect(page.getByRole('button', { name: 'Delay Long press skip' })).toBeVisible()

  await page.getByRole('button', { name: 'Delay Quick delay' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await filterToday(page, 'Show skipped')
  await expect(page.getByRole('button', { name: 'Undo delay for Quick delay' })).toBeVisible()
  const tomorrow = new Date(noon)
  tomorrow.setDate(noon.getDate() + 1)
  expect((await storedTask(page, 'Quick delay'))?.nextDueAt).toBe(localDateKey(tomorrow))
})

test('tracks effort from the play button until the task is checked off', async ({ page }) => {
  await page.clock.install({ time: new Date() })
  await page.reload()
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Tracked task 2d')
  await entry.press('Enter')

  await page.getByRole('button', { name: 'Track effort for Tracked task' }).click()
  await expect(page.getByRole('button', { name: 'Effort 1 for Tracked task, tracking' })).toBeVisible()
  await page.clock.fastForward('11:00')
  await expect(page.getByRole('button', { name: 'Effort 3 for Tracked task, tracking' })).toBeVisible()

  // This page is too short to scroll, so opening a sheet must not make room for a scrollbar.
  const rowEdges = () => page.locator('.task-row').first().evaluate((row) => { const box = row.getBoundingClientRect(); return [box.left, box.right] })
  const edgesBefore = await rowEdges()
  await page.getByRole('button', { name: 'Effort 3 for Tracked task, tracking' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  expect(await rowEdges()).toEqual(edgesBefore)
  await expect(panel.getByRole('heading', { name: 'Tracked task' })).toBeVisible()
  await expect(panel.getByLabel('Time spent')).toHaveText('11:00')
  await expect(panel.getByLabel('Effort so far')).toHaveText('3')
  await panel.getByRole('button', { name: 'Pause' }).click()
  await expect(panel.getByText('Paused')).toBeVisible()
  await page.clock.fastForward('30:00')
  await expect(panel.getByLabel('Time spent')).toHaveText('11:00')
  await panel.getByRole('button', { name: 'Resume' }).click()
  await panel.getByRole('button', { name: 'Continue' }).click()
  await expect(panel).toHaveCount(0)
  await page.clock.fastForward('05:00')
  await expect(page.getByRole('button', { name: 'Effort 4 for Tracked task, tracking' })).toBeVisible()

  await page.getByRole('button', { name: 'Complete Tracked task' }).click()
  await page.clock.runFor(1_000) // let the completion animation finish and commit
  await filterToday(page, 'Show done')
  await expect(page.getByRole('button', { name: 'Uncheck Tracked task' })).toBeVisible()
  let task = await storedTask(page, 'Tracked task')
  expect(task?.effort).toBe(4)
  expect(task?.trackingStartedAt).toBeUndefined()
  expect(task?.trackedMs).toBeUndefined()

  await page.getByRole('button', { name: 'Uncheck Tracked task' }).click()
  await filterToday(page, 'Show due')
  await expect(page.getByRole('button', { name: 'Effort 4 for Tracked task, paused' })).toBeVisible()
  task = await storedTask(page, 'Tracked task')
  expect(task?.effort).toBe(1)

  await page.getByRole('button', { name: 'Effort 4 for Tracked task, paused' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Track effort for Tracked task' })).toBeVisible()
})

test('leaves no pressed look on the next row after delaying a task on touch devices', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch hover regression')

  const entry = page.getByRole('textbox', { name: 'New task' })
  for (const title of ['First touch delay', 'Second touch delay']) {
    await entry.fill(title)
    await entry.press('Enter')
    await expect(page.getByRole('button', { name: `Delay ${title}` })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Delay First touch delay' }).tap()
  await expect(page.getByRole('button', { name: 'Delay First touch delay' })).toHaveCount(0)

  // Touch emulation cannot reproduce the sticky hover, so also require that every row-action
  // hover style sits behind a media query that touch devices do not match.
  const ungatedHoverRules = await page.evaluate(() => [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .map((rule) => rule.selectorText)
    .filter((selector) => selector.includes(':hover') && /\.task-actions|\.complete-button|\.effort-badge/.test(selector)))
  expect(ungatedHoverRules).toEqual([])
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false)
  await expect(page.getByRole('button', { name: 'Delay Second touch delay' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.getByRole('button', { name: 'Track effort for Second touch delay' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('keeps the next checkbox inactive after completing a task on touch devices', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch hover regression')
  // Midday keeps the default "dark at night" theme light, so the white checkbox is the expected one.
  const now = new Date()
  await page.clock.install({ time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12) })
  await page.reload()

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
  await page.getByLabel('Due date', { exact: true }).fill('2026-09-17')
  await filters.fill('monday, q4')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Options for Filtered due task' }).click()
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('2026-10-05')
  await expect(page.getByLabel('Due filters')).toHaveValue('monday, q4')
})

test('edits the title in a growing field and keeps notes on their own tab', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Notes task')
  await entry.press('Enter')
  await page.getByText('Notes task', { exact: true }).dblclick()
  await page.getByRole('button', { name: 'Options for Notes task' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('Due filters')).toBeVisible()

  const title = dialog.getByLabel('Title')
  const singleLine = await title.evaluate((field) => field.getBoundingClientRect().height)
  await title.fill('A much longer task title that certainly has to wrap onto a second line to fit inside the sheet')
  expect(await title.evaluate((field) => field.getBoundingClientRect().height)).toBeGreaterThan(singleLine)
  expect(await title.evaluate((field) => field.scrollHeight <= field.clientHeight)).toBe(true)

  const sheetHeight = () => dialog.evaluate((sheet) => sheet.getBoundingClientRect().height)
  const detailsHeight = await sheetHeight()
  await dialog.getByRole('tab', { name: 'Notes' }).click()
  await expect(dialog.getByLabel('Due filters')).toBeHidden()
  expect(await sheetHeight()).toBe(detailsHeight)
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Line one\nLine two')
  await title.press('Enter')
  await expect(dialog).toHaveCount(0)
  expect(await storedTask(page, 'A much longer task title that certainly has to wrap onto a second line to fit inside the sheet')).toMatchObject({ notes: 'Line one\nLine two' })

  // Dismissing the sheet without pressing Done still keeps the notes.
  await page.getByRole('button', { name: /^Options for A much longer/ }).click()
  await dialog.getByRole('tab', { name: 'Notes' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Notes' })).toHaveValue('Line one\nLine two')
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Line one only')
  await page.mouse.click(5, 5)
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => storedTask(page, 'A much longer task title that certainly has to wrap onto a second line to fit inside the sheet').then((task) => task?.notes)).toBe('Line one only')
})

test('switches to the dark theme overnight on an adjustable schedule', async ({ page }) => {
  const now = new Date()
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  await page.clock.install({ time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0) })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'User' })).toBeVisible()
  await expect.poll(theme).toBe('dark')
  expect(await page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe('dark')
  expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))).not.toBe('#1e5784')

  // 8:30 the next morning flips back without a reload.
  await page.clock.fastForward('09:31:00')
  await expect.poll(theme).toBe('light')
  await page.clock.fastForward('14:00:00')
  await expect.poll(theme).toBe('dark')

  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByLabel('Dark from')).toHaveValue('22:30')
  await expect(page.getByLabel('Light from')).toHaveValue('08:30')
  // It is 10:31pm now, so pushing the start past that turns the lights back on.
  await page.getByLabel('Dark from').fill('23:00')
  await expect.poll(theme).toBe('light')
  await page.getByLabel('Theme').selectOption('Always dark')
  await expect.poll(theme).toBe('dark')
  await expect(page.getByLabel('Dark from')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'User' })).toBeVisible()
  await expect.poll(theme).toBe('dark')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByLabel('Theme').selectOption('Dark at night')
  await expect(page.getByLabel('Dark from')).toHaveValue('23:00')
  await expect.poll(theme).toBe('light')
})

test('adds a pending entry when focus leaves the quick-add box', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Blur added task')
  // Moving to the list picker keeps the entry pending; leaving the form adds it.
  await page.getByRole('combobox', { name: 'Task list' }).focus()
  await expect(page.getByText('Blur added task', { exact: true })).toHaveCount(0)
  await entry.focus()
  await page.locator('.section-label .filter-menu-trigger').focus()
  await expect(page.getByText('Blur added task', { exact: true })).toBeVisible()
  await expect(entry).toHaveValue('')
  expect(await entry.getAttribute('maxlength')).toBe('300')
})

test('adds an entry once when its Add button is tapped without taking focus, as on iOS', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  const entry = page.getByRole('textbox', { name: 'Add task to Todo' })
  await entry.fill('Tapped once')
  // iOS blurs the field without focusing the button, then delivers the click that submits.
  await entry.evaluate((input: HTMLInputElement) => { input.blur(); input.form!.requestSubmit() })
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: 'Tapped once', exact: true })).toHaveCount(1)

  // The checkmark alone (a blur with no click to follow) still adds the entry.
  await entry.fill('Checkmark only')
  await entry.evaluate((input: HTMLInputElement) => input.blur())
  await expect(page.getByRole('button', { name: 'Checkmark only', exact: true })).toHaveCount(1)
  await expect(entry).toHaveValue('')

  // A mouse click on Add row leaves focus in the entry for the next task.
  await entry.fill('Clicked add')
  await page.getByRole('button', { name: 'Add row' }).click()
  await expect(page.getByRole('button', { name: 'Clicked add', exact: true })).toHaveCount(1)
  await expect(entry).toBeFocused()
})

test('orders the week chronologically by day and time, with project rollups on their first due day', async ({ page }) => {
  const now = new Date()
  const inDays = (days: number) => { const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12); return `${date.getMonth() + 1}/${date.getDate()}` }
  const entry = page.getByRole('textbox', { name: 'New task' })
  // Added out of order, so list position alone would get it wrong.
  for (const title of [`Order fourth ${inDays(4)}`, `Order second ${inDays(2)} 5p`, `Order first ${inDays(2)} 9a`]) {
    await entry.fill(title)
    await entry.press('Enter')
    await expect(entry).toHaveValue('')
  }

  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByRole('textbox', { name: 'Project folder name' }).fill('Order third project')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.list-breadcrumbs')).toContainText('Order third project')
  await page.getByRole('textbox', { name: 'Add task to Todo' }).fill(`Project step ${inDays(3)}`)
  await page.getByRole('textbox', { name: 'Add task to Todo' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Project step', exact: true })).toBeVisible()

  await page.getByLabel('Planning range').getByRole('button', { name: 'Week' }).click()
  await expect(page.locator('.task-list .task-title', { hasText: /^Order / })).toHaveText(['Order first', 'Order second', 'Order third project', 'Order fourth'])
})

test('offers to add a filtered-for task that is not in the list or project yet', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  const filter = page.getByRole('textbox', { name: 'Filter this list' })

  await filter.fill('laundry')
  await expect(page.getByRole('button', { name: 'Do laundry', exact: true })).toBeVisible()
  await expect(page.locator('.filter-empty')).toHaveCount(0)

  await filter.fill('Clean the gutters')
  await expect(page.locator('.filter-empty')).toContainText('No tasks in Household match.')
  await page.getByRole('button', { name: 'Add “Clean the gutters” to Todo' }).click()
  await expect(filter).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Clean the gutters', exact: true })).toBeVisible()
  await expect.poll(() => storedTask(page, 'Clean the gutters').then((task) => [task?.listId, task?.projectId, task?.sectionId])).toEqual(['household', undefined, undefined])

  // Inside a project, the task lands in that project's Todo rather than the list's.
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByRole('textbox', { name: 'Project folder name' }).fill('Garage')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.list-breadcrumbs')).toContainText('Garage')
  await filter.fill('Sweep the floor')
  await expect(page.locator('.filter-empty')).toContainText('No tasks in Garage match.')
  await page.getByRole('button', { name: 'Add “Sweep the floor” to Todo' }).click()
  await expect(page.getByRole('button', { name: 'Sweep the floor', exact: true })).toBeVisible()
  await expect.poll(() => storedTask(page, 'Sweep the floor').then((task) => task?.projectId)).toBeTruthy()
})

test('pins a task to the next named weekday from its subject', async ({ page }) => {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - now.getDay() + 7) % 7 || 7), 12)
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Weekday pinned task next friday')
  await entry.press('Enter')
  await expect.poll(() => storedTask(page, 'Weekday pinned task').then((task) => task?.nextDueAt)).toBe(localDateKey(target))
})

test('clears time, last-completed and due date fields from the options sheet', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await page.getByRole('button', { name: "Options for Check today's schedule" }).click()

  const dialog = page.getByRole('dialog')
  const timeField = dialog.getByLabel(/^Week(day|end) time$/)
  await expect(timeField).toHaveValue('08:00')
  await dialog.getByRole('button', { name: /Clear week(day|end) time/ }).click()
  await expect(timeField).toHaveValue('')
  await expect(dialog.getByRole('button', { name: /Clear week(day|end) time/ })).toHaveCount(0)

  await expect(dialog.getByRole('button', { name: 'Clear last completed' })).toHaveCount(0)
  await dialog.getByLabel('Last completed', { exact: true }).fill('2026-09-01')
  await dialog.getByRole('button', { name: 'Clear last completed' }).click()
  await expect(dialog.getByLabel('Last completed', { exact: true })).toHaveValue('')
  expect(await dialog.getByLabel('Title').getAttribute('maxlength')).toBe('300')
  await dialog.getByRole('tab', { name: 'Notes' }).click()
  expect(await dialog.getByRole('textbox', { name: 'Notes' }).getAttribute('maxlength')).toBe('10000')
  await dialog.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: "Options for Check today's schedule" }).click()
  await expect(page.getByRole('dialog').getByLabel(/^Week(day|end) time$/)).toHaveValue('')

  // Clearing the due date takes the task out of the planner and drops its repeat.
  await expect(dialog.getByLabel('Repeat every')).toHaveValue('1')
  await dialog.getByRole('button', { name: 'Clear due date' }).click()
  await expect(dialog.getByLabel('Due date', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('Repeat every')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: "Add Check today's schedule to Today" })).toBeVisible()
  await page.getByLabel('Planning range').getByRole('button', { name: 'Today' }).click()
  await expect(page.getByText("Check today's schedule", { exact: true })).toHaveCount(0)
})

test('keeps effort and its hours and minutes in step as either is edited', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Personal\b/ }).click()
  await page.getByRole('button', { name: "Options for Check today's schedule" }).click()

  const dialog = page.getByRole('dialog')
  const effort = dialog.getByLabel('Effort', { exact: true })
  const hours = dialog.getByLabel('Hours', { exact: true })
  const minutes = dialog.getByLabel('Minutes', { exact: true })
  await expect(effort).toHaveValue('1')
  await expect(hours).toHaveValue('')
  await expect(minutes).toHaveValue('5')

  // Editing the duration updates effort as you type, without rounding what was typed.
  await hours.fill('1')
  await expect(effort).toHaveValue('13')
  await minutes.fill('21')
  await expect(effort).toHaveValue('17')
  await expect(minutes).toHaveValue('21')
  await expect.poll(async () => (await storedTask(page, "Check today's schedule"))?.effort).toBe(17)

  // Editing effort directly rewrites the duration.
  await effort.fill('30')
  await expect(hours).toHaveValue('2')
  await expect(minutes).toHaveValue('30')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect.poll(async () => (await storedTask(page, "Check today's schedule"))?.effort).toBe(30)
})

test('strikes through and slides a completed task away, and a second tap cancels it', async ({ page }) => {
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Animated task')
  await entry.press('Enter')
  const row = page.locator('.task-row', { hasText: 'Animated task' })
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: 'Complete Animated task' }).click()
  await expect(row).toHaveClass(/leaving/)
  await expect(page.getByRole('button', { name: 'Uncheck Animated task' })).toHaveAttribute('aria-pressed', 'true')
  expect(await row.evaluate((element) => getComputedStyle(element).animationName)).toBe('row-leave')

  // Tapping again before it goes cancels the completion.
  await page.getByRole('button', { name: 'Uncheck Animated task' }).click()
  await expect(row).not.toHaveClass(/leaving/)
  await page.waitForTimeout(1_100)
  await expect(row).toBeVisible()
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('2dai-local')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const request = database.transaction('events', 'readonly').objectStore('events').count()
    return new Promise<number>((resolve) => { request.onsuccess = () => resolve(request.result) })
  })).toBe(0)

  await page.getByRole('button', { name: 'Complete Animated task' }).click()
  // The slide must not widen the page, or a horizontal scrollbar shifts the layout.
  const overflowed = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const samples: number[] = []
    const start = performance.now()
    const sample = () => {
      samples.push(document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (performance.now() - start < 800) requestAnimationFrame(sample)
      else resolve(samples)
    }
    requestAnimationFrame(sample)
  }))
  expect(Math.max(...overflowed)).toBe(0)
  await expect(row).toHaveCount(0)
  await filterToday(page, 'Show done')
  await expect(page.getByRole('button', { name: 'Uncheck Animated task' })).toHaveAttribute('aria-pressed', 'true')
})

test('never flashes a completed row back before the empty state appears', async ({ page }) => {
  for (const title of ["Check today's schedule", 'Tidy up']) {
    await page.getByRole('button', { name: `Complete ${title}` }).click()
    await expect(page.locator('.task-row', { hasText: title })).toHaveCount(0)
  }
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Last task standing')
  await entry.press('Enter')
  const row = page.locator('.task-row', { hasText: 'Last task standing' })
  await expect(row).toBeVisible()

  // Record every class change on the row: once it starts leaving it must stay that way until removed.
  await row.evaluate((element) => {
    const log: string[] = []
    new MutationObserver(() => log.push(element.className)).observe(element, { attributes: true, attributeFilter: ['class'] })
    ;(window as unknown as { rowClasses: string[] }).rowClasses = log
  })
  await page.getByRole('button', { name: 'Complete Last task standing' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByText('Nothing waiting here')).toBeVisible()
  const classes = await page.evaluate(() => (window as unknown as { rowClasses: string[] }).rowClasses)
  expect(classes[0]).toContain('leaving')
  expect(classes.filter((value) => !value.includes('leaving'))).toEqual([])
})

test('offers copy, open-link and call actions from a long press on a task', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const entry = page.getByRole('textbox', { name: 'New task' })
  await entry.fill('Call the plumber (555) 123-4567')
  await entry.press('Enter')
  await page.getByText('Call the plumber (555) 123-4567', { exact: true }).dblclick()
  await page.getByRole('button', { name: 'Options for Call the plumber (555) 123-4567' }).click()
  await page.getByRole('dialog').getByRole('tab', { name: 'Notes' }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Notes' }).fill('Quote at https://example.com/quote/42. Backup +1 555 987 6543')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Hold the task name in the list view.
  const name = page.getByRole('button', { name: 'Call the plumber (555) 123-4567', exact: true })
  const box = await name.boundingBox()
  await page.mouse.move(box!.x + 20, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Call the plumber (555) 123-4567' })).toBeVisible()
  await expect(dialog.getByRole('link', { name: /Open link example.com\/quote\/42/ })).toHaveAttribute('href', 'https://example.com/quote/42')
  await expect(dialog.getByRole('link', { name: /Call \(555\) 123-4567/ })).toHaveAttribute('href', 'tel:5551234567')
  await expect(dialog.getByRole('link', { name: /Call \+1 555 987 6543/ })).toHaveAttribute('href', 'tel:+15559876543')

  await dialog.getByRole('button', { name: 'Copy text and notes' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Call the plumber (555) 123-4567\n\nQuote at https://example.com/quote/42. Backup +1 555 987 6543')

  // A plain tap still opens the task options, and a right-click also opens the menu.
  await name.click()
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Details' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await name.click({ button: 'right' })
  await page.getByRole('dialog').getByRole('button', { name: 'Copy text', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Call the plumber (555) 123-4567')

  // The planner rows offer the same menu.
  await page.getByLabel('Planning range').getByRole('button', { name: 'Today' }).click()
  await page.getByText('Call the plumber (555) 123-4567', { exact: true }).click({ button: 'right' })
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copy text and notes' })).toBeVisible()
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

  const persistentName = page.locator('.raw-section-heading > strong', { hasText: 'Persistent section' })
  await persistentName.click()
  await expect(page.getByRole('button', { name: 'Collapse Persistent section' })).toBeVisible()
  await page.getByRole('button', { name: 'Rename Persistent section' }).click()
  await page.getByRole('textbox', { name: 'Section name' }).click()
  await page.getByRole('button', { name: 'Cancel rename' }).click()
  await expect(page.getByRole('button', { name: 'Collapse Persistent section' })).toBeVisible()
  await persistentName.click()
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
  await filterTaskSearch(page, 'Show archived')
  await expect(page.getByRole('button', { name: 'Restore Archived search target' })).toBeVisible()
  await filterTaskSearch(page, 'Show all')
  await search.fill('Archived search target')
  await expect(page.getByText('No matching tasks.')).toBeVisible()
  await filterTaskSearch(page, 'Show archived')
  await expect(page.getByText('Archived search target')).toBeVisible()
  await page.getByRole('button', { name: 'Restore Archived search target' }).click()
  await filterTaskSearch(page, 'Show all')
  await expect(page.getByRole('button', { name: 'Open Archived search target' })).toBeEnabled()

  await page.getByRole('button', { name: 'Open Archived search target' }).click()
  await page.getByRole('button', { name: 'Options for Archived search target' }).click()
  await page.getByRole('button', { name: 'Archive task' }).click()
  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'Search all tasks' }).fill('Archived search target')
  await filterTaskSearch(page, 'Show archived')
  await page.getByRole('button', { name: 'Delete Archived search target permanently' }).click()
  await expect(page.getByText('Archived search target')).not.toBeVisible()
})

test('filters the task search by due, unscheduled, done and archived, and clears it from the x', async ({ page }) => {
  await page.getByRole('button', { name: 'Complete Tidy up' }).click()
  await expect(page.getByRole('button', { name: 'Complete Tidy up' })).toHaveCount(0)
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  await page.getByRole('textbox', { name: 'Add task to Todo' }).fill('Someday idea')
  await page.getByRole('textbox', { name: 'Add task to Todo' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Someday idea', exact: true })).toBeVisible()
  await page.locator('.list-breadcrumbs').getByRole('button', { name: 'Lists' }).click()

  const results = page.getByRole('region', { name: 'Task search results' })
  const clear = page.getByRole('button', { name: 'Clear search' })
  await expect(results).toHaveCount(0)
  await expect(clear).toHaveCount(0)

  await filterTaskSearch(page, 'Show unscheduled')
  await expect(page.locator('.task-search-toolbar .filter-menu-label')).toHaveText('Showing unscheduled')
  await expect(results.getByRole('button', { name: 'Open Someday idea' })).toBeVisible()
  await expect(results.getByRole('button', { name: 'Open Do laundry' })).toHaveCount(0)

  await filterTaskSearch(page, 'Show done')
  await expect(results.getByRole('button', { name: 'Open Tidy up' })).toBeVisible()
  await expect(results.getByRole('button', { name: 'Open Someday idea' })).toHaveCount(0)

  await filterTaskSearch(page, 'Show due')
  await expect(results.getByRole('button', { name: 'Open Do laundry' })).toBeVisible()
  await expect(results.getByRole('button', { name: 'Open Tidy up' })).toHaveCount(0)
  await expect(results.getByRole('button', { name: 'Open Someday idea' })).toHaveCount(0)
  const search = page.getByRole('textbox', { name: 'Search all tasks' })
  await search.fill('laundry')
  await expect(results.locator('.task-search-result')).toHaveCount(1)

  // The x sits after the filter and clears both the text and the filter.
  await clear.click()
  await expect(search).toHaveValue('')
  await expect(page.locator('.task-search-toolbar .filter-menu-label')).toHaveText('Showing all')
  await expect(results).toHaveCount(0)
  await expect(clear).toHaveCount(0)
  await search.fill('laundry')
  await expect(clear).toBeVisible()
})

test('renames a list and a project from their headings', async ({ page }) => {
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await page.locator('.list-grid').getByRole('button', { name: /^Household\b/ }).click()
  const listName = page.getByRole('textbox', { name: 'List name' })
  await expect(listName).toHaveValue('Household')

  // Escape and an empty name both leave the name alone.
  await listName.click()
  await listName.fill('Discarded')
  await listName.press('Escape')
  await expect(listName).toHaveValue('Household')
  await listName.fill('   ')
  await listName.blur()
  await expect(listName).toHaveValue('Household')

  await listName.fill('Home  chores')
  await listName.press('Enter')
  await expect(listName).not.toBeFocused()
  await expect(listName).toHaveValue('Home chores')
  await expect(page.locator('.list-breadcrumbs')).toContainText('Home chores')

  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByRole('textbox', { name: 'Project folder name' }).fill('Garage')
  await page.getByRole('button', { name: 'Create' }).click()
  const projectName = page.getByRole('textbox', { name: 'Project name' })
  await expect(projectName).toHaveValue('Garage')
  // Leaving the field saves too.
  await projectName.fill('Garage cleanout')
  await page.locator('.list-titlebar .date-label').click()
  await expect(page.locator('.list-breadcrumbs')).toContainText('Garage cleanout')

  await page.reload()
  await page.getByLabel('Planning range').getByRole('button', { name: 'Lists' }).click()
  await expect(page.locator('.list-grid strong')).toHaveText(['Errands', 'Home chores', 'Personal'])
  await page.locator('.list-grid').getByRole('button', { name: /^Home chores\b/ }).click()
  await expect(page.locator('.project-strip')).toContainText('Garage cleanout')
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