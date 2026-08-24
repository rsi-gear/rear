/** Styles are injected by the client plugin so the published bundle is self-contained. */
export const REFINEMENT_STYLES = `
.rear-refinement-root{box-sizing:border-box;height:100%;overflow:auto;padding:20px;color:var(--dsh-color-text,#e8e8ea);background:var(--dsh-color-bg,#111214);font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
.rear-refinement-root *{box-sizing:border-box}
.rear-refinement-header,.rear-refinement-row,.rear-refinement-command{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rear-refinement-header{position:sticky;top:0;z-index:2;padding:8px 0 14px;background:inherit}
.rear-refinement-header h2,.rear-refinement-header h3{margin:0 auto 0 0}
.rear-refinement-list{display:grid;gap:12px}
.rear-refinement-card{padding:12px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent)}
.rear-refinement-row{justify-content:space-between}
.rear-refinement-muted{display:block;color:var(--dsh-color-text-muted,#9a9ca3)}
.rear-refinement-error{padding:8px;border-left:3px solid #dc6464;color:#ee9292}
.rear-refinement-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:10px 0}
.rear-refinement-meta dt{color:var(--dsh-color-text-muted,#9a9ca3)}
.rear-refinement-meta dd{margin:0;overflow-wrap:anywhere}
.rear-refinement-table{width:100%;border-collapse:collapse}
.rear-refinement-table th,.rear-refinement-table td{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.rear-refinement-attempt{display:block;color:var(--dsh-color-text-muted,#9a9ca3);font-size:12px}
.rear-refinement-lanes{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(680px,1fr);gap:12px;overflow-x:auto;align-items:start}
.rear-refinement-lane{min-width:0;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8px;overflow:hidden}
.rear-refinement-lane-header{display:grid;gap:2px;padding:10px;background:color-mix(in srgb,currentColor 6%,transparent);font-size:12px}
.rear-refinement-lane-body{min-height:260px;overflow:auto}
.rear-refinement-raw{max-height:60vh;margin:0;padding:12px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.rear-refinement-command{padding:8px 10px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:8px}
.rear-refinement-command-text{min-width:0;flex:1;color:var(--dsh-color-text-muted,#9a9ca3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-root button,.rear-refinement-command button{padding:5px 9px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:6px;color:inherit;background:color-mix(in srgb,currentColor 6%,transparent);cursor:pointer}
.rear-refinement-root button:disabled{opacity:.45;cursor:default}
`

/** Add one plugin-owned style tag and return its disposer. */
export function mountStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="dsh-plugin-rear"]')
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-rear'
  tag.textContent = REFINEMENT_STYLES
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
