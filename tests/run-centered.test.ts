import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCanonicalSession } from "../lib/hitch/canonical-session";
import { parseTrajectoryRefV2 } from "../lib/hitch/trajectory-ref";
import { scanHitch, unconfiguredHitchSnapshot } from "../lib/hitch-scanner";
import { compareRunSummaries } from "../lib/hitch/strict-comparison";

const digestA = `sha256:${"a".repeat(64)}` as const;
const digestB = `sha256:${"b".repeat(64)}` as const;
const digestC = `sha256:${"c".repeat(64)}` as const;

async function json(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function session(runId: string, usage = true): string {
  const now = 1_700_000_000_000;
  const lines = [
    { type: "session", version: 0, id: `session-${runId}`, createdAt: now, delegationDepth: 0 },
    { type: "turn/start", seq: 0, time: now, data: { turn: 1 } },
    { type: "step/start", seq: 1, time: now + 1, data: { turn: 1, step: 1 } },
    { type: "assistant/message", seq: 2, time: now + 2, data: { message: { content: [{ text: "done" }] }, ...(usage ? { usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 } } : {}) } },
    { type: "step/end", seq: 3, time: now + 3, data: { turn: 1, step: 1 } },
    { type: "turn/end", seq: 4, time: now + 4, data: { turn: 1 } },
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

interface RunOptions {
  runId: string;
  reward?: number;
  invalidReason?: string;
  model?: string;
  parent?: { evalId: string; trialId: string; attempt: number };
  taskId?: string;
  taskDigest?: typeof digestA | typeof digestC;
  verifierIdentity?: typeof digestB | typeof digestC;
  trajectorySchema?: "2" | "1";
  corruptHash?: boolean;
  provider?: string;
}

async function writeRun(root: string, options: RunOptions) {
  const run = path.join(root, "runs", options.runId);
  await mkdir(run, { recursive: true });
  const now = "2026-08-21T01:00:00.000Z";
  const canonical = session(options.runId);
  const canonicalPath = "trajectory/canonical/session.jsonl";
  await mkdir(path.dirname(path.join(run, canonicalPath)), { recursive: true });
  await writeFile(path.join(run, canonicalPath), canonical, "utf8");
  const files: Array<Record<string, unknown>> = [{
    role: "canonical_session",
    path: canonicalPath,
    media_type: "application/x-ndjson",
    sha256: options.corruptHash ? digestC : sha(canonical),
    bytes: Buffer.byteLength(canonical),
  }];
  if (options.provider) {
    const providerPath = "trajectory/provider/events.jsonl";
    const providerContent = `${JSON.stringify({ type: "native", payload: options.provider })}\n`;
    await mkdir(path.dirname(path.join(run, providerPath)), { recursive: true });
    await writeFile(path.join(run, providerPath), providerContent, "utf8");
    files.unshift({ role: "provider_events", path: providerPath, media_type: "application/x-ndjson", sha256: sha(providerContent), bytes: Buffer.byteLength(providerContent) });
  }
  await json(path.join(run, "trajectory.ref.json"), options.trajectorySchema === "1" ? {
    schema_version: "1",
    run_id: options.runId,
    path: "/tmp/must-not-be-read.jsonl",
  } : {
    schema_version: "2",
    run_id: options.runId,
    fidelity: options.provider ? "provider_native" : "normalized",
    files,
    ...(options.provider ? { provider: "test", redactions: [{ rule_id: "secret", count: 1 }] } : {}),
  });
  await json(path.join(run, "request.json"), {});
  await json(path.join(run, "resolution.json"), {});
  await json(path.join(run, "result.json"), { run_id: options.runId, status: "succeeded", started_at: now, completed_at: now, error: null });
  const valid = options.invalidReason === undefined;
  if (valid) await json(path.join(run, "verifier", "result.json"), { rewards: { reward: options.reward ?? 0 } });
  await json(path.join(run, "manifest.json"), {
    schema_version: "1",
    run_id: options.runId,
    context: {
      kind: "benchmark_task",
      benchmark_id: "bench",
      benchmark_revision: "rev-1",
      task_id: options.taskId || "task-1",
      task_digest: options.taskDigest || digestA,
      verifier_identity: options.verifierIdentity || digestB,
    },
    ...(options.parent ? { parent: { kind: "eval", eval_id: options.parent.evalId, trial_id: options.parent.trialId, attempt: options.parent.attempt } } : {}),
    status: "succeeded",
    harness: { harness_id: "codex", requested_ref: "codex@version:1", revision_identity: digestA, artifact_id: digestB },
    model: { provider: "openai", requested_id: options.model || "model-a", effective_id: `${options.model || "model-a"}-snapshot`, parameters_sha256: digestC, identity_resolved: true },
    protocol: { timeout_ms: 1000, workspace_mode: "shared", initial_workspace_digest: digestA, environment_identity: digestB },
    observation: valid
      ? { status: "valid", reward: options.reward ?? 0, verifier_result_ref: "verifier/result.json" }
      : { status: "invalid", invalid_reason: options.invalidReason },
    request_ref: "request.json",
    resolution_ref: "resolution.json",
    result_ref: "result.json",
    trajectory_ref: "trajectory.ref.json",
    created_at: now,
    completed_at: now,
    sealed: false,
  });
}

test("run-centered scanner joins eval trials and counts valid reward zero", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rear-run-centered-"));
  const runId = "run_11111111111111111111111111111111";
  await writeRun(root, { runId, reward: 0, parent: { evalId: "eval_one", trialId: "trial-1", attempt: 1 }, provider: "native" });
  await json(path.join(root, "evals", "eval_one", "result.json"), {
    schema_version: "1",
    eval_id: "eval_one",
    benchmark_id: "bench",
    benchmark_revision: "rev-1",
    status: "succeeded",
    trials: [{ trial_id: "trial-1", run_id: runId, task_id: "task-1", attempt: 1, observation_status: "valid", reward: 0, verifier_result_ref: "verifier/result.json" }],
    started_at: "2026-08-21T00:59:00.000Z",
    completed_at: "2026-08-21T01:01:00.000Z",
  });
  const snapshot = scanHitch(root);
  assert.equal(snapshot.schemaVersion, "run-centered-v1");
  assert.equal(snapshot.benchmarks.length, 1);
  assert.equal(snapshot.benchmarks[0].runs[0].observation.state, "valid");
  assert.equal(snapshot.benchmarks[0].runs[0].strictMetricEligible, true);
  assert.equal(snapshot.benchmarks[0].runs[0].trajectory.summary?.usage.inputTokens, 7);
  assert.equal(snapshot.benchmarks[0].runs[0].trajectory.providerFiles, 1);
  assert.equal(snapshot.diagnostics.length, 0);
});

test("invalid observations are preserved and never converted to zero", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rear-invalid-"));
  await writeRun(root, { runId: "run_22222222222222222222222222222222", invalidReason: "infrastructure_failure" });
  const run = scanHitch(root).benchmarks[0].runs[0];
  assert.deepEqual(run.observation, { state: "invalid", reason: "infrastructure_failure" });
  assert.equal(run.strictMetricEligible, false);
});

test("legacy stores and TrajectoryRef V1 are explicitly unsupported", async () => {
  const oldRoot = await mkdtemp(path.join(tmpdir(), "rear-old-"));
  await mkdir(path.join(oldRoot, "namespace", "state", "harness", "evals"), { recursive: true });
  const oldSnapshot = scanHitch(oldRoot);
  assert.equal(oldSnapshot.runs.length, 0);
  assert.equal(oldSnapshot.diagnostics[0].code, "run_centered_store_not_found");

  const root = await mkdtemp(path.join(tmpdir(), "rear-v1-"));
  await writeRun(root, { runId: "run_33333333333333333333333333333333", trajectorySchema: "1" });
  const snapshot = scanHitch(root);
  assert.equal(snapshot.runs[0].trajectory.availability, "unsupported");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "unsupported_trajectory_ref"));
});

test("trajectory checksum corruption and eval/run mismatches mark runs corrupt", async () => {
  const corruptRoot = await mkdtemp(path.join(tmpdir(), "rear-corrupt-"));
  await writeRun(corruptRoot, { runId: "run_44444444444444444444444444444444", corruptHash: true });
  const corrupt = scanHitch(corruptRoot).runs[0];
  assert.equal(corrupt.integrity, "corrupt");
  assert.equal(corrupt.trajectory.availability, "corrupt");

  const joinRoot = await mkdtemp(path.join(tmpdir(), "rear-join-"));
  const runId = "run_55555555555555555555555555555555";
  await writeRun(joinRoot, { runId, parent: { evalId: "eval_bad", trialId: "trial-a", attempt: 1 } });
  await json(path.join(joinRoot, "evals", "eval_bad", "result.json"), {
    schema_version: "1", eval_id: "eval_bad", benchmark_id: "bench", benchmark_revision: "rev-1", status: "succeeded",
    trials: [{ trial_id: "trial-a", run_id: runId, task_id: "different-task", attempt: 2, observation_status: "valid", reward: 1, verifier_result_ref: "verifier/result.json" }],
    started_at: "2026-08-21T00:59:00.000Z", completed_at: "2026-08-21T01:01:00.000Z",
  });
  const joined = scanHitch(joinRoot);
  assert.equal(joined.runs[0].integrity, "corrupt");
  assert.ok(joined.diagnostics.some((item) => item.code === "eval_run_link_corrupt"));
});

test("strict comparison isolates the selected identity dimension", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rear-compare-"));
  await writeRun(root, { runId: "run_66666666666666666666666666666666", model: "model-a", reward: 0 });
  await writeRun(root, { runId: "run_77777777777777777777777777777777", model: "model-b", reward: 1 });
  const runs = scanHitch(root).runs;
  const comparison = compareRunSummaries(runs, { dimension: "model" });
  assert.equal(comparison.strict, true);
  assert.equal(comparison.groups.length, 2);
  assert.deepEqual(comparison.groups.map((group) => group.rewards.mean).sort(), [0, 1]);

  const manifestPath = path.join(root, "runs", runs[1].id, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.protocol.timeout_ms = 2_000;
  await json(manifestPath, manifest);
  const mismatch = compareRunSummaries(scanHitch(root).runs, { dimension: "model" });
  assert.equal(mismatch.strict, false);
  assert.ok(mismatch.excluded.some((item) => item.reasons.includes("protocol_identity_mismatch")));
});

test("running evals stay eval-level pending and do not fabricate task runs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rear-running-eval-"));
  await json(path.join(root, "evals", "eval_running", "request.json"), { schema_version: "1" });
  await json(path.join(root, "evals", "eval_running", "plan.json"), { schema_version: "1" });
  const snapshot = scanHitch(root);
  assert.equal(snapshot.runs.length, 0);
  assert.ok(snapshot.diagnostics.some((item) => item.code === "eval_pending_runs" && item.severity === "pending"));
});

test("unconfigured stores expose no local path and return an explicit diagnostic", () => {
  const snapshot = unconfiguredHitchSnapshot();
  assert.equal("root" in snapshot, false);
  assert.equal(snapshot.runs.length, 0);
  assert.equal(snapshot.diagnostics[0].code, "hitch_data_root_not_configured");
});

test("same task id with different digest or verifier remains separate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rear-task-identity-"));
  await writeRun(root, { runId: "run_88888888888888888888888888888888", taskDigest: digestA, verifierIdentity: digestB });
  await writeRun(root, { runId: "run_99999999999999999999999999999999", taskDigest: digestC, verifierIdentity: digestC });
  const benchmark = scanHitch(root).benchmarks[0];
  assert.equal(benchmark.tasks.length, 2);
  assert.equal(new Set(benchmark.tasks.map((item) => item.key)).size, 2);
});

test("canonical parser rejects seq gaps and unpaired tools", () => {
  const lines = session("run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").trim().split("\n").map((line) => JSON.parse(line));
  lines[2].seq = 9;
  assert.throws(() => parseCanonicalSession(lines.map((line) => JSON.stringify(line)).join("\n"), "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), /contiguous/);

  const now = 1_700_000_000_000;
  const unpaired = [
    { type: "session", version: 0, id: "s", createdAt: now, delegationDepth: 0 },
    { type: "turn/start", seq: 0, time: now, data: { turn: 1 } },
    { type: "step/start", seq: 1, time: now, data: { turn: 1, step: 1 } },
    { type: "tool/result", seq: 2, time: now, data: { message: { source: { callId: "missing" }, content: [] } } },
    { type: "step/end", seq: 3, time: now, data: { turn: 1, step: 1 } },
    { type: "turn/end", seq: 4, time: now, data: { turn: 1 } },
  ];
  assert.throws(() => parseCanonicalSession(unpaired.map((line) => JSON.stringify(line)).join("\n"), "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), /without matching call/);
});

test("trajectory paths and symlinks are rejected before content is trusted", async () => {
  assert.throws(() => parseTrajectoryRefV2({
    schema_version: "2",
    run_id: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    fidelity: "normalized",
    files: [{ role: "canonical_session", path: "../outside", media_type: "application/x-ndjson", sha256: digestA, bytes: 1 }],
  }), /normalized relative path/);

  const root = await mkdtemp(path.join(tmpdir(), "rear-symlink-"));
  const runId = "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await writeRun(root, { runId });
  const target = path.join(root, "outside.jsonl");
  await writeFile(target, session(runId), "utf8");
  const canonical = path.join(root, "runs", runId, "trajectory", "canonical", "session.jsonl");
  await rm(canonical);
  await symlink(target, canonical);
  const run = scanHitch(root).runs[0];
  assert.equal(run.trajectory.availability, "corrupt");
  assert.equal(run.integrity, "corrupt");
});
