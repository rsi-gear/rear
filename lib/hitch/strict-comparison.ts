import type {
  ComparisonDimension,
  HudRunSummary,
  StrictComparisonResult,
} from "../hitch-types";
import { effectiveModelIdentity } from "./model-identity";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const IDENTITY_EXCLUSIONS = new Set([
  "not_benchmark_task", "benchmark_reference_missing", "benchmark_revision_mismatch",
  "task_digest_mismatch", "verifier_identity_mismatch", "protocol_identity_mismatch",
  "harness_identity_mismatch", "model_identity_mismatch", "harness_identity_unresolved",
  "model_identity_unresolved",
]);

function mismatches(reference: HudRunSummary, run: HudRunSummary, dimension: ComparisonDimension): string[] {
  const left = reference.context;
  const right = run.context;
  if (left.kind !== "benchmark_task" || right.kind !== "benchmark_task") return [];
  const reasons: string[] = [];
  if (left.benchmark_id !== right.benchmark_id || left.benchmark_revision !== right.benchmark_revision || left.task_id !== right.task_id) {
    reasons.push("benchmark_revision_mismatch");
  }
  if (left.task_digest !== right.task_digest) reasons.push("task_digest_mismatch");
  if (left.verifier_identity !== right.verifier_identity) reasons.push("verifier_identity_mismatch");
  if (canonicalJson(reference.protocol) !== canonicalJson(run.protocol)) reasons.push("protocol_identity_mismatch");
  if (dimension === "model" && canonicalJson(reference.harness) !== canonicalJson(run.harness)) reasons.push("harness_identity_mismatch");
  if (
    dimension === "harness"
    && canonicalJson(effectiveModelIdentity(reference.model)) !== canonicalJson(effectiveModelIdentity(run.model))
  ) reasons.push("model_identity_mismatch");
  return reasons;
}

export function compareRunSummaries(
  runs: HudRunSummary[],
  { dimension, referenceRunId }: { dimension: ComparisonDimension; referenceRunId?: string },
): StrictComparisonResult {
  const reference = referenceRunId
    ? runs.find((run) => run.id === referenceRunId)
    : runs.find((run) => run.context.kind === "benchmark_task");
  const excluded: StrictComparisonResult["excluded"] = [];
  const unresolved: StrictComparisonResult["unresolved_identities"] = [];
  const groups = new Map<string, StrictComparisonResult["groups"][number]>();

  for (const run of runs) {
    const reasons: string[] = [];
    if (run.context.kind !== "benchmark_task") reasons.push("not_benchmark_task");
    if (!reference || reference.context.kind !== "benchmark_task") {
      if (!reasons.includes("not_benchmark_task")) reasons.push("benchmark_reference_missing");
    } else if (run.context.kind === "benchmark_task") {
      reasons.push(...mismatches(reference, run, dimension));
    }
    if (run.harness.revision_identity === null) {
      reasons.push("harness_identity_unresolved");
      unresolved.push({ run_id: run.id, identity: "harness" });
    }
    if (run.model.identity_resolved !== true || !run.model.provider || !run.model.effective_id) {
      reasons.push("model_identity_unresolved");
      unresolved.push({ run_id: run.id, identity: "model" });
    }
    reasons.push(...run.exclusionReasons);

    const canGroup = !reasons.some((reason) => IDENTITY_EXCLUSIONS.has(reason)) && Boolean(reference) && run.context.kind === "benchmark_task";
    if (canGroup) {
      const identity = dimension === "model" ? run.model : run.harness;
      const key = dimension === "model"
        ? canonicalJson(effectiveModelIdentity(run.model))
        : canonicalJson(run.harness);
      let group = groups.get(key);
      if (!group) {
        group = {
          identity,
          run_ids: [],
          valid_observations: 0,
          rewards: { count: 0, mean: null, min: null, max: null },
          agent_failures: 0,
          invalid_run_ids: [],
        };
        groups.set(key, group);
      }
      if (run.execution !== "succeeded") group.agent_failures += 1;
      if (run.strictMetricEligible && run.observation.state === "valid") {
        group.run_ids.push(run.id);
        group.valid_observations += 1;
        const reward = run.observation.reward;
        const oldCount = group.rewards.count;
        group.rewards.count += 1;
        group.rewards.mean = (((group.rewards.mean || 0) * oldCount) + reward) / group.rewards.count;
        group.rewards.min = group.rewards.min === null ? reward : Math.min(group.rewards.min, reward);
        group.rewards.max = group.rewards.max === null ? reward : Math.max(group.rewards.max, reward);
      } else {
        group.invalid_run_ids.push(run.id);
      }
    }
    if (reasons.length) excluded.push({ run_id: run.id, reasons: [...new Set(reasons)] });
  }
  const resultGroups = [...groups.values()].sort((left, right) => canonicalJson(left.identity).localeCompare(canonicalJson(right.identity)));
  return {
    schema_version: "1",
    dimension,
    strict: Boolean(reference) && resultGroups.length >= 2 && !unresolved.some((item) => item.identity === dimension),
    reference_run_id: reference?.id || null,
    groups: resultGroups,
    excluded,
    unresolved_identities: unresolved,
  };
}

export function exploratoryReasons(runs: HudRunSummary[], referenceRunId?: string): string[] {
  if (runs.length < 2) return [];
  const model = compareRunSummaries(runs, { dimension: "model", referenceRunId });
  if (model.strict) return [];
  const harness = compareRunSummaries(runs, { dimension: "harness", referenceRunId });
  if (harness.strict) return [];
  return [...new Set([...model.excluded, ...harness.excluded].flatMap((item) => item.reasons))];
}
