/** Styles are injected by the client plugin so the published bundle is self-contained. */
export const REFINEMENT_STYLES = `
.rear-refinement-root{--rear-bg:var(--dsh-color-bg,#0b0d0e);--rear-panel:#111416;--rear-panel-2:#15191b;--rear-line:rgba(255,255,255,.1);--rear-text:var(--dsh-color-text,#f1f3f2);--rear-muted:var(--dsh-color-text-muted,#8f9895);--rear-accent:#c9ff5a;--rear-green:#67d391;--rear-red:#ff746c;box-sizing:border-box;height:100%;overflow:auto;padding:0 28px 48px;color:var(--rear-text);background:var(--rear-bg);font:13px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.rear-refinement-root *{box-sizing:border-box}
.rear-refinement-root h1,.rear-refinement-root h2,.rear-refinement-root h3,.rear-refinement-root p{margin-top:0}
.rear-refinement-root h2{font-size:20px;line-height:1.2;letter-spacing:-.02em}
.rear-refinement-root h3{font-size:15px}
.rear-refinement-row,.rear-refinement-command{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
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
.rear-refinement-native-trajectory{--rear-trajectory-bottom-clearance:calc(var(--dsh-composer-height,152px) + 16px);box-sizing:border-box;display:flex;height:clamp(480px,calc(100vh - 360px),720px);min-height:480px;color:var(--dsw-alias-label-primary,var(--rear-text));background:var(--dsw-alias-bg-layer-1,var(--rear-panel));font:var(--dsw-font-xxs-12,12px/18px ui-sans-serif,-apple-system,sans-serif);flex-direction:column;overflow:hidden}
.rear-refinement-native-toolbar{position:sticky;top:0;z-index:5;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;padding:0 5px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--rear-line));background:var(--dsw-specific-sidebar-fill,var(--rear-panel-2))}
.rear-refinement-native-actions{display:flex;align-items:center;height:100%}
.rear-refinement-native-actions button{display:inline-flex!important;align-items:center!important;gap:4px;height:30px!important;padding:0 5px!important;border:0!important;border-radius:3px!important;color:var(--dsw-alias-label-tertiary,var(--rear-muted))!important;background:transparent!important;font:var(--dsw-font-xxs-12,11px/16px ui-sans-serif,sans-serif)!important}
.rear-refinement-native-actions button:hover,.rear-refinement-native-actions button[aria-pressed="true"]{color:var(--dsw-alias-label-primary,var(--rear-text))!important;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))!important}
.rear-refinement-native-actions button[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary,#75a7ff)!important}
.rear-refinement-native-actions button>span{font-size:13px}
.rear-refinement-native-search{display:flex;align-items:center;gap:4px;width:min(180px,38%);height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,var(--rear-line));border-radius:4px;color:var(--dsw-alias-label-caption,var(--rear-muted));background:var(--dsw-alias-bg-layer-1,var(--rear-panel))}
.rear-refinement-native-search:focus-within{border-color:var(--dsw-alias-state-business-primary,#75a7ff)}
.rear-refinement-native-search input{width:100%;min-width:0;border:0;outline:0;color:var(--dsw-alias-label-primary,var(--rear-text));background:transparent;font:var(--dsw-font-xxs-12,11px/16px ui-sans-serif,sans-serif)}
.rear-refinement-native-search input::placeholder{color:var(--dsw-alias-label-caption,var(--rear-muted))}
.rear-refinement-native-timeline{position:sticky;top:32px;z-index:4;display:grid;grid-template-columns:45px minmax(0,1fr);height:55px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--rear-line));background:var(--dsw-alias-bg-layer-1,var(--rear-panel))}
.rear-refinement-native-timeline-labels{display:grid;grid-template-rows:repeat(3,1fr);padding:2px 4px;color:var(--dsw-alias-label-tertiary,var(--rear-muted));font:9px/16px var(--ds-font-family-code,ui-monospace,monospace);text-align:right}
.rear-refinement-native-timeline-track{position:relative;margin:2px 5px 2px 0;background:repeating-linear-gradient(to bottom,transparent 0,transparent 16px,var(--dsw-alias-border-l1,var(--rear-line)) 17px,transparent 18px)}
.rear-refinement-native-timeline-span{position:absolute!important;height:8px!important;min-width:2px!important;padding:0!important;border:0!important;border-radius:1px!important;opacity:.86;transition:opacity .12s,filter .12s}
.rear-refinement-native-timeline-span:hover,.rear-refinement-native-timeline-span[data-selected="true"]{opacity:1;filter:brightness(1.22)}
.rear-refinement-native-timeline-span[data-kind="event"]{top:4px;background:var(--dsw-static-blue-500,#6791e8)!important}
.rear-refinement-native-timeline-span[data-kind="assistant"]{top:21px;background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#9e77ed) 72%,#fff)!important}
.rear-refinement-native-timeline-span[data-kind="tool"]{top:38px;background:var(--dsw-alias-state-warn-label,#dca34a)!important}
.rear-refinement-native-ledger{position:relative;display:flex;min-height:0;background:var(--dsw-alias-bg-layer-1,var(--rear-panel));flex:1}
.rear-refinement-native-table-pane{min-width:0;padding-bottom:var(--rear-trajectory-bottom-clearance);flex:1;overflow:auto}
.rear-refinement-native-table{width:100%;min-width:0;border-spacing:0;table-layout:fixed;color:var(--dsw-alias-label-primary,var(--rear-text));background:var(--dsw-alias-bg-layer-1,var(--rear-panel));font:var(--dsw-font-xxs-12,12px/18px ui-sans-serif,sans-serif)}
.rear-refinement-native-event-column{width:122px}
.rear-refinement-native-table td{box-sizing:border-box;height:30px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--rear-line));text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.rear-refinement-native-table tr{outline:0;cursor:default;transition:background-color .12s,opacity .12s}
.rear-refinement-native-table tr:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.rear-refinement-native-table tr:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,#75a7ff)}
.rear-refinement-native-table tr[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(117,167,255,.1))}
.rear-refinement-native-table tr[data-turn-start="true"]:not(:first-child) td{border-top:2px solid var(--dsw-alias-border-l1,var(--rear-line))}
.rear-refinement-native-event-cell{position:relative;padding-left:36px!important;padding-right:4px!important;overflow:visible!important}
.rear-refinement-native-turn-label{position:absolute;top:0;left:0;z-index:2;width:max-content;max-width:34px;padding:1px 5px;border-radius:0 0 2px;color:var(--dsw-alias-label-tertiary,var(--rear-muted));background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));font:8px/10px var(--ds-font-family-code,ui-monospace,monospace);white-space:nowrap;overflow:hidden}
.rear-refinement-native-turn-rail{position:absolute;top:-1px;bottom:-1px;left:0;width:2px;background:color-mix(in srgb,var(--dsw-static-blue-500,#6791e8) 22%,var(--dsw-alias-bg-layer-1,var(--rear-panel)))}
.rear-refinement-native-kind{display:flex;align-items:center;justify-content:center;width:76px;height:19px;padding:0 5px;border-radius:4px;letter-spacing:.035em;font-size:10px;font-weight:650;line-height:16px}
.rear-refinement-native-kind[data-kind="assistant"]{color:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#9e77ed) 60%,var(--dsw-alias-state-error-secondary,#ef8caa));background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#9e77ed) 15%,var(--dsw-alias-bg-layer-1,var(--rear-panel)))}
.rear-refinement-native-kind[data-kind="tool"]{color:var(--dsw-alias-state-warn-label,#dca34a);background:var(--dsw-alias-state-warn-tertiary,rgba(220,163,74,.12))}
.rear-refinement-native-kind[data-kind="event"]{color:var(--dsw-alias-label-secondary,var(--rear-muted));background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05))}
.rear-refinement-native-content{padding-left:4px!important;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace)}
.rear-refinement-native-content strong{font-weight:500}
.rear-refinement-native-content span{color:var(--dsw-alias-label-secondary,var(--rear-muted))}
.rear-refinement-native-arrow{margin:0 5px;color:var(--dsw-alias-label-caption,var(--rear-muted))!important}
.rear-refinement-native-details{position:absolute;top:0;right:0;bottom:0;z-index:6;display:flex;width:min(76%,400px);min-width:280px;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l2,var(--rear-line));background:var(--dsw-alias-bg-layer-1,var(--rear-panel));box-shadow:-12px 0 32px #00000024}
.rear-refinement-native-details>header{display:flex;align-items:center;justify-content:space-between;min-height:42px;padding:0 8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--rear-line))}
.rear-refinement-native-details>header>div{display:grid;min-width:0}
.rear-refinement-native-details>header strong{font:500 12px/16px var(--ds-font-family-code,ui-monospace,monospace)}
.rear-refinement-native-details>header span{color:var(--dsw-alias-label-tertiary,var(--rear-muted));font:10px/14px var(--ds-font-family-code,ui-monospace,monospace);white-space:nowrap}
.rear-refinement-native-details>header button{display:grid!important;width:28px!important;height:28px!important;place-items:center;padding:0!important;border:0!important;background:transparent!important;font-size:18px!important}
.rear-refinement-native-details-tabs{display:flex;align-items:center;height:34px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--rear-line));color:var(--dsw-alias-state-business-primary,#75a7ff);font-size:12px;box-shadow:inset 0 -2px var(--dsw-alias-state-business-primary,#75a7ff)}
.rear-refinement-native-details-preview{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--rear-line));color:var(--dsw-alias-label-secondary,var(--rear-muted));font:11px/17px var(--ds-font-family-code,ui-monospace,monospace);white-space:pre-wrap;overflow-wrap:anywhere}
.rear-refinement-native-details>pre{flex:1;min-height:0;margin:0;padding:12px 12px calc(12px + var(--rear-trajectory-bottom-clearance));overflow:auto;color:var(--dsw-alias-label-primary,var(--rear-text));background:var(--dsw-alias-markdown-code-block,rgba(0,0,0,.18));font:11px/17px var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);white-space:pre-wrap;overflow-wrap:anywhere}
.rear-refinement-card{padding:14px;border:1px solid var(--rear-line);border-radius:8px;background:rgba(255,255,255,.025)}
.rear-refinement-raw{max-height:60vh;margin:0;padding:12px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.rear-refinement-command{padding:8px 10px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:8px}
.rear-refinement-command-text{min-width:0;flex:1;color:var(--dsh-color-text-muted,#9a9ca3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rear-refinement-root button,.rear-refinement-command button{padding:6px 10px;border:1px solid var(--rear-line);border-radius:7px;color:inherit;background:rgba(255,255,255,.035);font:inherit;cursor:pointer;transition:border-color .16s,background .16s,transform .16s}
.rear-refinement-root button:hover:not(:disabled),.rear-refinement-command button:hover:not(:disabled){border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.065)}
.rear-refinement-root button:active:not(:disabled){transform:translateY(1px)}
.rear-refinement-root button:disabled{opacity:.4;cursor:default}
.rear-refinement-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:10px 0}
.rear-refinement-meta dt{color:var(--rear-muted)}
.rear-refinement-meta dd{margin:0;overflow-wrap:anywhere}
.rear-refinement-attempt{display:block;color:var(--rear-muted);font-size:11px}
@media(max-width:820px){.rear-refinement-root{padding:0 16px 32px}.rear-refinement-hero{grid-template-columns:1fr;gap:24px;min-height:0;padding:40px 0}.rear-refinement-hero-score{justify-items:start;min-height:170px}.rear-refinement-header{align-items:flex-start;flex-wrap:wrap}.rear-refinement-segment{margin-left:50px}.rear-refinement-direction-meta{grid-template-columns:1fr}.rear-refinement-summary-strip{overflow:auto}.rear-refinement-lanes{grid-auto-columns:minmax(calc(100vw - 42px),1fr)}}
@media(max-width:520px){.rear-refinement-hero-title{font-size:36px}.rear-refinement-score-value{font-size:70px}.rear-refinement-fact{width:50%;padding:8px 10px;border:0}.rear-refinement-history-item{grid-template-columns:minmax(0,1fr) auto}.rear-refinement-history-item>.rear-refinement-status{display:none}.rear-refinement-section-header{align-items:flex-start;flex-direction:column}.rear-refinement-filters{width:100%;overflow:auto;flex-wrap:nowrap}.rear-refinement-native-event-column{width:50px}.rear-refinement-native-event-cell{padding-left:28px!important;padding-right:3px!important}.rear-refinement-native-kind{width:19px;padding:0;font-size:0}.rear-refinement-native-kind:before{content:"•";font-size:13px}.rear-refinement-native-search{width:32%}}
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
