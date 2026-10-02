import { useLayoutEffect, useRef, type ComponentProps } from 'react'

// A single-row textarea that grows with its content instead of scrolling.
export function GrowingTextarea({ value, ...props }: ComponentProps<'textarea'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} rows={1} value={value} {...props} />
}
