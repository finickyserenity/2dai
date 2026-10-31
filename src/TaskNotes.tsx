import { Fragment, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { parseNotes, type NoteBlock, type NoteInline, type NoteList } from './notesFormat'

// Shown before a task's title wherever its notes are hidden. It is decoration only: screen
// readers, buttons named after the task and the title field all go on without it.
export function NotesMark() {
  return <span className="notes-mark" aria-hidden="true">🗒️</span>
}

// Typing at the end of the notes keeps the line being written in view as it wraps or new lines
// are added. While the keyboard is up, CSS fits the field to the space above it (App.css).
export function NotesEditor({ value, ...props }: ComponentProps<'textarea'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    if (field && document.activeElement === field && field.selectionEnd === field.value.length) field.scrollTop = field.scrollHeight
  }, [value])
  return <textarea ref={ref} value={value} {...props} />
}

export function FormattedNotes({ notes }: { notes: string }) {
  return <div className="formatted-notes">{parseNotes(notes).map(renderBlock)}</div>
}

function renderBlock(block: NoteBlock, index: number): ReactNode {
  if (block.kind === 'rule') return <hr key={index} />
  if (block.kind === 'list') return renderList(block, index)
  return <p key={index}>{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line)}</Fragment>)}</p>
}

function renderList(list: NoteList, index: number): ReactNode {
  const items = list.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item.content)}{item.lists.map(renderList)}</li>)
  return list.ordered ? <ol key={index} start={list.start}>{items}</ol> : <ul key={index}>{items}</ul>
}

function renderInline(parts: NoteInline[]): ReactNode {
  return parts.map((part, index) => {
    if (typeof part === 'string') return <Fragment key={index}>{part}</Fragment>
    const children = renderInline(part.children)
    if (part.mark === 'bold') return <strong key={index}>{children}</strong>
    if (part.mark === 'italic') return <em key={index}>{children}</em>
    return <u key={index}>{children}</u>
  })
}
