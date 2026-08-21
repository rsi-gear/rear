import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  DisplayIdentitySummary,
  HitchBenchmark,
  HitchDiagnostic,
  HitchSnapshot,
  HudRunSummary,
  TaskIdentitySummary,
} from "./hitch-types";
import { parseEvalResult, trialMatchesRun, type LoadedEval } from "./hitch/eval-record";
import { modelIdentityLabel } from "./hitch/model-identity";
import { isTerminal, loadRun, type LoadedRun } from "./hitch/run-record";
import { RUN_ID_PATTERN, canonicalJson, compactError, readJsonFile } from "./hitch/validation";

const sealedRunCache = new Map<string, { manifestMtimeMs: number; loaded: LoadedRun }>();

function loadRunCached(directory: string, manifest: string): LoadedRun {
  const manifestMtimeMs = lstatSync(manifest).mtimeMs;
  const cached = sealedRunCache.get(directory);
  if (cached?.manifestMtimeMs === manifestMtimeMs) return structuredClone(cached.loaded);
  const loaded = loadRun(directory);
  if (loaded.sealed && isTerminal(loaded.record.status)) {
    sealedRunCache.set(directory, { manifestMtimeMs, loaded: structuredClone(loaded) });
    if (sealedRunCache.size > 1_000) sealedRunCache.delete(sealedRunCache.keys().next().value as string);
  }
  return loaded;
}

export function clearHitchScannerCache(): void {
  sealedRunCache.clear();
}

function childDirectories(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    try {
      const info = lstatSync(path);
      return info.isDirectory() && !info.isSymbolicLink() ? [path] : [];
    } catch {
      return [];
    }
  });
}

function diagnostic(
  code: string,
  severity: HitchDiagnostic["severity"],
  scope: HitchDiagnostic["scope"],
  objectId: string | null,
  message: string,
): HitchDiagnostic {
  return { code, severity, scope, objectId, message };
}

function loadEval(directory: string): LoadedEval {
  const id = basename(directory);
  const resultPath = join(directory, "result.json");
  if (!existsSync(resultPath)) {
    return {
      id,
      result: null,
      state: "pending",
      diagnostic: diagnostic(
        "eval_pending_runs",
        "pending",
        "eval",
        id,
        "Eval 尚未发布 result.json；run bundle 可能仍在执行或导入中。",
      ),
    };
  }
  try {
    return { id, result: parseEvalResult(readJsonFile(resultPath, "eval result"), id), state: "complete", diagnostic: null };
  } catch (error) {
    return {
      id,
      result: null,
      state: "corrupt",
      diagnostic: diagnostic("corrupt_eval_result", "error", "eval", id, compactError(error)),
    };
  }
}

function modelIdentity(run: HudRunSummary): DisplayIdentitySummary {
  const unresolved = run.model.identity_resolved !== true;
  return {
    key: run.modelKey,
    label: modelIdentityLabel(run.model, { includeParameters: true }),
    unresolved,
  };
}

function harnessIdentity(run: HudRunSummary): DisplayIdentitySummary {
  const revision = run.harness.revision_identity?.slice("sha256:".length, "sha256:".length + 10) || "unresolved";
  const artifact = run.harness.artifact_id ? ` · artifact ${run.harness.artifact_id.slice(7, 15)}` : "";
  const args = run.harness.agent_args_sha256 ? ` · args ${run.harness.agent_args_sha256.slice(7, 15)}` : "";
  return {
    key: run.harnessKey,
    label: `${run.harness.harness_id}@${revision}${artifact}${args}`,
    unresolved: run.harness.revision_identity === null,
  };
}

function taskIdentity(run: HudRunSummary): TaskIdentitySummary | null {
  if (run.context.kind !== "benchmark_task" || !run.taskKey) return null;
  return {
    key: run.taskKey,
    taskId: run.context.task_id,
    taskDigest: run.context.task_digest,
    verifierIdentity: run.context.verifier_identity,
  };
}

function benchmarkLabel(id: string): string {
  return id.split(/[-_]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") || id;
}

function buildBenchmarks(runs: HudRunSummary[]): HitchBenchmark[] {
  const groups = new Map<string, HitchBenchmark>();
  for (const run of runs) {
    if (run.context.kind !== "benchmark_task") continue;
    const key = canonicalJson({ id: run.context.benchmark_id, revision: run.context.benchmark_revision });
    let benchmark = groups.get(key);
    if (!benchmark) {
      benchmark = {
        key,
        id: run.context.benchmark_id,
        label: benchmarkLabel(run.context.benchmark_id),
        revision: run.context.benchmark_revision,
        tasks: [],
        models: [],
        harnesses: [],
        runs: [],
      };
      groups.set(key, benchmark);
    }
    benchmark.runs.push(run);
    const task = taskIdentity(run);
    if (task && !benchmark.tasks.some((item) => item.key === task.key)) benchmark.tasks.push(task);
    const model = modelIdentity(run);
    if (!benchmark.models.some((item) => item.key === model.key)) benchmark.models.push(model);
    const harness = harnessIdentity(run);
    if (!benchmark.harnesses.some((item) => item.key === harness.key)) benchmark.harnesses.push(harness);
  }
  return [...groups.values()].map((benchmark) => {
    benchmark.runs.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    benchmark.tasks.sort((left, right) => left.taskId.localeCompare(right.taskId) || left.key.localeCompare(right.key));
    benchmark.models.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
    benchmark.harnesses.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
    return benchmark;
  }).sort((left, right) => left.label.localeCompare(right.label) || left.revision.localeCompare(right.revision));
}

function corruptJoin(run: LoadedRun, reasons: string[]): void {
  run.summary.integrity = "corrupt";
  run.summary.strictMetricEligible = false;
  run.summary.exclusionReasons = [...new Set([...run.summary.exclusionReasons, "infrastructure_failure"])];
  run.issues.push(...reasons);
}

export function scanHitch(root: string): HitchSnapshot {
  const diagnostics: HitchDiagnostic[] = [];
  const runsRoot = join(root, "runs");
  const evalsRoot = join(root, "evals");
  if (!existsSync(runsRoot) && !existsSync(evalsRoot)) {
    return {
      schemaVersion: "run-centered-v1",
      generatedAt: new Date().toISOString(),
      benchmarks: [],
      runs: [],
      diagnostics: [diagnostic(
        "run_centered_store_not_found",
        "warning",
        "store",
        null,
        "未发现 runs/ 或 evals/；REAR 不会回退扫描旧 namespace/Harbor trial 布局。",
      )],
    };
  }

  const loadedRuns = new Map<string, LoadedRun>();
  for (const directory of childDirectories(runsRoot)) {
    const id = basename(directory);
    if (!RUN_ID_PATTERN.test(id)) {
      if (id.startsWith("run_")) diagnostics.push(diagnostic("invalid_run_directory", "error", "run", id, "Run 目录名不符合 run_<32 lowercase hex>。"));
      continue;
    }
    const manifest = join(directory, "manifest.json");
    if (!existsSync(manifest)) {
      diagnostics.push(diagnostic("run_manifest_missing", "error", "run", id, "Run 缺少 manifest.json。"));
      continue;
    }
    try {
      const loaded = loadRunCached(directory, manifest);
      loadedRuns.set(loaded.record.run_id, loaded);
      for (const issue of loaded.issues) diagnostics.push(diagnostic("corrupt_run_record", "error", "run", id, issue));
      if (loaded.trajectoryLoad.availability === "unsupported") {
        const legacyRef = loaded.trajectoryLoad.diagnostic === "unsupported_trajectory_ref";
        diagnostics.push(diagnostic(
          legacyRef ? "unsupported_trajectory_ref" : "unsupported_canonical_session",
          "warning",
          "trajectory",
          id,
          legacyRef ? "仅支持 TrajectoryRef V2，未读取旧 ref 指向的路径。" : (loaded.trajectoryLoad.diagnostic || "Canonical session 格式不受支持。"),
        ));
      }
    } catch (error) {
      diagnostics.push(diagnostic("corrupt_run_manifest", "error", "run", id, compactError(error)));
    }
  }

  const evals = new Map<string, LoadedEval>();
  for (const directory of childDirectories(evalsRoot)) {
    if (!basename(directory).startsWith("eval_")) continue;
    const loaded = loadEval(directory);
    evals.set(loaded.id, loaded);
    if (loaded.diagnostic) diagnostics.push(loaded.diagnostic);
  }

  const joinedRuns = new Set<string>();
  for (const loadedEval of evals.values()) {
    if (!loadedEval.result) continue;
    for (const trial of loadedEval.result.trials) {
      const run = loadedRuns.get(trial.run_id);
      if (!run) {
        diagnostics.push(diagnostic("eval_run_missing", "error", "eval", loadedEval.id, `Trial ${trial.trial_id} 引用的 run 未发布。`));
        continue;
      }
      joinedRuns.add(run.record.run_id);
      const reasons = trialMatchesRun(loadedEval.result, trial, run);
      if (reasons.length) {
        corruptJoin(run, reasons);
        diagnostics.push(diagnostic("eval_run_link_corrupt", "error", "run", run.record.run_id, `Eval/run 关联不一致：${reasons.join("；")}`));
      }
    }
  }

  for (const run of loadedRuns.values()) {
    const parent = run.record.parent;
    if (!parent || joinedRuns.has(run.record.run_id)) continue;
    const linkedEval = evals.get(parent.eval_id);
    if (linkedEval?.state === "pending") continue;
    corruptJoin(run, [linkedEval ? "run parent is absent from eval trials" : "parent eval is missing"]);
    diagnostics.push(diagnostic(
      linkedEval ? "run_eval_trial_missing" : "run_parent_eval_missing",
      "error",
      "run",
      run.record.run_id,
      linkedEval ? "Run parent 未在对应 eval result.trials 中反向引用。" : "Run parent 指向不存在的 eval。",
    ));
  }

  for (const run of loadedRuns.values()) {
    if (!isTerminal(run.record.status) && run.summary.integrity !== "corrupt") run.summary.integrity = "pending";
  }
  const summaries = [...loadedRuns.values()].map((run) => run.summary)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return {
    schemaVersion: "run-centered-v1",
    generatedAt: new Date().toISOString(),
    benchmarks: buildBenchmarks(summaries),
    runs: summaries,
    diagnostics,
  };
}

export function unconfiguredHitchSnapshot(): HitchSnapshot {
  return {
    schemaVersion: "run-centered-v1",
    generatedAt: new Date().toISOString(),
    benchmarks: [],
    runs: [],
    diagnostics: [diagnostic(
      "hitch_data_root_not_configured",
      "warning",
      "store",
      null,
      "未配置 HITCH_DATA_ROOT；REAR 不会猜测本机 Hitch 数据目录。",
    )],
  };
}

export function findIndexedRun(root: string, runId: string): LoadedRun | null {
  if (!RUN_ID_PATTERN.test(runId)) return null;
  const directory = join(root, "runs", runId);
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return loadRunCached(directory, join(directory, "manifest.json"));
  } catch {
    return null;
  }
}
