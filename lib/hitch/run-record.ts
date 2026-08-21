import { basename } from "node:path";
import type {
  EvalRunParentV1,
  HarnessIdentityV1,
  HudObservation,
  HudRunSummary,
  ModelIdentityV1,
  ProtocolIdentityV1,
  RunContextV1,
  RunExecutionStatus,
  RunObservationV1,
  RunRecordV1,
} from "../hitch-types";
import { effectiveModelIdentity } from "./model-identity";
import { loadTrajectory, type TrajectoryLoadResult } from "./trajectory-ref";
import {
  RUN_ID_PATTERN,
  canonicalJson,
  compactError,
  finiteNumber,
  integer,
  isoTimestamp,
  optionalString,
  readJsonFile,
  record,
  relativeRef,
  resolveInside,
  sha256,
  string,
} from "./validation";

const EXECUTION = new Set<RunExecutionStatus>([
  "queued", "preparing", "running", "succeeded", "failed", "timed_out", "cancelled",
]);

export interface LoadedRun {
  record: RunRecordV1;
  summary: HudRunSummary;
  directory: string;
  sealed: boolean;
  verifierStatus: "valid" | "missing" | "not_applicable";
  recordStatus: "valid" | "corrupt";
  trajectoryLoad: TrajectoryLoadResult;
  issues: string[];
}

export function isTerminal(status: RunExecutionStatus): boolean {
  return ["succeeded", "failed", "timed_out", "cancelled"].includes(status);
}

function context(value: unknown): RunContextV1 {
  const parsed = record(value, "run context");
  const kind = string(parsed.kind, "run context kind");
  if (kind === "ad_hoc") return { kind };
  if (kind === "seed_task") {
    return {
      kind,
      seed_task_id: string(parsed.seed_task_id, "seed_task_id"),
      seed_task_digest: sha256(parsed.seed_task_digest, "seed_task_digest"),
      ...(optionalString(parsed.seed_set_id, "seed_set_id") ? { seed_set_id: parsed.seed_set_id as string } : {}),
      ...(optionalString(parsed.seed_set_revision, "seed_set_revision") ? { seed_set_revision: parsed.seed_set_revision as string } : {}),
      ...(optionalString(parsed.iteration_id, "iteration_id") ? { iteration_id: parsed.iteration_id as string } : {}),
    };
  }
  if (kind === "benchmark_task") {
    const revision = string(parsed.benchmark_revision, "benchmark_revision");
    if (revision.toLowerCase() === "latest") throw new TypeError("benchmark_revision must be immutable");
    return {
      kind,
      benchmark_id: string(parsed.benchmark_id, "benchmark_id"),
      benchmark_revision: revision,
      task_id: string(parsed.task_id, "task_id"),
      task_digest: sha256(parsed.task_digest, "task_digest"),
      verifier_identity: sha256(parsed.verifier_identity, "verifier_identity"),
    };
  }
  throw new TypeError(`invalid run context kind: ${kind}`);
}

function parent(value: unknown): EvalRunParentV1 {
  const parsed = record(value, "run parent");
  if (parsed.kind !== "eval") throw new TypeError("run parent kind must be eval");
  const attempt = integer(parsed.attempt, "parent attempt");
  if (attempt <= 0) throw new TypeError("parent attempt must be positive");
  return {
    kind: "eval",
    eval_id: string(parsed.eval_id, "parent eval_id"),
    trial_id: string(parsed.trial_id, "parent trial_id"),
    attempt,
  };
}

function observation(value: unknown): RunObservationV1 {
  const parsed = record(value, "run observation");
  if (parsed.status !== "valid" && parsed.status !== "invalid") throw new TypeError("invalid observation status");
  const verifier = parsed.verifier_result_ref === undefined
    ? undefined
    : relativeRef(parsed.verifier_result_ref, "verifier_result_ref");
  if (parsed.status === "valid") {
    const reward = finiteNumber(parsed.reward, "observation reward");
    if (!verifier) throw new TypeError("valid observation must include verifier_result_ref");
    if (parsed.invalid_reason !== undefined) throw new TypeError("valid observation cannot include invalid_reason");
    return { status: "valid", reward, verifier_result_ref: verifier };
  }
  if (parsed.reward !== undefined) throw new TypeError("invalid observation cannot include reward");
  return {
    status: "invalid",
    invalid_reason: string(parsed.invalid_reason, "invalid_reason"),
    ...(verifier ? { verifier_result_ref: verifier } : {}),
  };
}

function harness(value: unknown): HarnessIdentityV1 {
  const parsed = record(value, "manifest harness");
  return {
    harness_id: string(parsed.harness_id, "harness_id"),
    requested_ref: string(parsed.requested_ref, "harness requested_ref"),
    revision_identity: parsed.revision_identity === null ? null : sha256(parsed.revision_identity, "revision_identity"),
    ...(parsed.artifact_id !== undefined ? { artifact_id: sha256(parsed.artifact_id, "artifact_id") } : {}),
    ...(parsed.agent_args_sha256 !== undefined ? { agent_args_sha256: sha256(parsed.agent_args_sha256, "agent_args_sha256") } : {}),
  };
}

function model(value: unknown): ModelIdentityV1 {
  const parsed = record(value, "manifest model");
  if (parsed.identity_resolved !== undefined && typeof parsed.identity_resolved !== "boolean") {
    throw new TypeError("model identity_resolved must be boolean");
  }
  return {
    requested_id: string(parsed.requested_id, "model requested_id"),
    effective_id: string(parsed.effective_id, "model effective_id"),
    ...(optionalString(parsed.provider, "model provider") ? { provider: parsed.provider as string } : {}),
    ...(parsed.parameters_sha256 !== undefined ? { parameters_sha256: sha256(parsed.parameters_sha256, "parameters_sha256") } : {}),
    ...(parsed.identity_resolved !== undefined ? { identity_resolved: parsed.identity_resolved as boolean } : {}),
  };
}

function protocol(value: unknown): ProtocolIdentityV1 {
  const parsed = record(value, "manifest protocol");
  const timeout = integer(parsed.timeout_ms, "protocol timeout_ms");
  if (timeout < 0) throw new TypeError("protocol timeout_ms must be non-negative");
  return {
    timeout_ms: timeout,
    workspace_mode: string(parsed.workspace_mode, "protocol workspace_mode"),
    ...(parsed.initial_workspace_digest !== undefined ? { initial_workspace_digest: sha256(parsed.initial_workspace_digest, "initial_workspace_digest") } : {}),
    ...(parsed.environment_identity !== undefined ? { environment_identity: sha256(parsed.environment_identity, "environment_identity") } : {}),
    ...(parsed.tool_policy_sha256 !== undefined ? { tool_policy_sha256: sha256(parsed.tool_policy_sha256, "tool_policy_sha256") } : {}),
  };
}

export function parseRunRecord(value: unknown, directoryName?: string): RunRecordV1 {
  const parsed = record(value, "run manifest");
  const runId = string(parsed.run_id, "run_id");
  if (!RUN_ID_PATTERN.test(runId)) throw new TypeError("run_id must match run_<32 lowercase hex>");
  if (directoryName && directoryName !== runId) throw new TypeError("run_id does not match directory name");
  const status = string(parsed.status, "run status") as RunExecutionStatus;
  if (!EXECUTION.has(status)) throw new TypeError(`invalid run status: ${status}`);
  const resultRef = parsed.result_ref === undefined
    ? (isTerminal(status) ? "result.json" : undefined)
    : relativeRef(parsed.result_ref, "result_ref");
  return {
    run_id: runId,
    context: context(parsed.context),
    ...(parsed.parent !== undefined ? { parent: parent(parsed.parent) } : {}),
    status,
    harness: harness(parsed.harness),
    model: model(parsed.model),
    protocol: protocol(parsed.protocol),
    ...(parsed.observation !== undefined ? { observation: observation(parsed.observation) } : {}),
    request_ref: relativeRef(parsed.request_ref, "request_ref"),
    resolution_ref: relativeRef(parsed.resolution_ref, "resolution_ref"),
    ...(resultRef ? { result_ref: resultRef } : {}),
    ...(parsed.trajectory_ref !== undefined ? { trajectory_ref: relativeRef(parsed.trajectory_ref, "trajectory_ref") } : {}),
    created_at: isoTimestamp(parsed.created_at, "created_at"),
    ...(parsed.completed_at !== undefined ? { completed_at: isoTimestamp(parsed.completed_at, "completed_at") } : {}),
  };
}

function hudObservation(run: RunRecordV1): HudObservation {
  if (run.context.kind !== "benchmark_task") return { state: "not_applicable" };
  if (!run.observation) return isTerminal(run.status) ? { state: "invalid", reason: "verifier_result_missing" } : { state: "pending" };
  if (run.observation.status === "valid") return { state: "valid", reward: run.observation.reward! };
  return { state: "invalid", reason: run.observation.invalid_reason! };
}

function taskKey(run: RunRecordV1): string | null {
  if (run.context.kind !== "benchmark_task") return null;
  const value = run.context;
  return canonicalJson({
    benchmark_id: value.benchmark_id,
    benchmark_revision: value.benchmark_revision,
    task_id: value.task_id,
    task_digest: value.task_digest,
    verifier_identity: value.verifier_identity,
  });
}

function resultError(value: unknown): { code: string; message: string } | null {
  if (value === null || value === undefined) return null;
  const parsed = record(value, "result error");
  return { code: string(parsed.code, "result error code"), message: string(parsed.message, "result error message") };
}

export function loadRun(runDirectory: string): LoadedRun {
  const directoryName = basename(runDirectory);
  const manifestValue = readJsonFile(`${runDirectory}/manifest.json`, "run manifest");
  const manifestObject = record(manifestValue, "run manifest");
  const run = parseRunRecord(manifestValue, directoryName);
  const issues: string[] = [];
  let recordStatus: LoadedRun["recordStatus"] = "valid";
  let result: HudRunSummary["result"] = { startedAt: null, completedAt: null, error: null };

  for (const [ref, label] of [[run.request_ref, "request"], [run.resolution_ref, "resolution"]] as const) {
    try { readJsonFile(resolveInside(runDirectory, ref), `${label} ref`); } catch (error) {
      recordStatus = "corrupt";
      issues.push(`${label} ref: ${compactError(error)}`);
    }
  }
  if (isTerminal(run.status)) {
    if (!run.result_ref) {
      recordStatus = "corrupt";
      issues.push("terminal run has no result_ref");
    } else {
      try {
        const raw = record(readJsonFile(resolveInside(runDirectory, run.result_ref), "run result"), "run result");
        if (raw.run_id !== run.run_id || raw.status !== run.status) throw new TypeError("result identity or status does not match manifest");
        result = {
          startedAt: raw.started_at === undefined ? null : isoTimestamp(raw.started_at, "result started_at"),
          completedAt: raw.completed_at === undefined ? null : isoTimestamp(raw.completed_at, "result completed_at"),
          error: resultError(raw.error),
        };
      } catch (error) {
        recordStatus = "corrupt";
        issues.push(`result ref: ${compactError(error)}`);
      }
    }
  } else if (run.result_ref) {
    try {
      const raw = record(readJsonFile(resolveInside(runDirectory, run.result_ref), "run result"), "run result");
      result = {
        startedAt: raw.started_at === undefined ? null : isoTimestamp(raw.started_at, "result started_at"),
        completedAt: raw.completed_at === undefined ? null : isoTimestamp(raw.completed_at, "result completed_at"),
        error: resultError(raw.error),
      };
    } catch (error) {
      recordStatus = "corrupt";
      issues.push(`result ref: ${compactError(error)}`);
    }
  }

  let verifierStatus: LoadedRun["verifierStatus"] = run.context.kind === "benchmark_task" ? "missing" : "not_applicable";
  if (run.observation?.verifier_result_ref) {
    try {
      readJsonFile(resolveInside(runDirectory, run.observation.verifier_result_ref), "verifier result");
      verifierStatus = "valid";
    } catch (error) {
      recordStatus = "corrupt";
      issues.push(`verifier result: ${compactError(error)}`);
    }
  }
  if (isTerminal(run.status) && run.context.kind === "benchmark_task" && !run.observation) {
    recordStatus = "corrupt";
    issues.push("terminal benchmark run has no observation");
  }

  const trajectoryLoad = loadTrajectory(runDirectory, run.run_id, run.trajectory_ref, isTerminal(run.status));
  if (trajectoryLoad.availability === "corrupt") {
    recordStatus = "corrupt";
    issues.push(`trajectory: ${trajectoryLoad.diagnostic || "corrupt"}`);
  }
  const observationValue = hudObservation(run);
  const exclusionReasons: string[] = [];
  if (!["available", "raw_only"].includes(trajectoryLoad.availability)) exclusionReasons.push("trajectory_missing_or_corrupt");
  if (recordStatus !== "valid") exclusionReasons.push("infrastructure_failure");
  if (run.context.kind === "benchmark_task" && verifierStatus !== "valid") exclusionReasons.push("verifier_result_missing");
  if (observationValue.state === "invalid") exclusionReasons.push(observationValue.reason || "infrastructure_failure");
  if (run.status === "cancelled") exclusionReasons.push("cancelled");
  const integrity = recordStatus === "corrupt" ? "corrupt" : (!isTerminal(run.status) ? "pending" : "valid");
  const summary: HudRunSummary = {
    id: run.run_id,
    evalId: run.parent?.eval_id || null,
    parent: run.parent || null,
    context: run.context,
    execution: run.status,
    observation: observationValue,
    integrity,
    harness: run.harness,
    model: run.model,
    protocol: run.protocol,
    result,
    trajectory: {
      availability: trajectoryLoad.availability,
      refSchema: trajectoryLoad.ref ? "2" : null,
      evidenceFidelity: trajectoryLoad.ref?.fidelity || null,
      provider: trajectoryLoad.ref?.provider || null,
      providerSessionId: trajectoryLoad.ref?.provider_session_id || null,
      hasCanonical: Boolean(trajectoryLoad.canonical),
      providerFiles: trajectoryLoad.providers.length,
      redactions: (trajectoryLoad.ref?.redactions || []).map((item) => ({ ruleId: item.rule_id, count: item.count })),
      summary: trajectoryLoad.canonical?.summary || null,
      diagnostic: trajectoryLoad.diagnostic,
    },
    backendPhases: null,
    createdAt: run.created_at,
    completedAt: run.completed_at || null,
    taskKey: taskKey(run),
    harnessKey: canonicalJson(run.harness),
    modelKey: canonicalJson(effectiveModelIdentity(run.model)),
    strictMetricEligible:
      run.context.kind === "benchmark_task"
      && observationValue.state === "valid"
      && integrity === "valid"
      && ["available", "raw_only"].includes(trajectoryLoad.availability)
      && verifierStatus === "valid",
    exclusionReasons: [...new Set(exclusionReasons)],
  };
  return {
    record: run,
    summary,
    directory: runDirectory,
    sealed: manifestObject.sealed === true,
    verifierStatus,
    recordStatus,
    trajectoryLoad,
    issues,
  };
}
