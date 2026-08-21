export type Sha256 = `sha256:${string}`;

export type RunExecutionStatus =
  | "queued"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export type RunContextV1 =
  | { kind: "ad_hoc" }
  | {
      kind: "seed_task";
      seed_task_id: string;
      seed_task_digest: Sha256;
      seed_set_id?: string;
      seed_set_revision?: string;
      iteration_id?: string;
    }
  | {
      kind: "benchmark_task";
      benchmark_id: string;
      benchmark_revision: string;
      task_id: string;
      task_digest: Sha256;
      verifier_identity: Sha256;
    };

export interface EvalRunParentV1 {
  kind: "eval";
  eval_id: string;
  trial_id: string;
  attempt: number;
}

export interface HarnessIdentityV1 {
  harness_id: string;
  requested_ref: string;
  revision_identity: Sha256 | null;
  artifact_id?: Sha256;
  agent_args_sha256?: Sha256;
}

export interface ModelIdentityV1 {
  provider?: string;
  requested_id: string;
  effective_id: string;
  parameters_sha256?: Sha256;
  identity_resolved?: boolean;
}

export interface ProtocolIdentityV1 {
  timeout_ms: number;
  workspace_mode: string;
  initial_workspace_digest?: Sha256;
  environment_identity?: Sha256;
  tool_policy_sha256?: Sha256;
}

export interface RunObservationV1 {
  status: "valid" | "invalid";
  reward?: number;
  verifier_result_ref?: string;
  invalid_reason?: string;
}

export interface RunRecordV1 {
  run_id: string;
  context: RunContextV1;
  parent?: EvalRunParentV1;
  status: RunExecutionStatus;
  harness: HarnessIdentityV1;
  model: ModelIdentityV1;
  protocol: ProtocolIdentityV1;
  observation?: RunObservationV1;
  request_ref: string;
  resolution_ref: string;
  result_ref?: string;
  trajectory_ref?: string;
  created_at: string;
  completed_at?: string;
}

export interface EvalTrialRefV1 {
  trial_id: string;
  run_id: string;
  task_id: string;
  attempt: number;
  observation_status: "valid" | "invalid";
  reward?: number;
  verifier_result_ref?: string;
  invalid_reason?: string;
}

export interface EvalResultV1 {
  schema_version: "1";
  eval_id: string;
  benchmark_id: string;
  benchmark_revision: string;
  status: "succeeded" | "failed" | "cancelled";
  trials: EvalTrialRefV1[];
  started_at: string;
  completed_at: string;
}

export type TrajectoryFileRole =
  | "provider_events"
  | "provider_transcript"
  | "provider_artifact"
  | "canonical_session";

export interface TrajectoryFileRefV2 {
  role: TrajectoryFileRole;
  path: string;
  media_type: string;
  sha256: Sha256;
  bytes: number;
}

export interface TrajectoryRefV2 {
  schema_version: "2";
  run_id: string;
  fidelity: "provider_native" | "normalized" | "minimal";
  provider?: string;
  provider_session_id?: string;
  files: TrajectoryFileRefV2[];
  redactions?: Array<{ rule_id: string; count: number }>;
}

export type HudObservation =
  | { state: "not_applicable" }
  | { state: "pending" }
  | { state: "valid"; reward: number }
  | { state: "invalid"; reason: string };

export interface RunUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface CanonicalTrajectorySummary {
  turnCount: number;
  stepCount: number;
  toolCalls: number;
  toolFailures: number;
  usage: RunUsage;
  errors: string[];
  ttftMs: number | null;
}

export interface RunPhases {
  environment: number | null;
  agentSetup: number | null;
  agent: number | null;
  verifier: number | null;
}

export type TrajectoryAvailability =
  | "available"
  | "raw_only"
  | "pending"
  | "missing"
  | "corrupt"
  | "unsupported";

export interface HudRunSummary {
  id: string;
  evalId: string | null;
  parent: EvalRunParentV1 | null;
  context: RunContextV1;
  execution: RunExecutionStatus;
  observation: HudObservation;
  integrity: "valid" | "pending" | "corrupt";
  harness: HarnessIdentityV1;
  model: ModelIdentityV1;
  protocol: ProtocolIdentityV1;
  result: {
    startedAt: string | null;
    completedAt: string | null;
    error: { code: string; message: string } | null;
  };
  trajectory: {
    availability: TrajectoryAvailability;
    refSchema: "2" | null;
    evidenceFidelity: "provider_native" | "normalized" | "minimal" | null;
    provider: string | null;
    providerSessionId: string | null;
    hasCanonical: boolean;
    providerFiles: number;
    redactions: Array<{ ruleId: string; count: number }>;
    summary: CanonicalTrajectorySummary | null;
    diagnostic: string | null;
  };
  backendPhases: RunPhases | null;
  createdAt: string;
  completedAt: string | null;
  taskKey: string | null;
  harnessKey: string;
  modelKey: string;
  strictMetricEligible: boolean;
  exclusionReasons: string[];
}

export interface TaskIdentitySummary {
  key: string;
  taskId: string;
  taskDigest: Sha256;
  verifierIdentity: Sha256;
}

export interface DisplayIdentitySummary {
  key: string;
  label: string;
  unresolved: boolean;
}

export interface HitchBenchmark {
  key: string;
  id: string;
  label: string;
  revision: string;
  tasks: TaskIdentitySummary[];
  models: DisplayIdentitySummary[];
  harnesses: DisplayIdentitySummary[];
  runs: HudRunSummary[];
}

export type DiagnosticSeverity = "info" | "pending" | "warning" | "error";

export interface HitchDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  scope: "store" | "eval" | "run" | "trajectory";
  objectId: string | null;
  message: string;
}

export interface HitchSnapshot {
  schemaVersion: "run-centered-v1";
  generatedAt: string;
  root: string;
  benchmarks: HitchBenchmark[];
  runs: HudRunSummary[];
  diagnostics: HitchDiagnostic[];
}

export interface SessionHeaderLine {
  type: "session";
  version: 0;
  id: string;
  createdAt: number;
  delegationDepth: number;
  [key: string]: unknown;
}

export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  ignorable?: boolean;
  [key: string]: unknown;
}

export type LedgerRecordType = "message" | "tool" | "error" | "system";

export interface CanonicalLedgerRecord {
  id: string;
  seq: number;
  type: LedgerRecordType;
  eventType: string;
  timestamp: number;
  relativeMs: number;
  title: string;
  detail: string | null;
  status: "succeeded" | "failed" | "info";
  durationMs: number | null;
}

export interface CanonicalTrajectoryDocument {
  runId: string;
  session: { id: string; version: 0; createdAt: number };
  summary: CanonicalTrajectorySummary;
  records: CanonicalLedgerRecord[];
}

export interface ProviderEvidenceDescriptor {
  ordinal: number;
  role: Exclude<TrajectoryFileRole, "canonical_session">;
  mediaType: string;
  bytes: number;
  sha256: Sha256;
}

export interface ProviderEvidencePage {
  runId: string;
  file: ProviderEvidenceDescriptor;
  encoding: "utf8" | "base64";
  content: string;
  nextCursor: string | null;
}

export type ComparisonDimension = "model" | "harness";

export interface StrictComparisonResult {
  schema_version: "1";
  dimension: ComparisonDimension;
  strict: boolean;
  reference_run_id: string | null;
  groups: Array<{
    identity: HarnessIdentityV1 | ModelIdentityV1;
    run_ids: string[];
    valid_observations: number;
    rewards: { count: number; mean: number | null; min: number | null; max: number | null };
    agent_failures: number;
    invalid_run_ids: string[];
  }>;
  excluded: Array<{ run_id: string; reasons: string[] }>;
  unresolved_identities: Array<{ run_id: string; identity: "model" | "harness" }>;
}

// Kept as a source-compatible name; the value is now a run-centered summary
// and deliberately carries no Harbor event array.
export type HitchRun = HudRunSummary;
