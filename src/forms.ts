import type { FocusEvent, MouseEvent } from 'react'

// iOS keyboards offer a "done" checkmark that only blurs the field, so an entry left in the box
// is added once focus moves anywhere outside its form.
export function submitOnLeave(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget
  const form = input.form
  if (!form || !input.value.trim()) return
  if (event.relatedTarget instanceof Node && form.contains(event.relatedTarget)) return
  // On iOS a tap on the form's own button blurs the field without focusing the button, so the
  // click that submits arrives with no relatedTarget. Give it a moment and add only if it never came.
  let submitted = false
  const noteSubmit = () => { submitted = true }
  form.addEventListener('submit', noteSubmit, { once: true })
  setTimeout(() => {
    form.removeEventListener('submit', noteSubmit)
    if (!submitted && input.isConnected && input.value.trim()) form.requestSubmit()
  }, SUBMIT_ON_LEAVE_DELAY_MS)
}

export const SUBMIT_ON_LEAVE_DELAY_MS = 150

// Keeps focus (and the keyboard) in the entry when its Add button is tapped, so the tap
// submits once through the click rather than through a blur as well.
export function keepEntryFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}
