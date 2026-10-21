import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { RefinementKey } from './locales.ts'

/** Both surfaces remain mounted while the pane is collapsed or the evidence tab changes. */
export function TraceWorkbench({ children, panel, t }: {
  children: ReactNode; panel: (close: () => void) => ReactNode; t: (key: RefinementKey) => string
}) {
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 })
  const stacked = dimensions.width < 720
  const [wideSize, setWideSize] = useState(40)
  const [stackedSize, setStackedSize] = useState(55)
  const extent = Math.max(1, stacked ? dimensions.height : dimensions.width)
  const minimum = Math.max(30, (stacked ? 230 : 320) / extent * 100)
  const maximum = Math.max(minimum, Math.min(65, 100 - ((stacked ? 180 : 320) + 7) / extent * 100))
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value))
  const size = clamp(stacked ? stackedSize : wideSize)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const updateSize = (value: number) => (stacked ? setStackedSize : setWideSize)(clamp(value))
  return <div ref={root} className="rear-workbench-layout" data-analysis-open={open} data-stacked={stacked}
    style={{ '--rear-chat-size': `${size}%` } as CSSProperties}>
    <section className="rear-evidence-pane" aria-label={t('workbench.tabs')}>
      <button ref={toggle} type="button" className="rear-analysis-toggle" aria-controls="rear-analysis-pane" aria-expanded={open}
        onClick={() => setOpen(value => !value)} title={open ? t('analysis.close') : t('analysis.open')}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12 4v12"/></svg>
        {t('analysis.title')}
      </button>
      {children}
    </section>
    <div className="rear-workbench-resize" hidden={!open} role="separator" tabIndex={0} aria-label={t('analysis.resize')}
      aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={size}
      onDoubleClick={() => updateSize(stacked ? 55 : 40)}
      onKeyDown={event => {
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? -2 : 0
        if (delta || event.key === 'Home' || event.key === 'End') { event.preventDefault(); updateSize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : size + delta) }
      }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return
        const rect = root.current.getBoundingClientRect()
        updateSize(stacked ? (rect.bottom - event.clientY) / rect.height * 100 : (rect.right - event.clientX) / rect.width * 100)
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />
    <aside id="rear-analysis-pane" className="rear-analysis-pane" hidden={!open}>{panel(() => { setOpen(false); toggle.current?.focus() })}</aside>
  </div>
}
