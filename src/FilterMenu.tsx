import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, X, type LucideIcon } from 'lucide-react'

export interface FilterOption<T extends string> {
  value: T
  // "Show done" in the menu, "Showing done" on the button once chosen.
  option: string
  label: string
  icon: LucideIcon
  // Options are divided wherever the group changes.
  group?: string
}

interface FilterMenuProps<T extends string> {
  label: string
  options: Array<FilterOption<T>>
  value: T
  onChange: (value: T) => void
  // An x button that undoes the filtering, shown only when there is something to undo.
  reset?: { label: string; side: 'start' | 'end'; onReset: () => void }
}

// Picks one filter from a short list. A small menu rather than the native picker, so each option
// is a large target with an icon.
export function FilterMenu<T extends string>({ label, options, value, onChange, reset }: FilterMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const current = options.find((option) => option.value === value) ?? options[0]
  const CurrentIcon = current.icon

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
    function closeOnOutsidePress(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function choose(next: T) {
    onChange(next)
    close()
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const target = event.key === 'ArrowDown' ? items[(index + 1) % items.length]
      : event.key === 'ArrowUp' ? items[(index - 1 + items.length) % items.length]
      : event.key === 'Home' ? items[0]
      : event.key === 'End' ? items[items.length - 1]
      : undefined
    if (target) {
      event.preventDefault()
      target.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const resetButton = reset && (
    <button className="filter-menu-reset" type="button" onClick={reset.onReset} aria-label={reset.label} title={reset.label}><X size={14} /></button>
  )

  return (
    <div className="filter-menu" ref={rootRef}>
      {reset?.side === 'start' && resetButton}
      <button ref={triggerRef} className="filter-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((isOpen) => !isOpen)}>
        <CurrentIcon size={15} aria-hidden="true" />
        <span className="filter-menu-label">{current.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {reset?.side === 'end' && resetButton}
      {open && (
        <div id={menuId} className="filter-menu-popup" role="menu" aria-label={label} onKeyDown={moveFocus}>
          {options.map(({ value: optionValue, option, icon: Icon, group }, index) => (
            <Fragment key={optionValue}>
              {index > 0 && group !== options[index - 1].group && <div className="filter-menu-separator" role="separator" />}
              <button type="button" role="menuitemradio" aria-checked={optionValue === value} tabIndex={-1} onClick={() => choose(optionValue)}>
                <Icon size={18} aria-hidden="true" />
                <span>{option}</span>
                {optionValue === value && <Check size={16} aria-hidden="true" />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
