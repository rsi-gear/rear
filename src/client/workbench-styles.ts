/** Evidence and the native conversation share a resizable workbench. */
export const WORKBENCH_STYLES = `
[data-conversation-scroll]:has(.rear-refinement-root) > [data-composer-seat]:not(:has([data-conversation-composer-overlay])){display:none}
.rear-refinement-root{padding-bottom:40px;scroll-padding-bottom:16px}
.rear-comparison-workbench{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:0!important;scroll-padding:0}
.rear-comparison-workbench>.rear-refinement-header{position:static;flex:none;min-height:70px;padding:12px 20px;gap:12px;flex-wrap:nowrap;align-items:center}
.rear-comparison-workbench .rear-refinement-comparison-head{min-width:0}
.rear-comparison-workbench .rear-refinement-comparison-head h2{font-size:17px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-bottom:0}
.rear-comparison-workbench .rear-refinement-kicker{margin-bottom:4px;font-size:9px}
.rear-workbench-layout{display:flex;flex:1;min-height:0;overflow:hidden}
.rear-evidence-pane{position:relative;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.rear-workbench-tabs{display:flex;flex:none;align-items:center;gap:4px;min-height:54px;padding:8px 140px 8px 16px;border-bottom:1px solid var(--rear-line)}
.rear-workbench-tabs button{white-space:nowrap;border-color:transparent!important;background:transparent!important;color:var(--rear-muted)!important}
.rear-workbench-tabs [aria-selected="true"]{background:rgba(201,255,90,.08)!important;color:var(--rear-accent)!important}
.rear-evidence-scroll{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:14px 16px 0}
.rear-evidence-scroll>[role="tabpanel"]{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding-bottom:24px}
.rear-evidence-scroll>[role="tabpanel"][hidden]{display:none}
.rear-evidence-scroll>.rear-run-selection{flex:none;max-height:40%;overflow:auto;margin:0 0 14px;padding:0;border:1px solid var(--rear-line);border-radius:9px}
.rear-run-selection>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;padding:10px 12px;color:var(--rear-muted);list-style:none}
.rear-run-selection>summary:before{content:'›';font-size:18px;line-height:1}
.rear-run-selection[open]>summary:before{transform:rotate(90deg)}
.rear-run-selection>summary>.rear-refinement-pill{margin-left:auto}
.rear-run-selection .rear-refinement-run-grid{padding:0 12px 12px}
.rear-evidence-pane .rear-refinement-lanes{grid-auto-columns:minmax(min(100%,460px),1fr)}
.rear-evidence-pane .rear-refinement-lane-header .rear-refinement-fact{width:auto}
.rear-lane-metadata{color:var(--rear-muted);font-size:10px;overflow-wrap:anywhere}
.rear-lane-metadata>summary{cursor:pointer;padding:2px 0}
.rear-lane-metadata[open]>summary{margin-bottom:8px}
.rear-lane-metadata>.rear-refinement-muted{margin-top:8px}
.rear-analysis-toggle{position:absolute;right:14px;top:10px;display:flex;align-items:center;gap:7px;font-size:12px!important;z-index:1}
.rear-analysis-toggle[aria-expanded="true"]{border-color:rgba(201,255,90,.2)!important;color:var(--rear-accent)!important}
.rear-workbench-resize{flex:0 0 7px;position:relative;cursor:col-resize;touch-action:none;outline:none;background:var(--rear-bg)}
.rear-workbench-resize:after{position:absolute;content:'';inset:0 3px;background:var(--rear-line);transition:background .15s}
.rear-workbench-resize:hover:after,.rear-workbench-resize:focus-visible:after{background:var(--rear-accent)}
.rear-analysis-pane{flex:0 0 var(--rear-chat-size);min-width:320px;max-width:65%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#131314)}
.rear-analysis-pane[hidden],.rear-workbench-resize[hidden]{display:none}
.rear-analysis{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.rear-analysis-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px 10px;flex:none}
.rear-analysis-header strong{font-size:14px;font-weight:600}
.rear-analysis-header .rear-refinement-muted{font-size:11px;margin-top:2px}
.rear-analysis-icon{display:grid;place-items:center;padding:5px!important;border-color:transparent!important;background:transparent!important}
.rear-analysis-context{flex:none;padding:0 16px 10px;border-bottom:1px solid var(--rear-line)}
.rear-analysis-history{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.rear-analysis-history select{width:100%;min-width:0;border:1px solid var(--rear-line);border-radius:6px;padding:6px 8px;font:inherit;font-size:12px;color:var(--rear-text);background:var(--rear-bg);text-overflow:ellipsis}
.rear-analysis-history button{padding:3px 7px!important;font-size:17px!important}
.rear-analysis-scope{font-size:11px;color:var(--rear-muted)}
.rear-analysis-scope summary{cursor:pointer;white-space:nowrap}
.rear-analysis-scope summary>span{float:right;font-size:10px;color:var(--rear-muted)}
.rear-analysis-scope>div{display:grid;gap:5px;padding:10px 0 3px}
.rear-analysis-scope code{display:block;font-size:10px;overflow-wrap:anywhere;padding-top:8px}
.rear-analysis-loading,.rear-native-chat-error{padding:16px;color:var(--rear-muted);font-size:12px}
.rear-native-chat-error{color:var(--rear-red);overflow-wrap:anywhere}
.rear-native-chat-error button{margin:8px}
.rear-native-chat{display:flex;flex:1;min-width:0;min-height:0;font:14px/1.6 var(--ds-font-family,ui-sans-serif,sans-serif);container-type:inline-size}
.rear-native-chat-body{display:flex;flex-direction:column;position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
.rear-native-chat-body>[data-slot="conversation"]+*{min-height:0}
.rear-native-chat [data-conversation-scroll]{overscroll-behavior:contain}
/* DSH rc.2's blank hero includes global workspace navigation. The analysis
   directory is shown in the scope disclosure above, so omit that global row. */
.rear-native-chat [data-phase="hero"] [class$="_heroWorkspaceRow"]{display:none}
@container (max-width:420px){
  .rear-native-chat [data-phase="hero"] [class$="_headline"]{grid-template-columns:34px auto;font-size:22px;line-height:30px}
  .rear-native-chat [data-phase="hero"] [class$="_previewBadge"]{display:none}
}
.rear-native-chat-details{position:absolute;inset:0;z-index:5;background:var(--dsw-alias-bg-base,#131314)}
.rear-workbench-layout[data-stacked="true"]{flex-direction:column}
.rear-workbench-layout[data-stacked="true"]>.rear-workbench-resize{cursor:row-resize;flex-basis:7px}
.rear-workbench-layout[data-stacked="true"]>.rear-workbench-resize:after{inset:3px 0}
.rear-workbench-layout[data-stacked="true"]>.rear-analysis-pane{flex-basis:var(--rear-chat-size);min-height:230px;max-width:none;width:100%;min-width:0}
.rear-workbench-layout[data-stacked="true"] .rear-analysis-header{padding:9px 16px 7px}
.rear-workbench-layout[data-stacked="true"] .rear-analysis-header .rear-refinement-muted{display:none}
.rear-block-comparison{margin-bottom:24px;min-width:0}
.rear-block-toolbar{display:flex;justify-content:flex-end;margin-bottom:12px}
.rear-block-picker textarea,.rear-block-picker select,.rear-block-picker input{color:var(--rear-text);background:var(--rear-bg);border:1px solid var(--rear-line);border-radius:6px;padding:10px;min-width:0;width:100%;font:inherit}
.rear-block-pickers{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}
.rear-block-picker{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--rear-line);border-radius:8px}
.rear-block-picker>strong{overflow-wrap:anywhere}
.rear-block-picker textarea{font:12px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre;resize:vertical;min-height:150px}
.rear-block-picker select{max-width:100%}
.rear-diff-basket{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0;padding:14px 0;border-top:1px solid var(--rear-line);border-bottom:1px solid var(--rear-line);scroll-margin-top:154px}
.rear-diff-basket>button{margin-left:auto}
.rear-diff-pin{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-width:0}
.rear-diff-pin>button[aria-pressed]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.rear-diff-pin [aria-pressed="true"]{border-color:var(--rear-accent)!important;color:var(--rear-accent)!important}
.rear-diff-pin label,.rear-diff-heading label{display:flex;align-items:center;gap:5px;flex-shrink:0}
.rear-diff-heading{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px;background:rgba(255,255,255,.025);border-bottom:1px solid var(--rear-line)}
.rear-diff-heading>span{overflow-wrap:anywhere}
.rear-block-diff{border:1px solid var(--rear-line);border-radius:8px;overflow:hidden}
.rear-diff-lines{max-height:65vh;overflow:auto;font:12px/1.7 ui-monospace,SFMono-Regular,monospace}
.rear-diff-line{display:grid;grid-template-columns:4em 4em 1.5em minmax(0,1fr);min-width:0}
.rear-diff-number{color:var(--rear-muted);text-align:right;padding-right:10px;user-select:none;border-right:1px solid var(--rear-line)}
.rear-diff-line code{white-space:pre-wrap;overflow-wrap:anywhere;padding:0 10px}
.rear-diff-line[data-kind="add"]{background:rgba(64,195,112,.13)}
.rear-diff-line[data-kind="remove"]{background:rgba(248,100,100,.13)}
.rear-diff-line[data-kind="add"] [data-changed="true"]{background:rgba(64,195,112,.3)}
.rear-diff-line[data-kind="remove"] [data-changed="true"]{background:rgba(248,100,100,.3)}
.rear-diff-eof{color:var(--rear-muted);font-style:italic}
.rear-diff-fold{display:block!important;width:100%;border:0!important;border-radius:0!important;color:var(--rear-muted)!important;background:rgba(80,145,245,.08)!important;text-align:left}
.rear-diff-identical{padding:12px;color:var(--rear-green)}
.rear-diff-fallback{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-height:65vh;overflow:auto}
.rear-diff-fallback pre{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
@media(max-width:650px){.rear-diff-line{grid-template-columns:3em 3em 1em minmax(0,1fr)}.rear-diff-fallback{grid-template-columns:1fr}}
`
