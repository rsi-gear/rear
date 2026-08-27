/** Styles are injected by the client plugin so the published bundle is self-contained. */
export const REFINEMENT_STYLES = `
.rear-refinement-root{--rear-bg:var(--dsh-color-bg,#0b0d0e);--rear-panel:#111416;--rear-panel-2:#15191b;--rear-line:rgba(255,255,255,.1);--rear-text:var(--dsh-color-text,#f1f3f2);--rear-muted:var(--dsh-color-text-muted,#8f9895);--rear-accent:#c9ff5a;--rear-green:#67d391;--rear-red:#ff746c;box-sizing:border-box;height:100%;overflow:auto;padding:0 28px 48px;color:var(--rear-text);background:var(--rear-bg);font:13px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.rear-refinement-root *{box-sizing:border-box}
.rear-refinement-root h1,.rear-refinement-root h2,.rear-refinement-root h3,.rear-refinement-root p{margin-top:0}
.rear-refinement-root h2{font-size:20px;line-height:1.2;letter-spacing:-.02em}
.rear-refinement-root h3{font-size:15px}
.rear-refinement-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rear-refinement-row{justify-content:flex-start}
.rear-refinement-muted{display:block;color:var(--rear-muted)}
.rear-refinement-error{margin:14px 0;padding:10px 12px;border:1px solid rgba(255,116,108,.24);border-left:3px solid var(--rear-red);border-radius:6px;color:#ffaaa5;background:rgba(255,116,108,.06)}
.rear-refinement-topbar{height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--rear-line)}
.rear-refinement-brand{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:-.01em}
.rear-refinement-brand-mark{display:inline-grid;width:27px;height:27px;place-items:center;border-radius:7px;color:#111;background:var(--rear-accent);font-weight:850;font-size:12px;box-shadow:0 0 24px rgba(201,255,90,.12)}
.rear-refinement-status{display:inline-flex;align-items:center;gap:7px;color:var(--rear-muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.rear-refinement-status>span{width:7px;height:7px;border-radius:50%;background:#77807d}
.rear-refinement-status[data-status="running"]>span,.rear-refinement-status[data-status="queued"]>span{background:var(--rear-accent);box-shadow:0 0 0 4px rgba(201,255,90,.08)}
.rear-refinement-status[data-status="completed"]>span{background:var(--rear-green)}
.rear-refinement-status[data-status="failed"]>span,.rear-refinement-status[data-status="cancelled"]>span{background:var(--rear-red)}
.rear-refinement-hero{min-height:440px;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:56px;align-items:center;padding:56px 4vw;border-bottom:1px solid var(--rear-line);background:radial-gradient(circle at 85% 42%,rgba(201,255,90,.055),transparent 29%)}
.rear-refinement-hero-copy{max-width:760px}
.rear-refinement-kicker{display:block;margin-bottom:10px;color:var(--rear-muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.15em}
.rear-refinement-hero-title{max-width:820px;margin-bottom:8px;font-size:clamp(32px,4.5vw,60px);line-height:1;letter-spacing:-.055em;overflow-wrap:anywhere}
.rear-refinement-hero-combo{display:grid;gap:9px;margin:38px 0 28px}
.rear-refinement-score-label,.rear-refinement-fact-label{display:block;color:var(--rear-muted);font-size:10px;text-transform:uppercase;letter-spacing:.12em}
.rear-refinement-combo-primary{font-size:20px;letter-spacing:-.025em}
.rear-refinement-combo-join{color:var(--rear-muted);font-size:15px}
.rear-refinement-pill{display:inline-flex;align-items:center;width:max-content;max-width:100%;padding:3px 7px;border:1px solid var(--rear-line);border-radius:999px;color:var(--rear-muted);font-size:10px;line-height:1.35;text-transform:uppercase;letter-spacing:.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-pill[data-tone="warning"]{border-color:rgba(255,190,92,.28);color:#ffc878;background:rgba(255,190,92,.07)}
.rear-refinement-pill[data-tone="best"]{border-color:rgba(201,255,90,.28);color:var(--rear-accent);background:rgba(201,255,90,.07)}
.rear-refinement-facts{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;margin:20px 0}
.rear-refinement-fact{display:grid;gap:2px;align-content:center;min-height:38px;padding:0 20px;border-left:1px solid var(--rear-line)}
.rear-refinement-fact:first-child{padding-left:0;border-left:0}
.rear-refinement-hero-score{display:grid;justify-items:end;align-content:center;min-height:240px;padding:34px;border:1px solid var(--rear-line);border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));box-shadow:0 30px 80px rgba(0,0,0,.22)}
.rear-refinement-score-value{font-size:clamp(64px,9vw,116px);line-height:1;font-weight:500;letter-spacing:-.085em;font-variant-numeric:tabular-nums;color:var(--rear-accent)}
.rear-refinement-action{margin-top:8px!important;padding:10px 15px!important;border-color:var(--rear-accent)!important;color:#10120e!important;background:var(--rear-accent)!important;font-weight:700}
.rear-refinement-secondary{margin-top:8px!important;padding:10px 15px!important}
.rear-refinement-section{padding:36px 0 10px}
.rear-refinement-section-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:18px}
.rear-refinement-section-header h2,.rear-refinement-section-header h3{margin:0}
.rear-refinement-history{display:grid;border-top:1px solid var(--rear-line)}
.rear-refinement-history-item{display:grid!important;grid-template-columns:minmax(0,1fr) auto 20px;align-items:center;gap:18px;width:100%;padding:16px 4px!important;border:0!important;border-bottom:1px solid var(--rear-line)!important;border-radius:0!important;text-align:left;background:transparent!important}
.rear-refinement-history-item:hover,.rear-refinement-history-item[data-selected="true"]{padding-left:12px!important;background:rgba(255,255,255,.025)!important}
.rear-refinement-history-item[data-selected="true"]{box-shadow:inset 2px 0 var(--rear-accent)}
.rear-refinement-history-main{display:grid;gap:3px;min-width:0}
.rear-refinement-history-main>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-history-meta{color:var(--rear-muted);font-size:11px}
.rear-refinement-header{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:16px;min-height:84px;padding:14px 0;border-bottom:1px solid var(--rear-line);background:color-mix(in srgb,var(--rear-bg) 92%,transparent);backdrop-filter:blur(16px)}
.rear-refinement-back{display:grid!important;width:34px;height:34px;flex:0 0 auto;place-items:center;padding:0!important;border-radius:50%!important;font-size:16px}
.rear-refinement-breadcrumb,.rear-refinement-comparison-head{display:grid;gap:2px;min-width:0;margin-right:auto}
.rear-refinement-breadcrumb{flex:1 1 280px}
.rear-refinement-breadcrumb>.rear-refinement-muted{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-breadcrumb .rear-refinement-kicker,.rear-refinement-comparison-head .rear-refinement-kicker{margin:0}
.rear-refinement-breadcrumb h2,.rear-refinement-comparison-head h2{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-segment{display:inline-flex;flex:0 0 auto;padding:3px;border:1px solid var(--rear-line);border-radius:8px;background:rgba(255,255,255,.025)}
.rear-refinement-segment button{border:0!important;background:transparent!important}
.rear-refinement-segment button:disabled{opacity:1!important;color:var(--rear-text);background:rgba(255,255,255,.08)!important}
.rear-refinement-iteration-nav{display:flex;gap:8px;padding:18px 0 4px;overflow:auto}
.rear-refinement-iteration-nav button{display:grid!important;gap:2px;min-width:118px;padding:9px 11px!important;text-align:left}
.rear-refinement-iteration-nav button>span{color:var(--rear-muted);font-size:10px;text-transform:uppercase}
.rear-refinement-iteration-nav button[data-selected="true"]{border-color:rgba(201,255,90,.45)!important;background:rgba(201,255,90,.07)!important}
.rear-refinement-directions{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.rear-refinement-direction{position:relative;display:grid;gap:22px;min-height:245px;padding:18px;border:1px solid var(--rear-line);border-radius:12px;background:var(--rear-panel);overflow:hidden}
.rear-refinement-direction:before{content:"";position:absolute;inset:0 auto 0 0;width:2px;background:#59615e}
.rear-refinement-direction[data-role="baseline"]:before{background:#8b9390}
.rear-refinement-direction:has(.rear-refinement-pill[data-tone="best"]){border-color:rgba(201,255,90,.28);background:linear-gradient(150deg,rgba(201,255,90,.055),var(--rear-panel) 45%)}
.rear-refinement-direction:has(.rear-refinement-pill[data-tone="best"]):before{background:var(--rear-accent)}
.rear-refinement-direction-top{display:flex;align-items:center;justify-content:space-between}
.rear-refinement-direction h3{margin-bottom:3px;font-size:17px}
.rear-refinement-direction p{margin:0}
.rear-refinement-direction-score{font-size:38px;line-height:1;font-weight:500;letter-spacing:-.055em;font-variant-numeric:tabular-nums}
.rear-refinement-direction-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:14px;border-top:1px solid var(--rear-line)}
.rear-refinement-direction-meta>span{display:grid;gap:3px;color:var(--rear-muted);font-size:10px}
.rear-refinement-direction-meta strong{color:var(--rear-text);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-exclusions{margin:20px 0 0;padding:12px 14px;border:1px solid rgba(255,190,92,.2);border-radius:8px;color:#d7b16f;background:rgba(255,190,92,.04)}
.rear-refinement-exclusions summary{cursor:pointer}
.rear-refinement-portfolio{display:grid;gap:14px}
.rear-refinement-portfolio-stats{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));border:1px solid var(--rear-line);border-radius:10px;background:var(--rear-panel);overflow:hidden}
.rear-refinement-portfolio-stat{display:grid;align-content:center;gap:2px;min-height:86px;padding:13px 16px;border-left:1px solid var(--rear-line);color:var(--rear-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.rear-refinement-portfolio-stat:first-child{border-left:0}
.rear-refinement-portfolio-stat strong{color:var(--rear-text);font-size:23px;font-weight:550;line-height:1.2;letter-spacing:-.035em;text-transform:none;font-variant-numeric:tabular-nums}
.rear-refinement-portfolio-stat small{overflow:hidden;color:var(--rear-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap;text-transform:none;letter-spacing:0}
.rear-refinement-portfolio-stat[data-tone="warning"]{box-shadow:inset 0 2px var(--rear-red)}
.rear-refinement-portfolio-stat[data-tone="warning"] strong{color:var(--rear-red)}
.rear-refinement-portfolio-stat[data-tone="positive"]{box-shadow:inset 0 2px var(--rear-green)}
.rear-refinement-portfolio-layout{display:grid;grid-template-columns:minmax(560px,1fr) minmax(290px,.38fr);gap:12px;align-items:stretch}
.rear-refinement-matrix{min-width:860px}
.rear-refinement-matrix th[data-selected="true"]{box-shadow:inset 0 -2px var(--rear-accent);color:var(--rear-text)}
.rear-refinement-matrix th button{max-width:170px;padding:0!important;border:0!important;color:inherit;background:transparent!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:inherit}
.rear-refinement-matrix-cell{position:relative;min-width:125px;background:rgba(255,255,255,.012)}
.rear-refinement-matrix-cell[data-status="improved"]{background:rgba(103,211,145,.07)}
.rear-refinement-matrix-cell[data-status="regressed"]{background:rgba(255,116,108,.07)}
.rear-refinement-matrix-cell[data-status="missing"]{background:repeating-linear-gradient(135deg,transparent,transparent 7px,rgba(255,255,255,.018) 7px,rgba(255,255,255,.018) 14px)}
.rear-refinement-matrix-cell[data-guardrail="true"]{box-shadow:inset 0 0 0 1px rgba(255,116,108,.52)}
.rear-refinement-matrix-cell[data-guardrail="true"]:after{position:absolute;top:5px;right:7px;color:var(--rear-red);content:"!";font-size:10px;font-weight:800}
.rear-refinement-matrix-value,.rear-refinement-matrix-delta{display:block;font-variant-numeric:tabular-nums}
.rear-refinement-matrix-value{font-size:15px;font-weight:550}
.rear-refinement-matrix-delta{margin-top:3px;color:var(--rear-muted);font-size:10px}
.rear-refinement-matrix-cell[data-status="improved"] .rear-refinement-matrix-delta{color:var(--rear-green)}
.rear-refinement-matrix-cell[data-status="regressed"] .rear-refinement-matrix-delta{color:var(--rear-red)}
.rear-refinement-tradeoff{display:grid;grid-template-rows:auto minmax(200px,1fr) auto;gap:8px;min-height:330px;padding:15px;border:1px solid var(--rear-line);border-radius:10px;background:var(--rear-panel)}
.rear-refinement-tradeoff h3{margin:2px 0 0;font-size:16px}
.rear-refinement-tradeoff-plot{width:100%;height:100%;min-height:220px;overflow:visible}
.rear-refinement-tradeoff-plot line{stroke:var(--rear-line);stroke-width:1}
.rear-refinement-tradeoff-plot text{fill:var(--rear-muted);font:9px ui-sans-serif,-apple-system,sans-serif}
.rear-refinement-tradeoff-plot g text{fill:var(--rear-text);font-size:9px}
.rear-refinement-tradeoff-plot circle{fill:#78817e;stroke:var(--rear-panel);stroke-width:2}
.rear-refinement-tradeoff-plot g[data-pareto="true"] circle{fill:var(--rear-accent);stroke:rgba(201,255,90,.35);stroke-width:5}
.rear-refinement-tradeoff-legend{display:flex;align-items:center;gap:7px;color:var(--rear-muted);font-size:9px}
.rear-refinement-tradeoff-legend>span{width:8px;height:8px;border-radius:50%;background:var(--rear-accent);box-shadow:0 0 0 3px rgba(201,255,90,.18)}
.rear-refinement-benchmark-tabs{display:flex;gap:6px;padding:16px 0 0;overflow:auto}
.rear-refinement-benchmark-tabs button{display:grid!important;gap:1px;min-width:150px;padding:8px 11px!important;text-align:left}
.rear-refinement-benchmark-tabs button strong{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-benchmark-tabs button span{color:var(--rear-muted);font-size:9px}
.rear-refinement-benchmark-tabs button[data-selected="true"]{border-color:rgba(201,255,90,.4)!important;color:var(--rear-accent);background:rgba(201,255,90,.065)!important}
.rear-refinement-summary-strip{display:flex;align-items:stretch;margin-bottom:14px;border:1px solid var(--rear-line);border-radius:10px;background:var(--rear-panel)}
.rear-refinement-summary-item{display:grid;gap:1px;min-width:120px;padding:12px 16px;border-left:1px solid var(--rear-line);color:var(--rear-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.rear-refinement-summary-item:first-child{border-left:0}
.rear-refinement-summary-item strong{color:var(--rear-text);font-size:18px;font-weight:550;letter-spacing:-.03em}
.rear-refinement-filters{display:flex;gap:5px;flex-wrap:wrap}
.rear-refinement-filter{padding:5px 9px!important;border-radius:999px!important;font-size:11px}
.rear-refinement-filter[data-selected="true"]{border-color:rgba(201,255,90,.38)!important;color:var(--rear-accent);background:rgba(201,255,90,.07)!important}
.rear-refinement-table-wrap{width:100%;overflow:auto;border:1px solid var(--rear-line);border-radius:10px;background:var(--rear-panel)}
.rear-refinement-table{width:100%;min-width:760px;border-collapse:collapse;font-variant-numeric:tabular-nums}
.rear-refinement-table th,.rear-refinement-table td{padding:13px 14px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--rear-line)}
.rear-refinement-table th{position:sticky;top:0;z-index:1;color:var(--rear-muted);background:var(--rear-panel-2);font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.rear-refinement-table th>span{display:block;margin-top:2px;font-size:9px;font-weight:400;text-transform:none}
.rear-refinement-table tbody tr:last-child td{border-bottom:0}
.rear-refinement-table tbody tr:hover{background:rgba(255,255,255,.02)}
.rear-refinement-table tbody tr{box-shadow:inset 2px 0 transparent}
.rear-refinement-table tbody tr[data-status="regressed"]{box-shadow:inset 2px 0 var(--rear-red)}
.rear-refinement-table tbody tr[data-status="improved"]{box-shadow:inset 2px 0 var(--rear-green)}
.rear-refinement-task-identity{min-width:210px}
.rear-refinement-task-identity>strong{display:block;max-width:280px;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-task-score strong{font-size:15px;font-weight:550}
.rear-refinement-task-runs{display:block;color:var(--rear-muted);font-size:10px}
.rear-refinement-task-delta{font-weight:650}
.rear-refinement-task-delta[data-sign="positive"]{color:var(--rear-green)}
.rear-refinement-task-delta[data-sign="negative"]{color:var(--rear-red)}
.rear-refinement-task-action{white-space:nowrap}
.rear-refinement-empty{display:grid;min-height:240px;place-content:center;justify-items:center;gap:8px;padding:28px;text-align:center;color:var(--rear-muted)}
.rear-refinement-run-picker{padding:24px 0}
.rear-refinement-run-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
.rear-refinement-run-option{position:relative;display:grid;gap:3px;padding:13px 13px 13px 38px;border:1px solid var(--rear-line);border-radius:10px;background:var(--rear-panel);cursor:pointer}
.rear-refinement-run-option:hover{background:var(--rear-panel-2)}
.rear-refinement-run-option[data-selected="true"]{border-color:rgba(201,255,90,.38);background:rgba(201,255,90,.055);box-shadow:inset 2px 0 var(--rear-accent)}
.rear-refinement-run-option[data-disabled="true"]{cursor:default}
.rear-refinement-run-option>input{position:absolute;top:16px;left:13px;accent-color:var(--rear-accent)}
.rear-refinement-run-option-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rear-refinement-lanes{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(560px,1fr);gap:10px;padding-bottom:18px;overflow-x:auto;align-items:start}
.rear-refinement-lane{min-width:0;border:1px solid var(--rear-line);border-radius:12px;background:var(--rear-panel);overflow:hidden}
.rear-refinement-lane-header{display:grid;gap:10px;padding:14px;border-bottom:1px solid var(--rear-line);background:var(--rear-panel-2);font-size:11px}
.rear-refinement-lane-header .rear-refinement-facts{margin:0}
.rear-refinement-lane-header .rear-refinement-fact{min-height:30px;padding:0 12px}
.rear-refinement-lane-body{min-height:300px;max-height:calc(100vh - 300px);overflow:auto}
.rear-refinement-dsh-trajectory{box-sizing:border-box;height:clamp(480px,calc(100vh - 360px),720px);min-height:480px;overflow:hidden;color:var(--dsw-alias-label-primary,var(--rear-text));background:var(--dsw-alias-bg-layer-1,var(--rear-panel))}
.rear-refinement-card{padding:14px;border:1px solid var(--rear-line);border-radius:8px;background:rgba(255,255,255,.025)}
.rear-refinement-raw{max-height:60vh;margin:0;padding:12px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.rear-refinement-root button{padding:6px 10px;border:1px solid var(--rear-line);border-radius:7px;color:inherit;background:rgba(255,255,255,.035);font:inherit;cursor:pointer;transition:border-color .16s,background .16s,transform .16s}
.rear-refinement-root button:hover:not(:disabled){border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.065)}
.rear-refinement-root button:active:not(:disabled){transform:translateY(1px)}
.rear-refinement-root button:disabled{opacity:.4;cursor:default}
.rear-refinement-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:10px 0}
.rear-refinement-meta dt{color:var(--rear-muted)}
.rear-refinement-meta dd{margin:0;overflow-wrap:anywhere}
.rear-refinement-attempt{display:block;color:var(--rear-muted);font-size:11px}
@media(max-width:1100px){.rear-refinement-portfolio-layout{grid-template-columns:1fr}.rear-refinement-tradeoff{min-height:300px}.rear-refinement-portfolio-stats{grid-template-columns:repeat(2,1fr)}.rear-refinement-portfolio-stat:nth-child(3){border-left:0;border-top:1px solid var(--rear-line)}.rear-refinement-portfolio-stat:nth-child(4){border-top:1px solid var(--rear-line)}}
@media(max-width:820px){.rear-refinement-root{padding:0 16px 32px}.rear-refinement-hero{grid-template-columns:1fr;gap:24px;min-height:0;padding:40px 0}.rear-refinement-hero-score{justify-items:start;min-height:170px}.rear-refinement-header{align-items:flex-start;flex-wrap:wrap}.rear-refinement-segment{margin-left:50px}.rear-refinement-direction-meta{grid-template-columns:1fr}.rear-refinement-summary-strip{overflow:auto}.rear-refinement-lanes{grid-auto-columns:minmax(calc(100vw - 42px),1fr)}}
@media(max-width:520px){.rear-refinement-hero-title{font-size:36px}.rear-refinement-score-value{font-size:70px}.rear-refinement-fact{width:50%;padding:8px 10px;border:0}.rear-refinement-history-item{grid-template-columns:minmax(0,1fr) auto}.rear-refinement-history-item>.rear-refinement-status{display:none}.rear-refinement-section-header{align-items:flex-start;flex-direction:column}.rear-refinement-filters{width:100%;overflow:auto;flex-wrap:nowrap}}
@media(max-width:520px){.rear-refinement-portfolio-stats{grid-template-columns:1fr}.rear-refinement-portfolio-stat{border-top:1px solid var(--rear-line);border-left:0}.rear-refinement-portfolio-stat:first-child{border-top:0}.rear-refinement-portfolio-stat:nth-child(2){border-top:1px solid var(--rear-line)}.rear-refinement-tradeoff{display:none}}
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
