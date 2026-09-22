import type { FocusEvent } from 'react'

// iOS keyboards offer a "done" checkmark that only blurs the field, so an entry left in the box
// is added once focus moves anywhere outside its form.
export function submitOnLeave(event: FocusEvent<HTMLInputElement>) {
  const form = event.currentTarget.form
  if (!form || !event.currentTarget.value.trim()) return
  if (event.relatedTarget instanceof Node && form.contains(event.relatedTarget)) return
  form.requestSubmit()
}
