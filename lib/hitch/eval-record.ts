import type { EvalResultV1, EvalTrialRefV1, HitchDiagnostic } from "../hitch-types";
import { RUN_ID_PATTERN, finiteNumber, integer, isoTimestamp, record, string } from "./validation";

export interface LoadedEval {
  id: string;
  result: EvalResultV1 | null;
  state: "pending" | "complete" | "corrupt";
  diagnostic: HitchDiagnostic | null;
}

function trial(value: unknown, index: number): EvalTrialRefV1 {
  const parsed = record(value, `eval trial ${index}`);
  const runId = string(parsed.run_id, `eval trial ${index} run_id`);
  if (!RUN_ID_PATTERN.test(runId)) throw new TypeError(`eval trial ${index} has invalid run_id`);
  const attempt = integer(parsed.attempt, `eval trial ${index} attempt`);
  if (attempt <= 0) throw new TypeError(`eval trial ${index} attempt must be positive`);
  if (parsed.observation_status !== "valid" && parsed.observation_status !== "invalid") {
    throw new TypeError(`eval trial ${index} has invalid observation_status`);
  }
  const base = {
    trial_id: string(parsed.trial_id, `eval trial ${index} trial_id`),
    run_id: runId,
    task_id: string(parsed.task_id, `eval trial ${index} task_id`),
    attempt,
    observation_status: parsed.observation_status,
  } as EvalTrialRefV1;
  if (parsed.observation_status === "valid") {
    base.reward = finiteNumber(parsed.reward, `eval trial ${index} reward`);
    if (parsed.invalid_reason !== undefined) throw new TypeError(`valid eval trial ${index} cannot include invalid_reason`);
  } else {
    if (parsed.reward !== undefined) throw new TypeError(`invalid eval trial ${index} cannot include reward`);
    base.invalid_reason = string(parsed.invalid_reason, `eval trial ${index} invalid_reason`);
  }
  if (parsed.verifier_result_ref !== undefined) {
    base.verifier_result_ref = string(parsed.verifier_result_ref, `eval trial ${index} verifier_result_ref`);
  }
  return base;
}

export function parseEvalResult(value: unknown, directoryName?: string): EvalResultV1 {
  const parsed = record(value, "eval result");
  if (parsed.schema_version !== "1") throw new TypeError("unsupported eval result schema_version");
  const evalId = string(parsed.eval_id, "eval_id");
  if (directoryName && directoryName !== evalId) throw new TypeError("eval_id does not match directory name");
  if (!["succeeded", "failed", "cancelled"].includes(String(parsed.status))) throw new TypeError("invalid eval status");
  if (!Array.isArray(parsed.trials)) throw new TypeError("eval trials must be an array");
  const trials = parsed.trials.map(trial);
  if (new Set(trials.map((item) => item.trial_id)).size !== trials.length) throw new TypeError("eval trial_id values must be unique");
  if (new Set(trials.map((item) => item.run_id)).size !== trials.length) throw new TypeError("eval run_id values must be unique");
  return {
    schema_version: "1",
    eval_id: evalId,
    benchmark_id: string(parsed.benchmark_id, "eval benchmark_id"),
    benchmark_revision: string(parsed.benchmark_revision, "eval benchmark_revision"),
    status: parsed.status as EvalResultV1["status"],
    trials,
    started_at: isoTimestamp(parsed.started_at, "eval started_at"),
    completed_at: isoTimestamp(parsed.completed_at, "eval completed_at"),
  };
}

export function trialMatchesRun(evalResult: EvalResultV1, trialRef: EvalTrialRefV1, run: import("./run-record").LoadedRun): string[] {
  const reasons: string[] = [];
  const parent = run.record.parent;
  const context = run.record.context;
  const observation = run.record.observation;
  if (!parent || parent.eval_id !== evalResult.eval_id) reasons.push("eval_id mismatch");
  if (!parent || parent.trial_id !== trialRef.trial_id) reasons.push("trial_id mismatch");
  if (!parent || parent.attempt !== trialRef.attempt) reasons.push("attempt mismatch");
  if (context.kind !== "benchmark_task") reasons.push("run is not a benchmark task");
  else {
    if (context.benchmark_id !== evalResult.benchmark_id) reasons.push("benchmark_id mismatch");
    if (context.benchmark_revision !== evalResult.benchmark_revision) reasons.push("benchmark_revision mismatch");
    if (context.task_id !== trialRef.task_id) reasons.push("task_id mismatch");
  }
  if (!observation || observation.status !== trialRef.observation_status) reasons.push("observation status mismatch");
  if ((observation?.reward ?? undefined) !== trialRef.reward) reasons.push("reward mismatch");
  if ((observation?.verifier_result_ref ?? undefined) !== trialRef.verifier_result_ref) reasons.push("verifier_result_ref mismatch");
  if ((observation?.invalid_reason ?? undefined) !== trialRef.invalid_reason) reasons.push("invalid_reason mismatch");
  return reasons;
}
