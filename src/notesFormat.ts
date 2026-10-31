// The light markdown notes can use when shown in a list: **bold**, *italic* or _italic_,
// __underline__ (as chat apps have it, since markdown itself has no underline), a line of three or
// more dashes, stars or underscores for a divider, and "- ", "* " or "1. " at the start of a line
// for bullet and numbered lists, nested by indenting. Anything else stays plain text.

export type NoteMark = 'bold' | 'italic' | 'underline'
export type NoteInline = string | { mark: NoteMark; children: NoteInline[] }
export type NoteListItem = { content: NoteInline[]; lists: NoteList[] }
export type NoteList = { kind: 'list'; ordered: boolean; start: number; items: NoteListItem[] }
export type NoteBlock = { kind: 'rule' } | { kind: 'paragraph'; lines: NoteInline[][] } | NoteList

const STAR_OR_UNDERSCORE_RULE = /^\s*([*_])(?:\s*\1){2,}\s*$/
// iOS turns "--" into an em dash as it is typed, so "---" arrives as "—-". A dash line counts each
// em or en dash as the two hyphens it most likely came from.
const DASH_RULE = /^[\s\-—–]+$/
const LIST_ITEM = /^([ \t]*)(?:([-*])|(\d{1,9})\.)[ \t]+(\S.*)$/
// Markers must hug their text ("** not bold **" stays as typed), and a single underscore only
// counts at a word's edge so snake_case names and URLs are left alone.
const INLINE = /\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)|(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/u
const MARKS: NoteMark[] = ['bold', 'underline', 'italic', 'italic']

export function hasNotes(notes?: string): boolean {
  return Boolean(notes?.trim())
}

function isRule(line: string): boolean {
  if (STAR_OR_UNDERSCORE_RULE.test(line)) return true
  if (!DASH_RULE.test(line)) return false
  const dashes = [...line.replace(/\s/g, '')].reduce((total, dash) => total + (dash === '-' ? 1 : 2), 0)
  return dashes >= 3
}

function indentOf(whitespace: string): number {
  return [...whitespace].reduce((total, character) => total + (character === '\t' ? 4 : 1), 0)
}

// Lists open at each indent seen and stay open until a line comes in shallower than them, so
// stepping back out continues the outer list's numbering while stepping in again starts a fresh
// nested one. Numbers count up from the first item's, whatever the rest were typed as.
export function parseNotes(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let lines: NoteInline[][] = []
  let openLists: Array<{ indent: number; list: NoteList; container: NoteList[] | NoteBlock[] }> = []
  const endParagraph = () => {
    if (lines.length) blocks.push({ kind: 'paragraph', lines })
    lines = []
  }

  for (const line of text.split(/\r?\n/)) {
    const item = LIST_ITEM.exec(line)
    if (isRule(line)) {
      endParagraph()
      openLists = []
      blocks.push({ kind: 'rule' })
    } else if (item) {
      endParagraph()
      const indent = indentOf(item[1])
      const ordered = item[3] !== undefined
      const newList = (): NoteList => ({ kind: 'list', ordered, start: ordered ? Number(item[3]) : 1, items: [] })
      while (openLists.length && indent < openLists[openLists.length - 1].indent) openLists.pop()
      const top = openLists[openLists.length - 1]
      if (!top || indent > top.indent) {
        const container = top ? top.list.items[top.list.items.length - 1].lists : blocks
        const list = newList()
        container.push(list)
        openLists.push({ indent, list, container })
      } else if (top.list.ordered !== ordered) {
        // Switching between bullets and numbers at the same depth starts a list beside this one.
        top.list = newList()
        top.container.push(top.list)
      }
      openLists[openLists.length - 1].list.items.push({ content: parseInline(item[4]), lists: [] })
    } else if (!line.trim()) {
      // A blank line ends a paragraph but not a list, so spaced-out items keep counting.
      endParagraph()
    } else {
      openLists = []
      lines.push(parseInline(line))
    }
  }
  endParagraph()
  return blocks
}

export function parseInline(text: string): NoteInline[] {
  const parts: NoteInline[] = []
  let rest = text
  for (let match = INLINE.exec(rest); match; match = INLINE.exec(rest)) {
    if (match.index) parts.push(rest.slice(0, match.index))
    const group = match.slice(1).findIndex((value) => value !== undefined)
    parts.push({ mark: MARKS[group], children: parseInline(match[group + 1]) })
    rest = rest.slice(match.index + match[0].length)
  }
  if (rest) parts.push(rest)
  return parts
}
