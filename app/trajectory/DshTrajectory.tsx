"use client";

import { diffLines } from "diff";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CanonicalTrajectoryDocument } from "@/lib/hitch-types";
import { adaptCanonicalTrajectory } from "./dsh-adapter";
import type { TrajectoryModel, TrajectoryRecord, TrajectoryRequest, TrajectoryRole } from "./dsh-types";
import styles from "./DshTrajectory.module.css";

interface DshTrajectoryProps {
  document: CanonicalTrajectoryDocument;
  actualDuration: boolean;
  onActualDurationChange: (value: boolean) => void;
  setScrollElement?: (node: HTMLDivElement | null) => void;
  onLedgerScroll?: () => void;
}

type DisplayRow =
  | { kind: "record"; id: string; record: TrajectoryRecord }
  | { kind: "summary"; id: string; turn: number; text: string; assistantId?: string };

type Inspection = { kind: "record"; id: string } | { kind: "request"; id: string } | null;
type TimelineRange = { start: number; end: number } | null;

const ROLE_LABEL: Record<TrajectoryRole, string> = {
  system: "SYSTEM",
  user: "USER",
  context: "CONTEXT",
  assistant: "ASSISTANT",
  tool: "TOOL",
};

const ROLE_ICON: Record<TrajectoryRole, string> = {
  system: "◆",
  user: "●",
  context: "◇",
  assistant: "✦",
  tool: "⌘",
};

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function compact(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function json(value: unknown): string {
  if (value === undefined) return "Not recorded";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function searchText(record: TrajectoryRecord): string {
  return [
    record.role,
    record.title,
    record.text,
    compact(record.input, ""),
    compact(record.output, ""),
    compact(record.source, ""),
    compact(record.schema, ""),
    record.callId || "",
  ].join(" ").toLocaleLowerCase();
}

function matches(record: TrajectoryRecord, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = searchText(record);
  return terms.every((term) => haystack.includes(term));
}

function requestFor(model: TrajectoryModel, id: string | null): TrajectoryRequest | null {
  return id ? model.requests.find((request) => request.id === id) || null : null;
}

function toolSummary(records: TrajectoryRecord[]): string {
  const names = [...new Set(records.map((record) => record.title))];
  return `${records.length} tool call${records.length === 1 ? "" : "s"} · ${names.join(", ")}`;
}

function buildRows(
  model: TrajectoryModel,
  query: string,
  collapsedTurns: ReadonlySet<number>,
  collapsedAssistants: ReadonlySet<string>,
): DisplayRow[] {
  if (query.trim()) {
    return model.records.filter((record) => matches(record, query)).map((record) => ({ kind: "record", id: record.id, record }));
  }
  const rows: DisplayRow[] = [];
  for (const turn of model.turns) {
    const turnRecords = model.records.filter((record) => record.turn === turn);
    if (collapsedTurns.has(turn) && turnRecords.length > 1) {
      const first = turnRecords[0];
      rows.push({ kind: "record", id: first.id, record: first });
      const steps = new Set(turnRecords.flatMap((record) => record.step === null ? [] : [record.step])).size;
      const tools = turnRecords.filter((record) => record.role === "tool").length;
      rows.push({ kind: "summary", id: `turn-summary:${turn}`, turn, text: `${steps} steps · ${tools} tool calls` });
      continue;
    }
    for (let index = 0; index < turnRecords.length; index += 1) {
      const record = turnRecords[index];
      rows.push({ kind: "record", id: record.id, record });
      if (record.role !== "assistant" || !collapsedAssistants.has(record.id)) continue;
      const tools: TrajectoryRecord[] = [];
      while (index + 1 < turnRecords.length) {
        const candidate = turnRecords[index + 1];
        if (candidate.role !== "tool" || candidate.step !== record.step) break;
        tools.push(candidate);
        index += 1;
      }
      if (tools.length) rows.push({ kind: "summary", id: `calls-summary:${record.id}`, turn, assistantId: record.id, text: toolSummary(tools) });
    }
  }
  return rows;
}

function RecordContent({ record }: { record: TrajectoryRecord }) {
  if (record.role === "tool") {
    return <div className={styles.toolContent}><span><strong>{record.title}</strong><code>{compact(record.input)}</code></span><i>→</i><span className={record.failed ? styles.failedResult : ""}>{record.text || compact(record.output)}</span></div>;
  }
  const text = record.text || (record.role === "system" ? record.prompt?.system : "") || "No content";
  return <div className={styles.messageContent}>{record.role === "assistant" && record.blocks.some((block) => block.type.includes("reasoning")) && <span className={styles.reasoningMark}>thought</span>}<span>{text}</span>{record.durationMs !== null && <time>{duration(record.durationMs)}</time>}</div>;
}

function LedgerRow({
  row,
  firstInTurn,
  rangeDimmed,
  selected,
  request,
  onInspect,
  onInspectRequest,
  onToggleTurn,
  onToggleCalls,
}: {
  row: DisplayRow;
  firstInTurn: boolean;
  rangeDimmed: boolean;
  selected: boolean;
  request: TrajectoryRequest | null;
  onInspect: (record: TrajectoryRecord) => void;
  onInspectRequest: (request: TrajectoryRequest) => void;
  onToggleTurn: (turn: number) => void;
  onToggleCalls: (id: string) => void;
}) {
  if (row.kind === "summary") {
    return <button type="button" className={styles.summaryRow} onClick={() => row.assistantId ? onToggleCalls(row.assistantId) : onToggleTurn(row.turn)}><span /><span>{row.text}</span></button>;
  }
  const record = row.record;
  return (
    <div
      className={`${styles.ledgerRow} ${selected ? styles.selectedRow : ""} ${rangeDimmed ? styles.dimmedRow : ""}`}
      data-role={record.role}
      onDoubleClick={() => record.role === "assistant" ? onToggleCalls(record.id) : onToggleTurn(record.turn)}
    >
      <div className={styles.eventCell} title={ROLE_LABEL[record.role]}>
        <span className={styles.turnRail}>{firstInTurn && <b>Turn {record.turn}</b>}</span>
        {request && <button type="button" className={styles.requestMarker} title={`Request ${request.number}`} aria-label={`Inspect request ${request.number}`} onClick={(event) => { event.stopPropagation(); onInspectRequest(request); }} />}
        <button type="button" className={styles.roleTag} onClick={() => onInspect(record)}><i>{ROLE_ICON[record.role]}</i><b>{ROLE_LABEL[record.role]}</b></button>
      </div>
      <button type="button" className={styles.contentCell} onClick={() => onInspect(record)}><RecordContent record={record} /></button>
    </div>
  );
}

interface TimelineItem {
  record: TrajectoryRecord;
  start: number;
  end: number;
  lane: 0 | 1 | 2;
}

function timelineItems(model: TrajectoryModel, actualDuration: boolean): TimelineItem[] {
  if (!model.records.length) return [];
  if (!actualDuration) return model.records.map((record, index) => ({
    record,
    start: index,
    end: index + 1,
    lane: record.role === "assistant" ? 1 : record.role === "tool" ? 2 : 0,
  }));
  let cursor = 0;
  return model.records.map((record) => {
    const width = Math.max(1, record.durationMs ?? 1);
    const item: TimelineItem = {
      record,
      start: cursor,
      end: cursor + width,
      lane: record.role === "assistant" ? 1 : record.role === "tool" ? 2 : 0,
    };
    cursor += width;
    return item;
  });
}

function Timeline({
  model,
  actualDuration,
  query,
  range,
  onRangeChange,
  onInspect,
}: {
  model: TrajectoryModel;
  actualDuration: boolean;
  query: string;
  range: TimelineRange;
  onRangeChange: (range: TimelineRange) => void;
  onInspect: (record: TrajectoryRecord) => void;
}) {
  const items = useMemo(() => timelineItems(model, actualDuration), [actualDuration, model]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ start: 0, end: 1 });
  const [drag, setDrag] = useState<{ mode: "range" | "pan"; startX: number; originStart: number; originEnd: number } | null>(null);
  const [hovered, setHovered] = useState<TrajectoryRecord | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragMoved = useRef(false);
  const maximum = Math.max(1, ...items.map((item) => item.end));
  const position = useCallback((value: number) => ((value / maximum - viewport.start) / (viewport.end - viewport.start)) * 100, [maximum, viewport]);
  const indexAt = useCallback((clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const normalized = Math.max(0, Math.min(1, (clientX - rect.left - 44) / Math.max(1, rect.width - 44)));
    const domain = (viewport.start + normalized * (viewport.end - viewport.start)) * maximum;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
      const candidate = Math.abs((item.start + item.end) / 2 - domain);
      if (candidate < distance) { distance = candidate; nearest = index; }
    });
    return nearest;
  }, [items, maximum, viewport]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event.clientX);
    dragMoved.current = false;
    setDrag({ mode: event.button === 2 ? "pan" : "range", startX: event.clientX, originStart: viewport.start, originEnd: viewport.end });
    if (event.button === 0) onRangeChange({ start: index, end: index });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (Math.abs(event.clientX - drag.startX) > 3) dragMoved.current = true;
    if (drag.mode === "range") {
      const start = indexAt(drag.startX);
      const end = indexAt(event.clientX);
      onRangeChange({ start: Math.min(start, end), end: Math.max(start, end) });
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = drag.originEnd - drag.originStart;
    const delta = -((event.clientX - drag.startX) / Math.max(1, rect.width - 44)) * width;
    const start = Math.max(0, Math.min(1 - width, drag.originStart + delta));
    setViewport({ start, end: start + width });
  };
  const finishDrag = () => setDrag(null);
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const width = viewport.end - viewport.start;
    const nextWidth = Math.max(0.08, Math.min(1, width * (event.deltaY > 0 ? 1.18 : 0.82)));
    const anchor = (viewport.start + viewport.end) / 2;
    const start = Math.max(0, Math.min(1 - nextWidth, anchor - nextWidth / 2));
    setViewport({ start, end: start + nextWidth });
  };
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(null);
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  return (
    <div
      ref={rootRef}
      className={styles.timeline}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onWheel={onWheel}
      onContextMenu={(event) => { event.preventDefault(); onRangeChange(null); }}
      onDoubleClick={() => onRangeChange(null)}
      onClick={(event) => {
        if (dragMoved.current || (event.target as HTMLElement).closest("button")) return;
        const record = items[indexAt(event.clientX)]?.record;
        if (record) onInspect(record);
      }}
      role="slider"
      aria-label="Trajectory overview timeline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(viewport.start * 100)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape") onRangeChange(null);
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const width = viewport.end - viewport.start;
          const delta = (event.key === "ArrowLeft" ? -1 : 1) * width * .08;
          const start = Math.max(0, Math.min(1 - width, viewport.start + delta));
          setViewport({ start, end: start + width });
        }
      }}
    >
      <div className={styles.timelineLabels}><span>Input</span><span>Model</span><span>Tools</span></div>
      <div className={styles.timelinePlot}>
        {items.map((item, index) => {
          const left = position(item.start);
          const right = position(item.end);
          if (right < 0 || left > 100) return null;
          const searchDimmed = query.trim() !== "" && !matches(item.record, query);
          const selected = range && index >= range.start && index <= range.end;
          const assistantTiming = item.record.timing;
          const ttftPercent = assistantTiming?.firstTokenAt === null || !assistantTiming
            ? 0
            : Math.max(0, Math.min(100, ((assistantTiming.firstTokenAt - assistantTiming.startedAt) / Math.max(1, assistantTiming.completedAt - assistantTiming.startedAt)) * 100));
          return <button
            type="button"
            key={item.record.id}
            className={`${styles.timelineSpan} ${searchDimmed ? styles.timelineDimmed : ""} ${range && !selected ? styles.timelineRangeDimmed : ""} ${selected ? styles.timelineSelected : ""}`}
            data-role={item.record.role}
            data-assistant-timing={assistantTiming?.firstTokenAt !== null && assistantTiming ? "true" : undefined}
            style={{ "--span-left": `${Math.max(0, left)}%`, "--span-width": `${Math.max(.35, Math.min(100, right) - Math.max(0, left))}%`, "--span-lane": item.lane, "--assistant-ttft": `${ttftPercent}%` } as CSSProperties}
            aria-label={`${ROLE_LABEL[item.record.role]} ${item.record.title}`}
            onClick={(event) => { event.stopPropagation(); onInspect(item.record); }}
            onPointerEnter={() => { clearHover(); hoverTimer.current = setTimeout(() => setHovered(item.record), 500); }}
            onPointerLeave={clearHover}
          />;
        })}
        {[...new Set(model.records.map((record) => record.turn))].map((turn) => {
          const firstIndex = model.records.findIndex((record) => record.turn === turn);
          const item = items[firstIndex];
          return item ? <i key={turn} className={styles.turnBoundary} style={{ left: `${position(item.start)}%` }} /> : null;
        })}
        {hovered && <div className={styles.timelineTooltip}><strong>{ROLE_LABEL[hovered.role]} · {hovered.title}</strong><span>Turn {hovered.turn}{hovered.step !== null ? ` / Step ${hovered.step}` : ""}</span><span>{duration(hovered.durationMs)}</span></div>}
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? styles.activeTab : ""} onClick={onClick}>{children}</button>;
}

function DiffView({ before, after }: { before: string; after: string }) {
  return <pre className={styles.diff}>{diffLines(before, after).map((part, index) => <span key={index} data-change={part.added ? "added" : part.removed ? "removed" : "same"}>{part.value}</span>)}</pre>;
}

function usageTable(value: TrajectoryRequest["usage"]) {
  if (!value) return <p className={styles.unknown}>Usage was not recorded.</p>;
  const fields: Array<[string, unknown]> = [
    ["Input", value.inputTokens],
    ["Output", value.outputTokens],
    ["Cache read", value.cacheReadTokens],
    ["Cache write", value.cacheWriteTokens],
    ["Reasoning", value.reasoningTokens],
  ];
  return <dl className={styles.detailGrid}>{fields.map(([label, field]) => <div key={String(label)}><dt>{label}</dt><dd>{field === undefined ? "—" : String(field)}</dd></div>)}</dl>;
}

function RecordInspector({ record, onClose }: { record: TrajectoryRecord; onClose: () => void }) {
  const updatedSystem = record.role === "system" && record.previousPrompt !== null;
  const tabs = record.role === "system"
    ? [...(updatedSystem ? ["Diff"] : []), "System Prompt", "Tools"]
    : record.role === "tool"
      ? ["Summary", "Payload", "Result", "Schema", "Timing"]
      : ["Summary", "Preview", "Raw", ...(record.source ? ["Source"] : [])];
  const [tab, setTab] = useState(tabs[0]);
  const request = record.timing?.usage;
  let body: ReactNode;
  if (tab === "Diff") body = <DiffView before={record.previousPrompt?.system || ""} after={record.prompt?.system || ""} />;
  else if (tab === "System Prompt") body = <pre>{record.prompt?.system || "No system prompt"}</pre>;
  else if (tab === "Tools") body = <pre>{json(record.prompt?.tools || [])}</pre>;
  else if (tab === "Payload") body = <pre>{json(record.input)}</pre>;
  else if (tab === "Result") body = <pre>{json(record.output)}</pre>;
  else if (tab === "Schema") body = <pre>{record.schema === null ? "Schema was not recorded." : json(record.schema)}</pre>;
  else if (tab === "Timing") body = <dl className={styles.detailGrid}><div><dt>Duration</dt><dd>{duration(record.durationMs)}</dd></div><div><dt>Started</dt><dd>{record.timestamp || "—"}</dd></div>{record.timing && <><div><dt>TTFT</dt><dd>{record.timing.firstTokenAt === null ? "—" : duration(record.timing.firstTokenAt - record.timing.startedAt)}</dd></div><div><dt>Decode</dt><dd>{record.timing.firstTokenAt === null ? "—" : duration(record.timing.completedAt - record.timing.firstTokenAt)}</dd></div></>}</dl>;
  else if (tab === "Preview") body = <div className={styles.preview}>{record.blocks.length ? record.blocks.map((block, index) => <section key={index}><small>{block.type}</small><p>{block.text || compact(block.arguments || block.value)}</p></section>) : <p>{record.text || "No preview"}</p>}</div>;
  else if (tab === "Source") body = <pre>{json(record.source)}</pre>;
  else if (tab === "Raw") body = <pre>{json({ input: record.input, output: record.output, blocks: record.blocks })}</pre>;
  else body = <><dl className={styles.detailGrid}><div><dt>Location</dt><dd>Turn {record.turn}{record.step !== null ? ` / Step ${record.step}` : ""}</dd></div><div><dt>Role</dt><dd>{ROLE_LABEL[record.role]}</dd></div><div><dt>Status</dt><dd>{record.failed ? "Failed" : "Completed"}</dd></div><div><dt>Duration</dt><dd>{duration(record.durationMs)}</dd></div></dl>{record.text && <p className={styles.summaryText}>{record.text}</p>}{request && usageTable(request)}</>;
  return <><header className={styles.inspectorHeader}><div><strong>{record.title}</strong><span>Turn {record.turn}{record.step !== null ? ` · Step ${record.step}` : ""}</span></div><button type="button" onClick={onClose} aria-label="Close inspector">×</button></header><nav className={styles.inspectorTabs}>{tabs.map((name) => <TabButton key={name} active={tab === name} onClick={() => setTab(name)}>{name}</TabButton>)}</nav><div className={styles.inspectorBody}>{body}</div></>;
}

function RequestInspector({ request, onClose }: { request: TrajectoryRequest; onClose: () => void }) {
  const tabs = ["Summary", ...(request.config ? ["Options"] : []), "Usage", "Timing"];
  const [tab, setTab] = useState(tabs[0]);
  const body = tab === "Options" ? <pre>{json(request.config)}</pre>
    : tab === "Usage" ? usageTable(request.usage)
      : tab === "Timing" ? <dl className={styles.detailGrid}><div><dt>Started</dt><dd>{request.startedAt}</dd></div><div><dt>Completed</dt><dd>{request.completedAt ?? "—"}</dd></div><div><dt>Duration</dt><dd>{request.completedAt === null ? "—" : duration(request.completedAt - request.startedAt)}</dd></div></dl>
        : <dl className={styles.detailGrid}><div><dt>Location</dt><dd>Turn {request.turn} / Step {request.step}</dd></div><div><dt>Status</dt><dd>{request.status}</dd></div><div><dt>Provider</dt><dd>{request.provider || "—"}</dd></div><div><dt>Model</dt><dd>{request.model || "—"}</dd></div></dl>;
  return <><header className={styles.inspectorHeader}><div><strong>Request {request.number}</strong><span>Turn {request.turn} · Step {request.step}</span></div><button type="button" onClick={onClose} aria-label="Close inspector">×</button></header><nav className={styles.inspectorTabs}>{tabs.map((name) => <TabButton key={name} active={tab === name} onClick={() => setTab(name)}>{name}</TabButton>)}</nav><div className={styles.inspectorBody}>{body}</div></>;
}

export function DshTrajectory({ document, actualDuration, onActualDurationChange, setScrollElement, onLedgerScroll }: DshTrajectoryProps) {
  const model = useMemo(() => adaptCanonicalTrajectory(document), [document]);
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [inspection, setInspection] = useState<Inspection>(null);
  const [range, setRange] = useState<TimelineRange>(null);
  const [inspectorWidth, setInspectorWidth] = useState(380);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const resizer = useRef<{ startX: number; startWidth: number } | null>(null);
  const rows = useMemo(() => buildRows(model, query, collapsedTurns, collapsedAssistants), [collapsedAssistants, collapsedTurns, model, query]);
  const recordIndex = useMemo(() => new Map(model.records.map((record, index) => [record.id, index])), [model.records]);
  const collapsibleTurns = useMemo(() => model.turns.filter((turn) => model.records.filter((record) => record.turn === turn).length > 1), [model]);
  const collapsibleAssistants = useMemo(() => model.records.filter((record) => record.role === "assistant" && model.records.some((candidate) => candidate.role === "tool" && candidate.turn === record.turn && candidate.step === record.step)), [model]);
  // TanStack Virtual intentionally exposes mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === "summary" ? 20 : 30,
    overscan: 12,
    getItemKey: (index) => rows[index]?.id || index,
  });
  const virtual = rows.length > 100 ? virtualizer.getVirtualItems() : rows.map((_, index) => ({ index, key: rows[index].id, start: rows.slice(0, index).reduce((sum, row) => sum + (row.kind === "summary" ? 20 : 30), 0), size: rows[index].kind === "summary" ? 20 : 30, end: 0, lane: 0 }));
  const totalHeight = rows.length > 100 ? virtualizer.getTotalSize() : rows.reduce((sum, row) => sum + (row.kind === "summary" ? 20 : 30), 0);
  const assignScrollRef = useCallback((node: HTMLDivElement | null) => { scrollRef.current = node; setScrollElement?.(node); }, [setScrollElement]);
  const toggleTurn = (turn: number) => setCollapsedTurns((current) => { const next = new Set(current); if (next.has(turn)) next.delete(turn); else next.add(turn); return next; });
  const toggleCalls = (id: string) => setCollapsedAssistants((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectedRecord = inspection?.kind === "record" ? model.records.find((record) => record.id === inspection.id) || null : null;
  const selectedRequest = inspection?.kind === "request" ? model.requests.find((request) => request.id === inspection.id) || null : null;
  const onResizeMove = useCallback((event: PointerEvent) => {
    if (!resizer.current) return;
    setInspectorWidth(Math.max(320, Math.min(720, resizer.current.startWidth + resizer.current.startX - event.clientX)));
  }, []);
  const stopResize = useCallback(() => { resizer.current = null; window.removeEventListener("pointermove", onResizeMove); window.removeEventListener("pointerup", stopResize); }, [onResizeMove]);
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizer.current = { startX: event.clientX, startWidth: inspectorWidth };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
  };
  useEffect(() => stopResize, [stopResize]);

  return (
    <div className={styles.surface} style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}>
      <div className={styles.toolbar} role="toolbar" aria-label="Trajectory controls">
        <div className={styles.toolbarActions}>
          <button type="button" className={actualDuration ? styles.pressed : ""} aria-pressed={actualDuration} onClick={() => onActualDurationChange(!actualDuration)} title={actualDuration ? "Use equal-width events" : "Use recorded durations"}><span>◴</span>Duration</button>
          <button type="button" hidden aria-hidden>Actual time</button>
          <button type="button" className={collapsibleTurns.length > 0 && collapsedTurns.size === collapsibleTurns.length ? styles.pressed : ""} onClick={() => setCollapsedTurns(collapsedTurns.size === collapsibleTurns.length ? new Set() : new Set(collapsibleTurns))}><span>{collapsedTurns.size === collapsibleTurns.length ? "⊞" : "⊟"}</span>Turns</button>
          <button type="button" className={collapsibleAssistants.length > 0 && collapsedAssistants.size === collapsibleAssistants.length ? styles.pressed : ""} onClick={() => setCollapsedAssistants(collapsedAssistants.size === collapsibleAssistants.length ? new Set() : new Set(collapsibleAssistants.map((record) => record.id)))}><span>{collapsedAssistants.size === collapsibleAssistants.length ? "⊞" : "⊟"}</span>Calls</button>
        </div>
        <label className={styles.search}><span>⌕</span><input type="search" aria-label="Search trajectory" placeholder="Search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      </div>
      <Timeline model={model} actualDuration={actualDuration} query={query} range={range} onRangeChange={setRange} onInspect={(record) => setInspection({ kind: "record", id: record.id })} />
      <div className={styles.split}>
        <div className={styles.ledger}>
          <div className={styles.ledgerScroll} ref={assignScrollRef} onScroll={onLedgerScroll}>
            {rows.length ? <div className={styles.virtualSpace} style={{ height: totalHeight }}>
              {virtual.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const previous = item.index > 0 ? rows[item.index - 1] : null;
                const firstInTurn = row.kind === "record" && (previous?.kind !== "record" || previous.record.turn !== row.record.turn);
                const index = row.kind === "record" ? recordIndex.get(row.record.id) ?? -1 : -1;
                const rangeDimmed = Boolean(range && row.kind === "record" && (index < range.start || index > range.end));
                const request = row.kind === "record" ? requestFor(model, row.record.requestId) : null;
                return <div key={item.key} className={styles.virtualRow} style={{ height: item.size, transform: `translateY(${item.start}px)` }}><LedgerRow row={row} firstInTurn={firstInTurn} rangeDimmed={rangeDimmed} selected={row.kind === "record" && selectedRecord?.id === row.record.id} request={request} onInspect={(record) => setInspection({ kind: "record", id: record.id })} onInspectRequest={(requestValue) => setInspection({ kind: "request", id: requestValue.id })} onToggleTurn={toggleTurn} onToggleCalls={toggleCalls} /></div>;
              })}
            </div> : <div className={styles.noResults}>No matching trajectory records</div>}
          </div>
        </div>
        {(selectedRecord || selectedRequest) && <aside className={styles.inspector}>
          <button type="button" className={styles.resizeHandle} aria-label="Resize inspector" onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") setInspectorWidth((value) => Math.min(720, value + 16)); if (event.key === "ArrowRight") setInspectorWidth((value) => Math.max(320, value - 16)); }} />
          {selectedRecord ? <RecordInspector key={selectedRecord.id} record={selectedRecord} onClose={() => setInspection(null)} /> : selectedRequest ? <RequestInspector key={selectedRequest.id} request={selectedRequest} onClose={() => setInspection(null)} /> : null}
        </aside>}
      </div>
    </div>
  );
}
