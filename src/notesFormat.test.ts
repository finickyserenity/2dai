import { describe, expect, it } from 'vitest'
import { parseInline, parseNotes } from './notesFormat'

describe('parseInline', () => {
  it('marks bold, italic and underline', () => {
    expect(parseInline('a **b** *c* _d_ __e__')).toEqual([
      'a ', { mark: 'bold', children: ['b'] },
      ' ', { mark: 'italic', children: ['c'] },
      ' ', { mark: 'italic', children: ['d'] },
      ' ', { mark: 'underline', children: ['e'] },
    ])
  })

  it('nests one mark inside another', () => {
    expect(parseInline('**call _now_ please**')).toEqual([
      { mark: 'bold', children: ['call ', { mark: 'italic', children: ['now'] }, ' please'] },
    ])
  })

  it('leaves markers that do not hug their text, and underscores inside words, alone', () => {
    expect(parseInline('2 * 3 * 4')).toEqual(['2 * 3 * 4'])
    expect(parseInline('** not bold **')).toEqual(['** not bold **'])
    expect(parseInline('see my_file_name and https://x.io/a_b_c')).toEqual(['see my_file_name and https://x.io/a_b_c'])
    expect(parseInline('unclosed **bold')).toEqual(['unclosed **bold'])
  })
})

describe('parseNotes', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseNotes('one\ntwo\n\nthree')).toEqual([
      { kind: 'paragraph', lines: [['one'], ['two']] },
      { kind: 'paragraph', lines: [['three']] },
    ])
  })

  it('turns a line of three or more dashes, stars or underscores into a divider', () => {
    expect(parseNotes('above\n---\nbelow\n* * *\n___')).toEqual([
      { kind: 'paragraph', lines: [['above']] },
      { kind: 'rule' },
      { kind: 'paragraph', lines: [['below']] },
      { kind: 'rule' },
      { kind: 'rule' },
    ])
    expect(parseNotes('-- not a rule')).toEqual([{ kind: 'paragraph', lines: [['-- not a rule']] }])
  })

  it('takes the em dash iOS makes of "--" as two hyphens', () => {
    expect(parseNotes('—-')).toEqual([{ kind: 'rule' }])
    expect(parseNotes('-—')).toEqual([{ kind: 'rule' }])
    expect(parseNotes('——')).toEqual([{ kind: 'rule' }])
    expect(parseNotes('—')).toEqual([{ kind: 'paragraph', lines: [['—']] }])
  })

  it('collects "- " and "* " lines into a bullet list', () => {
    expect(parseNotes('Pack\n- tent\n* *dry* socks')).toEqual([
      { kind: 'paragraph', lines: [['Pack']] },
      { kind: 'list', ordered: false, start: 1, items: [
        { content: ['tent'], lists: [] },
        { content: [{ mark: 'italic', children: ['dry'] }, ' socks'], lists: [] },
      ] },
    ])
  })

  it('numbers "1. " lines in order from the first number, nesting by indent', () => {
    const [list] = parseNotes('1. a\n1. b\n  1. c\n  1. d\n1. e\n   1. f\n3. g')
    expect(list).toEqual({ kind: 'list', ordered: true, start: 1, items: [
      { content: ['a'], lists: [] },
      { content: ['b'], lists: [{ kind: 'list', ordered: true, start: 1, items: [{ content: ['c'], lists: [] }, { content: ['d'], lists: [] }] }] },
      { content: ['e'], lists: [{ kind: 'list', ordered: true, start: 1, items: [{ content: ['f'], lists: [] }] }] },
      { content: ['g'], lists: [] },
    ] })
    expect(parseNotes('4. x\n1. y')).toEqual([{ kind: 'list', ordered: true, start: 4, items: [{ content: ['x'], lists: [] }, { content: ['y'], lists: [] }] }])
  })

  it('keeps a list going across blank lines, and ends it at plain text or a divider', () => {
    expect(parseNotes('1. a\n\n1. b\nafter\n1. c\n---\n1. d').map((block) => block.kind === 'list' ? block.items.length : block.kind)).toEqual([2, 'paragraph', 1, 'rule', 1])
  })

  it('starts a separate list when bullets and numbers swap at the same depth', () => {
    expect(parseNotes('- a\n1. b').map((block) => block.kind === 'list' && block.ordered)).toEqual([false, true])
  })
})
