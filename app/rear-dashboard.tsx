"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CanonicalTrajectoryDocument,
  ComparisonDimension,
  DisplayIdentitySummary,
  HitchBenchmark,
  HitchRun,
  HitchSnapshot,
  ProviderEvidencePage,
  RunExecutionStatus,
  TaskIdentitySummary,
} from "@/lib/hitch-types";
import { DshTrajectory } from "@/app/trajectory/DshTrajectory";
import { modelIdentityLabel } from "@/lib/hitch/model-identity";
import { compareRunSummaries } from "@/lib/hitch/strict-comparison";

type AggregationMode = "model" | "harness";
type Breakdown = { dimension: AggregationMode; value: string };
type CompareSelection = { taskKey: string; runIds: string[]; dimension: ComparisonDimension };
type EvidenceView = "canonical" | "provider";

const EXECUTION: Record<RunExecutionStatus, { label: string; tone: string }> = {
  queued: { label: "排队中", tone: "muted" },
  preparing: { label: "准备中", tone: "active" },
  running: { label: "运行中", tone: "active" },
  succeeded: { label: "执行成功", tone: "positive" },
  failed: { label: "执行失败", tone: "negative" },
  timed_out: { label: "执行超时", tone: "warning" },
  cancelled: { label: "已取消", tone: "muted" },
};

const REASON_LABELS: Record<string, string> = {
  not_benchmark_task: "不是 benchmark task",
  benchmark_reference_missing: "缺少 benchmark reference",
  benchmark_revision_mismatch: "benchmark revision/task 不一致",
  task_digest_mismatch: "task digest 不一致",
  verifier_identity_mismatch: "verifier identity 不一致",
  harness_identity_mismatch: "harness identity 不一致",
  model_identity_mismatch: "model identity 不一致",
  protocol_identity_mismatch: "protocol identity 不一致",
  harness_identity_unresolved: "harness identity 未解析",
  model_identity_unresolved: "model identity 未解析",
  trajectory_missing_or_corrupt: "轨迹缺失、损坏或不受支持",
  verifier_result_missing: "verifier result 缺失",
  infrastructure_failure: "run record 完整性异常",
  cancelled: "run 已取消",
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function duration(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const result = Date.parse(end) - Date.parse(start);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function agentDuration(run: HitchRun): number | null {
  return duration(run.result.startedAt, run.result.completedAt);
}

function lifecycleDuration(run: HitchRun): number | null {
  return duration(run.createdAt, run.completedAt);
}

function formatNumber(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatReward(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function relativeTime(timestamp: string | null): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(timestamp));
}

function shortDigest(value: string | null | undefined): string {
  return value ? value.replace(/^sha256:/, "").slice(0, 10) : "unresolved";
}

function modelLabel(run: HitchRun): string {
  return modelIdentityLabel(run.model);
}

function harnessLabel(run: HitchRun): string {
  return `${run.harness.harness_id}@${shortDigest(run.harness.revision_identity)}`;
}

function ExecutionBadge({ status }: { status: RunExecutionStatus }) {
  const value = EXECUTION[status];
  return <span className={`status-badge ${value.tone}`}><span className="status-dot" />{value.label}</span>;
}

function ObservationBadge({ run }: { run: HitchRun }) {
  if (run.observation.state === "valid") return <span className="state-pill valid">观测有效 · {formatReward(run.observation.reward)}</span>;
  if (run.observation.state === "invalid") return <span className="state-pill invalid">观测无效</span>;
  if (run.observation.state === "pending") return <span className="state-pill pending">观测待定</span>;
  return <span className="state-pill muted">无需观测</span>;
}

function IntegrityBadge({ run }: { run: HitchRun }) {
  return <span className={`state-pill ${run.integrity}`}>完整性 {run.integrity}</span>;
}

function EmptyState({ error, message, onRetry }: { error: string | null; message?: string; onRetry: () => void }) {
  return (
    <main className="empty-shell">
      <div className="empty-mark"><span /></div>
      <p className="eyebrow">RUNTIME EXPERIENCE ANALYSIS &amp; REPLAY</p>
      <h1>{error ? "暂时无法读取运行数据" : message ? "没有可展示的 Benchmark" : "正在读取 Benchmark 数据"}</h1>
      <p>{error || message || "正在扫描本地 run-centered Hitch store。"}</p>
      {(error || message) && <button className="primary-button" onClick={onRetry}>重新读取</button>}
    </main>
  );
}

function metricRuns(runs: HitchRun[]) {
  return runs.filter((run) => run.strictMetricEligible && run.observation.state === "valid");
}

function MetricCell({ runs, onOpen }: { runs: HitchRun[]; onOpen: () => void }) {
  if (!runs.length) return <div className="matrix-empty">暂无运行</div>;
  const valid = metricRuns(runs);
  const score = valid.length
    ? valid.reduce((sum, run) => sum + (run.observation.state === "valid" ? run.observation.reward : 0), 0) / valid.length
    : null;
  const invalid = runs.filter((run) => run.observation.state === "invalid").length;
  const corrupt = runs.filter((run) => run.integrity === "corrupt").length;
  return (
    <button className="metric-cell" onClick={onOpen}>
      <div className="metric-cell-topline"><strong>{formatReward(score)}</strong><span>{valid.length} 个有效观测</span></div>
      <div className="metric-cell-meta">
        <span>{runs.length} runs</span>
        {invalid > 0 && <span className="cell-error">{invalid} invalid</span>}
        {corrupt > 0 && <span className="cell-error">{corrupt} corrupt</span>}
      </div>
      <span className="cell-link">查看任务明细 <span aria-hidden>↗</span></span>
    </button>
  );
}

function Overview({
  benchmark, mode, onModeChange, onBreakdown,
}: {
  benchmark: HitchBenchmark;
  mode: AggregationMode;
  onModeChange: (mode: AggregationMode) => void;
  onBreakdown: (breakdown: Breakdown) => void;
}) {
  const runs = benchmark.runs;
  const valid = metricRuns(runs);
  const score = valid.length
    ? valid.reduce((sum, run) => sum + (run.observation.state === "valid" ? run.observation.reward : 0), 0) / valid.length
    : null;
  const invalid = runs.filter((run) => run.observation.state === "invalid").length;
  const running = runs.filter((run) => ["queued", "preparing", "running"].includes(run.execution)).length;
  const corrupt = runs.filter((run) => run.integrity === "corrupt").length;
  const primary = mode === "model" ? benchmark.models : benchmark.harnesses;
  const secondary = mode === "model" ? benchmark.harnesses : benchmark.models;

  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div><div className="hero-kicker"><span className="live-pulse" /> RUN-CENTERED LIVE INDEX</div><h1>{benchmark.label}</h1><p>基于 RunRecord identity、有效观测与已校验的 V2 trajectory 进行分析。</p></div>
        <div className="benchmark-version"><span>Benchmark revision</span><strong>{benchmark.revision}</strong><small>{benchmark.id}</small></div>
      </section>
      <section className="stats-grid" aria-label="Benchmark 摘要">
        <article className="stat-card primary-stat"><span>平均 reward</span><strong>{formatReward(score)}</strong><p>分母仅包含完整、有效的观测</p></article>
        <article className="stat-card"><span>有效观测</span><strong>{valid.length}<small> / {runs.length}</small></strong><p>{benchmark.tasks.length} 个 task identity</p></article>
        <article className="stat-card"><span>Invalid / Running</span><strong>{invalid}<small> / {running}</small></strong><p>Invalid 不按 0 分计入</p></article>
        <article className="stat-card alert-stat"><span>完整性异常</span><strong>{corrupt}</strong><p>不进入 strict metrics</p></article>
      </section>
      <section className="data-panel">
        <header className="section-header">
          <div><p className="eyebrow">AGGREGATE VIEW</p><h2>{mode === "model" ? "按完整模型 identity 聚合" : "按完整 Harness identity 聚合"}</h2></div>
          <div className="segmented" role="group" aria-label="切换聚合维度">
            <button className={mode === "model" ? "selected" : ""} onClick={() => onModeChange("model")}>模型视角</button>
            <button className={mode === "harness" ? "selected" : ""} onClick={() => onModeChange("harness")}>Harness 视角</button>
          </div>
        </header>
        <div className="matrix-wrap">
          <div className="matrix" style={{ "--matrix-columns": secondary.length } as CSSProperties}>
            <div className="matrix-corner">{mode === "model" ? "MODEL" : "HARNESS"}</div>
            {secondary.map((item) => <div className="matrix-column-title" key={item.key}>{item.label}</div>)}
            {primary.map((row) => (
              <div className="matrix-row" key={row.key}>
                <button className="matrix-row-title" onClick={() => onBreakdown({ dimension: mode, value: row.key })}>
                  <span className={`dimension-mark ${mode}`} /><span><strong>{row.label}</strong><small>{row.unresolved ? "IDENTITY UNRESOLVED" : "EXACT IDENTITY"}</small></span><i>→</i>
                </button>
                {secondary.map((column) => {
                  const cellRuns = runs.filter((run) => mode === "model"
                    ? run.modelKey === row.key && run.harnessKey === column.key
                    : run.harnessKey === row.key && run.modelKey === column.key);
                  return <MetricCell key={column.key} runs={cellRuns} onOpen={() => onBreakdown({ dimension: mode, value: row.key })} />;
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function RunChip({ run, selected, disabled, onSelect, onOpen }: {
  run: HitchRun; selected: boolean; disabled: boolean; onSelect: () => void; onOpen: () => void;
}) {
  return (
    <article className={`run-chip ${selected ? "selected" : ""}`}>
      <label className="run-select"><input type="checkbox" checked={selected} disabled={disabled} onChange={onSelect} /><span className="custom-check" aria-hidden /><ExecutionBadge status={run.execution} /></label>
      <div className="run-reward"><span>Reward</span><strong>{run.observation.state === "valid" ? formatReward(run.observation.reward) : "—"}</strong></div>
      <div className="run-state-row"><ObservationBadge run={run} /><IntegrityBadge run={run} /></div>
      <div className="run-chip-meta"><span>attempt {run.parent?.attempt || "—"}</span><span>{relativeTime(run.createdAt)}</span><span>{run.trajectory.summary?.toolCalls ?? "—"} tools</span></div>
      <button className="text-button" onClick={onOpen}>查看轨迹 <span aria-hidden>→</span></button>
      {run.observation.state === "invalid" && <p className="run-diagnostic">{run.observation.reason}</p>}
    </article>
  );
}

function identityByKey(items: DisplayIdentitySummary[], key: string): DisplayIdentitySummary | undefined {
  return items.find((item) => item.key === key);
}

function BreakdownView({ benchmark, breakdown, selectedIds, onToggleRun, onBack, onOpenRuns }: {
  benchmark: HitchBenchmark;
  breakdown: Breakdown;
  selectedIds: string[];
  onToggleRun: (run: HitchRun) => void;
  onBack: () => void;
  onOpenRuns: (task: TaskIdentitySummary, ids: string[]) => void;
}) {
  const filtered = benchmark.runs.filter((run) => breakdown.dimension === "model" ? run.modelKey === breakdown.value : run.harnessKey === breakdown.value);
  const columnPool = breakdown.dimension === "model" ? benchmark.harnesses : benchmark.models;
  const columnKeys = [...new Set(filtered.map((run) => breakdown.dimension === "model" ? run.harnessKey : run.modelKey))];
  const columns = columnKeys.map((key) => identityByKey(columnPool, key)).filter(Boolean) as DisplayIdentitySummary[];
  const selectedRuns = filtered.filter((run) => selectedIds.includes(run.id));
  const selectedTaskKey = selectedRuns[0]?.taskKey || null;
  const titleIdentity = identityByKey(breakdown.dimension === "model" ? benchmark.models : benchmark.harnesses, breakdown.value);
  const compareDimension: ComparisonDimension = breakdown.dimension === "model" ? "harness" : "model";
  const preview = compareRunSummaries(selectedRuns, { dimension: compareDimension, referenceRunId: selectedRuns[0]?.id });

  return (
    <div className="view-stack breakdown-view">
      <button className="back-button" onClick={onBack}><span aria-hidden>←</span> 返回 Benchmark</button>
      <section className="breakdown-title"><div><p className="eyebrow">TASK BREAKDOWN</p><h1>{titleIdentity?.label || "Identity"}</h1><p>Task 按 digest 与 verifier identity 拆分；可选择 2–4 条轨迹。</p></div><div className="breakdown-count"><strong>{filtered.length}</strong><span>runs</span></div></section>
      {selectedIds.length > 1 && (
        <section className={`compatibility-banner ${preview.strict ? "strict" : "exploratory"}`}>
          <strong>{preview.strict ? "Strict compatible" : "Exploratory selection"}</strong>
          {!preview.strict && <span>{[...new Set(preview.excluded.flatMap((item) => item.reasons))].map((reason) => REASON_LABELS[reason] || reason).join(" · ") || "被比较维度不足两个不同 identity"}</span>}
        </section>
      )}
      <div className="task-table-wrap">
        <div className="task-table" style={{ "--task-columns": columns.length } as CSSProperties}>
          <div className="task-table-head task-name-head">TASK IDENTITY</div>
          {columns.map((column) => <div className="task-table-head" key={column.key}>{column.label}</div>)}
          {benchmark.tasks.map((task, index) => (
            <div className="task-row" key={task.key}>
              <div className="task-name-cell"><span className="task-index">T{String(index + 1).padStart(2, "0")}</span><strong>{task.taskId}</strong><small>task {shortDigest(task.taskDigest)} · verifier {shortDigest(task.verifierIdentity)}</small></div>
              {columns.map((column) => {
                const cellRuns = filtered.filter((run) => run.taskKey === task.key && (breakdown.dimension === "model" ? run.harnessKey === column.key : run.modelKey === column.key));
                return <div className="task-runs-cell" key={column.key}>{cellRuns.length ? cellRuns.map((run) => (
                  <RunChip key={run.id} run={run} selected={selectedIds.includes(run.id)} disabled={!selectedIds.includes(run.id) && selectedIds.length >= 4} onSelect={() => onToggleRun(run)} onOpen={() => onOpenRuns(task, [run.id])} />
                )) : <div className="no-run">没有轨迹</div>}</div>;
              })}
            </div>
          ))}
        </div>
      </div>
      {selectedIds.length > 0 && (
        <div className="compare-tray"><div className="selected-stack">{selectedRuns.map((run) => <span key={run.id}>{run.harness.harness_id.slice(0, 2).toUpperCase()}</span>)}</div><div className="tray-copy"><strong>已选择 {selectedIds.length} 条轨迹</strong><span>{selectedTaskKey ? benchmark.tasks.find((task) => task.key === selectedTaskKey)?.taskId : ""}</span></div><button className="primary-button" disabled={selectedIds.length < 2} onClick={() => { const task = benchmark.tasks.find((item) => item.key === selectedTaskKey); if (task) onOpenRuns(task, selectedIds); }}>{selectedIds.length < 2 ? "再选择一条轨迹" : `${preview.strict ? "Strict" : "Exploratory"} 对比`} <span aria-hidden>→</span></button></div>
      )}
    </div>
  );
}

function ProviderEvidence({ run }: { run: HitchRun }) {
  const [ordinal, setOrdinal] = useState(0);
  const [page, setPage] = useState<ProviderEvidencePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (cursor: string | null, append = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ run: run.id, view: "provider", file: String(ordinal) });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/hitch-trajectory?${query}`, { signal });
    if (!response.ok) throw new Error(`Provider evidence 读取失败 (${response.status})`);
    const value = await response.json() as ProviderEvidencePage;
    setPage((current) => append && current ? { ...value, content: current.content + value.content } : value);
    setError(null);
  }, [ordinal, run.id]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(null, false, controller.signal).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "无法读取 provider evidence");
    }), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);
  if (!run.trajectory.providerFiles) return <div className="lane-empty"><span>∅</span><strong>没有 Provider Evidence</strong><p>该 run 只保留 canonical view。</p></div>;
  return <div className="provider-panel"><label>Evidence file<select value={ordinal} onChange={(event) => setOrdinal(Number(event.target.value))}>{Array.from({ length: run.trajectory.providerFiles }, (_, index) => <option value={index} key={index}>File {index + 1}</option>)}</select></label>{error ? <p className="run-diagnostic">{error}</p> : page ? <><div className="provider-meta"><span>{page.file.role}</span><span>{page.file.mediaType}</span><span>{formatNumber(page.file.bytes)} bytes</span></div><pre>{page.encoding === "utf8" ? page.content : `[base64]\n${page.content}`}</pre>{page.nextCursor && <button className="text-button" onClick={() => load(page.nextCursor, true).catch((reason) => setError(String(reason)))}>加载更多</button>}</> : <div className="lane-empty"><strong>正在读取原始证据…</strong></div>}</div>;
}

function comparisonInsights(runs: HitchRun[]): string[] {
  if (!runs.every((run) => run.strictMetricEligible && run.observation.state === "valid")) return [];
  const rewards = [...runs].sort((left, right) => (right.observation.state === "valid" ? right.observation.reward : -Infinity) - (left.observation.state === "valid" ? left.observation.reward : -Infinity));
  const lowest = rewards.at(-1);
  const highest = rewards[0];
  const insights = [`观测 reward 范围为 ${formatReward(lowest?.observation.state === "valid" ? lowest.observation.reward : null)}–${formatReward(highest?.observation.state === "valid" ? highest.observation.reward : null)}。`];
  const tools = [...runs].sort((left, right) => (left.trajectory.summary?.toolCalls || 0) - (right.trajectory.summary?.toolCalls || 0));
  if ((tools[0]?.trajectory.summary?.toolCalls ?? null) !== (tools.at(-1)?.trajectory.summary?.toolCalls ?? null)) insights.push(`工具调用数从 ${tools[0].trajectory.summary?.toolCalls ?? "—"} 到 ${tools.at(-1)?.trajectory.summary?.toolCalls ?? "—"}。`);
  return insights;
}

function CompareView({ benchmark, compare, onBack }: { benchmark: HitchBenchmark; compare: CompareSelection; onBack: () => void }) {
  const runs = compare.runIds.map((id) => benchmark.runs.find((run) => run.id === id)).filter(Boolean) as HitchRun[];
  const task = benchmark.tasks.find((item) => item.key === compare.taskKey);
  const [evidenceView, setEvidenceView] = useState<EvidenceView>("canonical");
  const [syncScroll, setSyncScroll] = useState(true);
  const [actualDuration, setActualDuration] = useState(false);
  const [documents, setDocuments] = useState<Record<string, CanonicalTrajectoryDocument>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const syncing = useRef(false);
  const comparison = useMemo(() => compareRunSummaries(runs, { dimension: compare.dimension, referenceRunId: runs[0]?.id }), [compare.dimension, runs]);
  const reasons = [...new Set(comparison.excluded.flatMap((item) => item.reasons))];
  const insights = comparison.strict ? comparisonInsights(runs) : [];

  useEffect(() => {
    setActualDuration(window.localStorage.getItem("dsh-trajectory-actual-duration") === "true");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timers = runs.filter((run) => run.trajectory.hasCanonical).map((run) => window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/hitch-trajectory?run=${encodeURIComponent(run.id)}&view=canonical`, { signal: controller.signal });
        if (!response.ok) throw new Error(`读取失败 (${response.status})`);
        const value = await response.json() as CanonicalTrajectoryDocument;
        setDocuments((current) => ({ ...current, [run.id]: value }));
      } catch (error) {
        if (!controller.signal.aborted) setLoadErrors((current) => ({ ...current, [run.id]: error instanceof Error ? error.message : "无法读取 canonical trajectory" }));
      }
    }, 0));
    return () => { timers.forEach(window.clearTimeout); controller.abort(); };
  }, [compare.runIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateActualDuration = (value: boolean) => {
    setActualDuration(value);
    window.localStorage.setItem("dsh-trajectory-actual-duration", String(value));
  };
  const synchronize = (index: number) => {
    if (!syncScroll || syncing.current) return;
    const source = laneRefs.current[index];
    if (!source) return;
    const maximum = source.scrollHeight - source.clientHeight;
    const ratio = maximum > 0 ? source.scrollTop / maximum : 0;
    syncing.current = true;
    laneRefs.current.forEach((lane, laneIndex) => { if (lane && laneIndex !== index) lane.scrollTop = ratio * Math.max(0, lane.scrollHeight - lane.clientHeight); });
    requestAnimationFrame(() => { syncing.current = false; });
  };

  return (
    <div className="view-stack compare-view">
      <button className="back-button" onClick={onBack}><span aria-hidden>←</span> 返回任务 Breakdown</button>
      <section className="compare-heading"><div><p className="eyebrow">TRAJECTORY COMPARE</p><h1>{task?.taskId || "Run"}</h1><p>{runs.length === 1 ? "单条 canonical run 轨迹" : `${runs.length} 条轨迹并排查看`}</p></div><div className="compare-controls"><span className={`comparison-badge ${comparison.strict ? "strict" : "exploratory"}`}>{runs.length === 1 ? "Single" : comparison.strict ? "Strict" : "Exploratory"}</span><div className="filter-tabs"><button className={evidenceView === "canonical" ? "selected" : ""} onClick={() => setEvidenceView("canonical")}>Canonical View</button><button className={evidenceView === "provider" ? "selected" : ""} onClick={() => setEvidenceView("provider")}>Provider Evidence</button></div></div></section>
      {runs.length > 1 && !comparison.strict && <section className="exclusion-panel"><strong>本次选择仅供探索性查看，不生成性能优劣结论</strong>{reasons.length ? <ul>{reasons.map((reason) => <li key={reason}>{REASON_LABELS[reason] || reason}</li>)}</ul> : <p>被比较维度不足两个不同 identity。</p>}</section>}
      {insights.length > 0 && <section className="insight-panel"><div className="insight-title"><span>Δ</span><strong>Strict 差异</strong></div><div className="insight-list">{insights.map((insight) => <p key={insight}>{insight}</p>)}</div></section>}
      <div className="compare-grid summary-grid" style={{ "--lanes": runs.length } as CSSProperties}>
        {runs.map((run, index) => <article className="run-summary" key={run.id}><div className="lane-number">0{index + 1}</div><div className="run-summary-title"><div><strong>{harnessLabel(run)}</strong><span>{modelLabel(run)}</span></div><ExecutionBadge status={run.execution} /></div><div className="summary-metrics"><span><small>REWARD</small><strong>{run.observation.state === "valid" ? formatReward(run.observation.reward) : "—"}</strong></span><span><small>AGENT</small><strong>{formatDuration(agentDuration(run))}</strong></span><span><small>TOOLS</small><strong>{run.trajectory.summary?.toolCalls ?? "—"}</strong></span><span><small>INPUT</small><strong>{formatNumber(run.trajectory.summary?.usage.inputTokens ?? null)}</strong></span><span><small>TTFT</small><strong>{formatDuration(run.trajectory.summary?.ttftMs ?? null)}</strong></span><span><small>REASONING</small><strong>—</strong></span><span><small>COST</small><strong>—</strong></span></div><div className="phase-legend"><span><i className="phase-key phase-environment" />环境 <strong>{formatDuration(run.backendPhases?.environment ?? null)}</strong></span><span><i className="phase-key phase-setup" />安装 <strong>{formatDuration(run.backendPhases?.agentSetup ?? null)}</strong></span><span><i className="phase-key phase-verify" />Harbor 验证 <strong>{formatDuration(run.backendPhases?.verifier ?? null)}</strong></span></div><div className="identity-panel"><span>run {run.id}</span><span>{run.parent ? `${run.parent.eval_id} / ${run.parent.trial_id} / attempt ${run.parent.attempt}` : "no eval parent"}</span><span>requested harness {run.harness.requested_ref} · requested model {run.model.requested_id}</span><span>lifecycle {formatDuration(lifecycleDuration(run))} · protocol {shortDigest(run.protocol.environment_identity)} · params {shortDigest(run.model.parameters_sha256)}</span></div><div className="trajectory-badges"><span>{run.trajectory.evidenceFidelity === "provider_native" ? run.trajectory.hasCanonical ? "Native evidence + canonical view" : "Native evidence · no canonical view" : run.trajectory.evidenceFidelity || "no evidence"}</span><span>{run.trajectory.availability}</span>{run.trajectory.redactions.length > 0 && <span>{run.trajectory.redactions.reduce((sum, item) => sum + item.count, 0)} redactions</span>}</div></article>)}
      </div>
      {evidenceView === "canonical" && <>{runs.length > 1 && <div className="compare-toolbar compare-toolbar-sync"><label className="switch-label"><input type="checkbox" checked={syncScroll} onChange={(event) => setSyncScroll(event.target.checked)} /><span className="switch" />同步滚动</label></div>}<div className="compare-grid trace-grid" style={{ "--lanes": runs.length } as CSSProperties}>{runs.map((run, index) => { const document = documents[run.id]; return <section className="trace-lane dsh-trace-lane" key={run.id}><header><span className="lane-accent" /><strong>{run.harness.harness_id}</strong><span>{document ? `${document.summary.turnCount} turns · ${document.summary.toolCalls} calls` : "canonical"}</span></header>{document ? <DshTrajectory document={document} actualDuration={actualDuration} onActualDurationChange={updateActualDuration} setScrollElement={(node) => { laneRefs.current[index] = node; }} onLedgerScroll={() => synchronize(index)} /> : <div className="lane-empty"><span>∅</span><strong>{run.trajectory.availability === "raw_only" ? "只有 Provider Evidence" : loadErrors[run.id] ? "轨迹读取失败" : run.trajectory.hasCanonical ? "正在加载 Canonical View" : `Canonical ${run.trajectory.availability}`}</strong><p>{loadErrors[run.id] || run.trajectory.diagnostic || "没有可展示的 canonical trajectory。"}</p></div>}</section>; })}</div></>}
      {evidenceView === "provider" && <div className="compare-grid trace-grid" style={{ "--lanes": runs.length } as CSSProperties}>{runs.map((run) => <section className="trace-lane" key={run.id}><header><span className="lane-accent" /><strong>{run.harness.harness_id}</strong><span>{run.trajectory.providerFiles} files</span></header><ProviderEvidence run={run} /></section>)}</div>}
    </div>
  );
}

export function RearDashboard() {
  const [snapshot, setSnapshot] = useState<HitchSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [benchmarkKey, setBenchmarkKey] = useState<string | null>(null);
  const [mode, setMode] = useState<AggregationMode>("model");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [compare, setCompare] = useState<CompareSelection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/hitch-data", { cache: "no-store" });
      if (!response.ok) throw new Error(`读取失败 (${response.status})`);
      const value = await response.json() as HitchSnapshot;
      setSnapshot(value); setLoadError(null);
      setBenchmarkKey((current) => current && value.benchmarks.some((item) => item.key === current) ? current : value.benchmarks[0]?.key || null);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "无法读取本地 Hitch 数据"); }
  }, []);
  useEffect(() => { const initial = window.setTimeout(load, 0); const timer = window.setInterval(load, 10_000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [load]);
  const benchmark = useMemo(() => snapshot?.benchmarks.find((item) => item.key === benchmarkKey) || snapshot?.benchmarks[0] || null, [snapshot, benchmarkKey]);
  const toggleRun = (run: HitchRun) => setSelectedIds((current) => { if (current.includes(run.id)) return current.filter((id) => id !== run.id); const currentRuns = benchmark?.runs.filter((item) => current.includes(item.id)) || []; if (currentRuns.length && currentRuns[0].taskKey !== run.taskKey) return [run.id]; return current.length >= 4 ? current : [...current, run.id]; });
  const openBreakdown = (value: Breakdown) => { setBreakdown(value); setCompare(null); setSelectedIds([]); };
  if (!snapshot || !benchmark) {
    const missing = snapshot?.diagnostics.find((item) => ["hitch_data_root_not_configured", "run_centered_store_not_found"].includes(item.code));
    return <EmptyState error={loadError} message={snapshot ? missing?.message || "Run-centered store 中没有 benchmark_task run。" : undefined} onRetry={load} />;
  }
  return <div className="app-shell"><aside className="side-rail"><button className="brand" onClick={() => { setBreakdown(null); setCompare(null); }} aria-label="返回 Benchmark 总览"><span className="brand-glyph"><i /><i /><i /></span><strong>REAR</strong></button><nav aria-label="主导航"><button className={!breakdown && !compare ? "active" : ""} onClick={() => { setBreakdown(null); setCompare(null); }}><span>⌘</span>Overview</button><button className={breakdown && !compare ? "active" : ""} disabled={!breakdown} onClick={() => setCompare(null)}><span>≡</span>Breakdown</button><button className={compare ? "active" : ""} disabled={!compare}><span>⇆</span>Compare</button></nav><div className="rail-footer"><span className="connection-dot" /><div><strong>LOCAL</strong><small>{snapshot.diagnostics.length} diagnostics</small></div></div></aside><div className="workspace"><header className="topbar"><div className="breadcrumb"><span>Benchmarks</span><i>/</i><strong>{benchmark.id}@{benchmark.revision}</strong>{compare && <><i>/</i><span>trajectory compare</span></>}</div><div className="topbar-actions"><label className="benchmark-select"><span>Benchmark + revision</span><select value={benchmark.key} onChange={(event) => { setBenchmarkKey(event.target.value); setBreakdown(null); setCompare(null); setSelectedIds([]); }}>{snapshot.benchmarks.map((item) => <option key={item.key} value={item.key}>{item.id}@{item.revision}</option>)}</select></label><button className="refresh-button" onClick={load} title="立即刷新"><span>↻</span><span className="refresh-copy"><strong>自动刷新</strong><small>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(snapshot.generatedAt))}</small></span></button></div></header><main className="content">{compare ? <CompareView benchmark={benchmark} compare={compare} onBack={() => setCompare(null)} /> : breakdown ? <BreakdownView benchmark={benchmark} breakdown={breakdown} selectedIds={selectedIds} onToggleRun={toggleRun} onBack={() => { setBreakdown(null); setSelectedIds([]); }} onOpenRuns={(task, runIds) => setCompare({ taskKey: task.key, runIds, dimension: breakdown.dimension === "model" ? "harness" : "model" })} /> : <Overview benchmark={benchmark} mode={mode} onModeChange={setMode} onBreakdown={openBreakdown} />}</main></div></div>;
}
