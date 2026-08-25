import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaults = {
  output: join(workspace, 'fixtures', 'dashboard-data'),
  sessionId: 'rear-dashboard-demo',
  sessionCreatedAt: Date.parse('2026-08-20T09:00:00.000Z'),
  sessionCwd: '/workspace/rear-dashboard-demo',
}

function usage() {
  return [
    'Usage: npm run fixture:dashboard -- [options]',
    '',
    'Options:',
    '  --output <directory>             Output directory (default: fixtures/dashboard-data)',
    '  --session-id <id>                Exact DSH Session id',
    '  --session-created-at <ms>        Exact DSH Session createdAt timestamp',
    '  --session-cwd <absolute-path>    Exact DSH Session cwd',
    '  --help                           Show this message',
  ].join('\n')
}

function parseArgs(argv) {
  const options = { ...defaults }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--help') {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new TypeError(`missing value for ${name}`)
    index += 1
    if (name === '--output') options.output = resolve(value)
    else if (name === '--session-id') options.sessionId = value
    else if (name === '--session-created-at') options.sessionCreatedAt = Number(value)
    else if (name === '--session-cwd') options.sessionCwd = value
    else throw new TypeError(`unknown option ${name}`)
  }
  if (options.sessionId.trim() === '') throw new TypeError('session id must be non-empty')
  if (!Number.isSafeInteger(options.sessionCreatedAt) || options.sessionCreatedAt < 0) {
    throw new TypeError('session createdAt must be a non-negative safe integer')
  }
  if (!options.sessionCwd.startsWith('/')) throw new TypeError('session cwd must be absolute')
  const output = resolve(options.output)
  if (output === parse(output).root || output === workspace || output === resolve(homedir())) {
    throw new TypeError(`refusing to replace broad output directory: ${output}`)
  }
  return { ...options, output }
}

async function text(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

async function json(path, value) {
  await text(path, `${JSON.stringify(value, null, 2)}\n`)
}

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function runId(index) {
  return `run_${index.toString(16).padStart(32, '0')}`
}

function valid(taskId, attempt, reward, evidence = 'canonical', extra = {}) {
  return { taskId, attempt, observation: { status: 'valid', reward }, evidence, ...extra }
}

function invalid(taskId, attempt, reason, evidence, extra = {}) {
  return { taskId, attempt, observation: { status: 'invalid', invalidReason: reason }, evidence, ...extra }
}

const model = {
  requested_id: 'deepseek-v3.2',
  provider: 'deepseek',
  effective_id: 'deepseek-v3.2-snapshot-2026-08',
  identity_resolved: true,
}
const protocol = { timeout_ms: 30_000, max_steps: 32, sandbox: 'workspace-write' }
const harnesses = {
  baseline: {
    requested_ref: 'rear-agent@1.4.0',
    harness_id: 'rear-agent',
    revision_identity: 'git:1111111111111111111111111111111111111111',
  },
  safeV1: {
    requested_ref: 'rear-agent@safe-tools-v1',
    harness_id: 'rear-agent',
    revision_identity: 'git:2222222222222222222222222222222222222222',
  },
  qualityV2: {
    requested_ref: 'rear-agent@quality-v2',
    harness_id: 'rear-agent',
    revision_identity: 'git:3333333333333333333333333333333333333333',
  },
}

const benchmarks = {
  quality: { id: 'rear-dashboard-benchmark', revision: '2026.08' },
  safety: { id: 'tool-use-safety', revision: '2026.08' },
  context: { id: 'long-context-retrieval', revision: '2026.07' },
}

const evaluations = [
  {
    evalId: 'eval_dashboard_baseline',
    candidateId: 'candidate-dashboard-baseline',
    harness: harnesses.baseline,
    benchmark: benchmarks.quality,
    durationMs: 2_250,
    trials: [
      valid('json-schema-repair', 1, 0.50, 'canonical-provider'),
      valid('json-schema-repair', 2, 0.60),
      valid('unicode-paths', 1, 0.80),
      valid('unicode-paths', 2, 0.80, 'corrupt'),
      valid('retry-backoff', 1, 0.40),
      valid('tool-ordering', 1, 0.70),
    ],
  },
  {
    evalId: 'eval_dashboard_safe_v1',
    candidateId: 'candidate-dashboard-safe-v1',
    harness: harnesses.safeV1,
    benchmark: benchmarks.quality,
    durationMs: 2_650,
    trials: [
      valid('json-schema-repair', 1, 0.65),
      valid('unicode-paths', 1, 0.75),
      valid('retry-backoff', 1, 0.45),
      valid('tool-ordering', 1, 0.72),
    ],
  },
  {
    evalId: 'eval_dashboard_quality_v2',
    candidateId: 'candidate-dashboard-quality-v2',
    harness: harnesses.qualityV2,
    benchmark: benchmarks.quality,
    durationMs: 3_350,
    trials: [
      valid('json-schema-repair', 1, 0.85, 'canonical-provider', { largeProviderEvidence: true }),
      valid('json-schema-repair', 2, 0.95),
      valid('unicode-paths', 1, 0.70),
      valid('retry-backoff', 1, 0.40),
      invalid('retry-backoff', 3, 'infrastructure-timeout', 'missing', { execution: 'timed_out' }),
      valid('tool-ordering', 1, 0.90, 'canonical-provider'),
      invalid('tool-ordering', 2, 'tool-result-missing', 'provider-only', { execution: 'failed' }),
    ],
  },
  {
    evalId: 'eval_dashboard_baseline_safety',
    candidateId: 'candidate-dashboard-baseline',
    harness: harnesses.baseline,
    benchmark: benchmarks.safety,
    durationMs: 1_850,
    trials: [
      valid('safe-api-selection', 1, 0.65),
      valid('destructive-guard', 1, 0.70),
      valid('argument-validation', 1, 0.60),
      valid('tool-recovery', 1, 0.55),
    ],
  },
  {
    evalId: 'eval_dashboard_safe_v1_safety',
    candidateId: 'candidate-dashboard-safe-v1',
    harness: harnesses.safeV1,
    benchmark: benchmarks.safety,
    durationMs: 2_250,
    trials: [
      valid('safe-api-selection', 1, 0.82),
      valid('destructive-guard', 1, 0.92),
      valid('argument-validation', 1, 0.80),
      valid('tool-recovery', 1, 0.72),
    ],
  },
  {
    evalId: 'eval_dashboard_quality_v2_safety',
    candidateId: 'candidate-dashboard-quality-v2',
    harness: harnesses.qualityV2,
    benchmark: benchmarks.safety,
    durationMs: 2_850,
    trials: [
      valid('safe-api-selection', 1, 0.68),
      valid('destructive-guard', 1, 0.45),
      valid('argument-validation', 1, 0.64),
      valid('tool-recovery', 1, 0.60),
    ],
  },
  {
    evalId: 'eval_dashboard_baseline_context',
    candidateId: 'candidate-dashboard-baseline',
    harness: harnesses.baseline,
    benchmark: benchmarks.context,
    durationMs: 3_450,
    trials: [
      valid('cross-file-trace', 1, 0.55),
      valid('constraint-recall', 1, 0.65),
      valid('evidence-citation', 1, 0.50),
      valid('distractor-filtering', 1, 0.60),
    ],
  },
  {
    evalId: 'eval_dashboard_safe_v1_context',
    candidateId: 'candidate-dashboard-safe-v1',
    harness: harnesses.safeV1,
    benchmark: benchmarks.context,
    durationMs: 3_850,
    trials: [
      valid('cross-file-trace', 1, 0.52),
      valid('constraint-recall', 1, 0.70),
      valid('evidence-citation', 1, 0.48),
      valid('distractor-filtering', 1, 0.62),
    ],
  },
  {
    evalId: 'eval_dashboard_quality_v2_context',
    candidateId: 'candidate-dashboard-quality-v2',
    harness: harnesses.qualityV2,
    benchmark: benchmarks.context,
    durationMs: 4_650,
    trials: [
      valid('cross-file-trace', 1, 0.80),
      valid('constraint-recall', 1, 0.82),
      valid('evidence-citation', 1, 0.75),
      valid('distractor-filtering', 1, 0.78),
    ],
  },
]

function canonical(run, trial, ordinal) {
  const startedAt = Date.parse('2026-08-22T08:00:00.000Z') + ordinal * 60_000
  const score = trial.observation.status === 'valid' ? trial.observation.reward : 0
  const events = [
    { type: 'session', version: 0, id: `trajectory-${run}`, createdAt: startedAt },
    { type: 'turn/start', seq: 0, time: startedAt, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: startedAt + 20, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 2, time: startedAt + 65, data: { turn: 1, step: 1, chunk: { type: 'text', text: 'Inspecting fixture input…' } } },
    { type: 'tool/call', seq: 3, time: startedAt + 90, data: { turn: 1, step: 1, id: `call-${ordinal}`, name: 'fixture.verify', arguments: { task: trial.taskId } } },
    { type: 'tool/result', seq: 4, time: startedAt + 130, data: { turn: 1, step: 1, id: `call-${ordinal}`, result: { ok: true, score } } },
    { type: 'assistant/message', seq: 5, time: startedAt + 180, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: `Completed ${trial.taskId} fixture run.` }], source: { provider: 'deepseek', model: model.effective_id } }, usage: { inputTokens: 120 + ordinal, outputTokens: 28 + ordinal } } },
    { type: 'step/end', seq: 6, time: startedAt + 200, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 7, time: startedAt + 220, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return `${events.map(event => JSON.stringify(event)).join('\n')}\n`
}

function providerEvidence(run, trial) {
  const count = trial.largeProviderEvidence ? 48 : 4
  const rows = Array.from({ length: count }, (_, index) => ({
    type: index === count - 1 ? 'response.completed' : 'response.delta',
    run_id: run,
    index,
    task: trial.taskId,
    text: `dummy provider evidence ${index + 1}/${count} — 可用于测试分页和 UTF-8`,
  }))
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}

async function writeEvaluation(root, evaluation, startOrdinal) {
  const resultTrials = []
  for (const [offset, source] of evaluation.trials.entries()) {
    const ordinal = startOrdinal + offset
    const id = runId(ordinal)
    const trialId = `${evaluation.evalId}-trial-${source.taskId}-${source.attempt}`
    const directory = join(root, 'hitch', 'runs', id)
    const files = []
    if (source.evidence === 'canonical' || source.evidence === 'canonical-provider' || source.evidence === 'corrupt') {
      const content = canonical(id, source, ordinal)
      const path = 'trajectory/canonical/session.jsonl'
      await text(join(directory, path), content)
      files.push({
        role: 'canonical_session', path, media_type: 'application/x-ndjson',
        sha256: source.evidence === 'corrupt' ? `sha256:${'0'.repeat(64)}` : digest(content),
        bytes: Buffer.byteLength(content),
      })
    }
    if (source.evidence === 'canonical-provider' || source.evidence === 'provider-only') {
      const content = providerEvidence(id, source)
      const path = 'trajectory/provider/events.jsonl'
      await text(join(directory, path), content)
      files.push({
        role: 'provider_events', path, media_type: 'application/x-ndjson',
        sha256: digest(content), bytes: Buffer.byteLength(content),
      })
    }
    if (source.evidence !== 'missing') {
      await json(join(directory, 'trajectory.ref.json'), { schema_version: '2', run_id: id, files })
    }
    const createdAt = Date.parse('2026-08-22T08:00:00.000Z') + ordinal * 60_000
    const observation = source.observation.status === 'valid'
      ? { status: 'valid', reward: source.observation.reward }
      : { status: 'invalid', invalid_reason: source.observation.invalidReason }
    await json(join(directory, 'manifest.json'), {
      schema_version: '1',
      run_id: id,
      context: {
        kind: 'benchmark_task', benchmark_id: evaluation.benchmark.id, benchmark_revision: evaluation.benchmark.revision,
        task_id: source.taskId, task_digest: `fixture-digest:${source.taskId}`, verifier_identity: 'rear-fixture-verifier-v1',
      },
      parent: { kind: 'eval', eval_id: evaluation.evalId, trial_id: trialId, attempt: source.attempt },
      status: source.execution ?? 'succeeded',
      harness: evaluation.harness,
      model,
      protocol,
      observation,
      created_at: createdAt,
      completed_at: createdAt + evaluation.durationMs,
      ...(source.evidence === 'missing' ? {} : { trajectory_ref: 'trajectory.ref.json' }),
    })
    resultTrials.push({
      trial_id: trialId, run_id: id, task_id: source.taskId, attempt: source.attempt,
      ...(source.observation.status === 'valid'
        ? { observation_status: 'valid', reward: source.observation.reward }
        : { observation_status: 'invalid', invalid_reason: source.observation.invalidReason }),
    })
  }
  const evalDirectory = join(root, 'hitch', 'evals', evaluation.evalId)
  await json(join(evalDirectory, 'plan.json'), {
    schema_version: '1',
    tasks: [...new Set(evaluation.trials.map(trial => trial.taskId))].map(id => ({ id })),
  })
  await json(join(evalDirectory, 'result.json'), {
    schema_version: '1', eval_id: evaluation.evalId,
    benchmark_id: evaluation.benchmark.id, benchmark_revision: evaluation.benchmark.revision,
    status: 'succeeded', trials: resultTrials,
  })
  return startOrdinal + evaluation.trials.length
}

function evaluationRef(evalId) {
  const evaluation = evaluations.find(item => item.evalId === evalId)
  if (evaluation === undefined) throw new TypeError(`unknown fixture evaluation ${evalId}`)
  return {
    providerId: 'hitch', evalId, candidateId: evaluation.candidateId,
    requestedModelId: 'deepseek-v3.2',
    benchmarkId: evaluation.benchmark.id, benchmarkRevision: evaluation.benchmark.revision,
  }
}

function records(session) {
  const primaryCreatedAt = Date.parse('2026-08-22T07:30:00.000Z')
  const iterationOneCreatedAt = Date.parse('2026-08-22T07:35:00.000Z')
  const iterationTwoCreatedAt = Date.parse('2026-08-22T08:30:00.000Z')
  const primaryId = 'refinement-dashboard-primary'
  const primary = {
    schemaVersion: 1,
    id: primaryId,
    session,
    objective: '提升代码修复准确率，同时保留工具调用稳定性并降低回归',
    driver: { id: 'dashboard-fixture-driver', operationId: 'fixture-operation-primary' },
    evidenceProviderId: 'hitch',
    status: 'completed',
    baselineCandidateId: 'candidate-dashboard-baseline',
    activeIterationId: null,
    candidates: [
      { id: 'candidate-dashboard-baseline', role: 'baseline', parentCandidateId: null, requestedHarnessRef: harnesses.baseline.requested_ref, revisionIdentity: harnesses.baseline.revision_identity, label: 'Baseline 1.4.0', createdAt: primaryCreatedAt + 1_000 },
      { id: 'candidate-dashboard-safe-v1', role: 'candidate', parentCandidateId: 'candidate-dashboard-baseline', requestedHarnessRef: harnesses.safeV1.requested_ref, revisionIdentity: harnesses.safeV1.revision_identity, label: 'Safer tools v1', createdAt: primaryCreatedAt + 2_000 },
      { id: 'candidate-dashboard-quality-v2', role: 'candidate', parentCandidateId: 'candidate-dashboard-safe-v1', requestedHarnessRef: harnesses.qualityV2.requested_ref, revisionIdentity: harnesses.qualityV2.revision_identity, label: 'Quality pass v2', createdAt: primaryCreatedAt + 3_000 },
    ],
    iterations: [
      {
        id: 'iteration-dashboard-01', ordinal: 1, status: 'settled',
        candidateIds: ['candidate-dashboard-baseline', 'candidate-dashboard-safe-v1'],
        evaluationRefs: [
          evaluationRef('eval_dashboard_baseline'),
          evaluationRef('eval_dashboard_safe_v1'),
          evaluationRef('eval_dashboard_baseline_safety'),
          evaluationRef('eval_dashboard_safe_v1_safety'),
          evaluationRef('eval_dashboard_baseline_context'),
          evaluationRef('eval_dashboard_safe_v1_context'),
        ],
        createdAt: iterationOneCreatedAt, completedAt: iterationOneCreatedAt + 40 * 60_000,
      },
      {
        id: 'iteration-dashboard-02', ordinal: 2, status: 'settled',
        candidateIds: ['candidate-dashboard-baseline', 'candidate-dashboard-quality-v2'],
        evaluationRefs: [
          evaluationRef('eval_dashboard_baseline'),
          evaluationRef('eval_dashboard_quality_v2'),
          evaluationRef('eval_dashboard_baseline_safety'),
          evaluationRef('eval_dashboard_quality_v2_safety'),
          evaluationRef('eval_dashboard_baseline_context'),
          evaluationRef('eval_dashboard_quality_v2_context'),
        ],
        createdAt: iterationTwoCreatedAt, completedAt: iterationTwoCreatedAt + 55 * 60_000,
      },
    ],
    createdAt: primaryCreatedAt,
    updatedAt: iterationTwoCreatedAt + 55 * 60_000,
    completedAt: iterationTwoCreatedAt + 55 * 60_000,
    version: '11111111-1111-4111-8111-111111111111',
  }
  const failed = {
    schemaVersion: 1,
    id: 'refinement-dashboard-failed',
    session,
    objective: '验证失败状态、错误信息和无评测数据的空态',
    driver: { id: 'dashboard-fixture-driver', operationId: 'fixture-operation-failed' },
    evidenceProviderId: 'hitch',
    status: 'failed',
    baselineCandidateId: null,
    activeIterationId: null,
    candidates: [],
    iterations: [],
    createdAt: Date.parse('2026-08-21T06:00:00.000Z'),
    updatedAt: Date.parse('2026-08-21T06:02:00.000Z'),
    completedAt: Date.parse('2026-08-21T06:02:00.000Z'),
    failure: { code: 'fixture-driver-failed', message: 'Dummy driver intentionally failed before candidate generation.' },
    version: '22222222-2222-4222-8222-222222222222',
  }
  const cancelled = {
    schemaVersion: 1,
    id: 'refinement-dashboard-cancelled',
    session,
    objective: '验证取消状态与历史记录切换',
    driver: { id: 'dashboard-fixture-driver', operationId: 'fixture-operation-cancelled' },
    evidenceProviderId: 'hitch',
    status: 'cancelled',
    baselineCandidateId: null,
    activeIterationId: null,
    candidates: [],
    iterations: [],
    createdAt: Date.parse('2026-08-20T10:00:00.000Z'),
    updatedAt: Date.parse('2026-08-20T10:04:00.000Z'),
    completedAt: Date.parse('2026-08-20T10:04:00.000Z'),
    version: '33333333-3333-4333-8333-333333333333',
  }
  return { primaryId, values: [primary, failed, cancelled] }
}

function fixtureReadme(manifest) {
  return [
    '# REAR dashboard dummy data',
    '',
    '这是一个可重复挂载的持久化测试快照，包含 DSH Refinement 状态和 Hitch run-centered 证据。',
    '',
    '## 固定 Session',
    '',
    `- id: \`${manifest.session.id}\``,
    `- createdAt: \`${manifest.session.createdAt}\``,
    `- cwd: \`${manifest.session.cwd}\``,
    '',
    'REAR 按完整 Session lifecycle 隔离数据，因此当前 DSH Session 的这三个值必须完全一致。若宿主不从持久化层恢复该 Session，请用这些 metadata 创建测试 Session。',
    '',
    '## Benchmark 组合',
    '',
    ...manifest.benchmarks.map(item => `- \`${item.id}@${item.revision}\``),
    '',
    '候选数据刻意保留不同权衡：baseline 延迟最低；safe-tools 在工具安全上领先；quality-v2 等权平均得分最高，但在 destructive-guard 上超过 0.01 回归红线。',
    '',
    '## 挂载',
    '',
    '```yaml',
    'volumes:',
    '  - ./fixtures/dashboard-data/storage:/mnt/rear-dashboard/storage',
    '  - ./fixtures/dashboard-data/hitch:/mnt/rear-dashboard/hitch:ro',
    '```',
    '',
    '把 `@deepseek-ai/dsh-storage-json` 的 `root` 指向 `/mnt/rear-dashboard/storage`，把 `dsh-plugin-rear.config.hitch.root` 指向 `/mnt/rear-dashboard/hitch`。Hitch 是只读证据源；storage 可以读写，测试期间的变化会持久保留。',
    '',
    '## 重置或定制',
    '',
    '```bash',
    'npm run fixture:dashboard',
    'npm run fixture:dashboard -- --output ./work/rear-dashboard-test',
    'npm run fixture:dashboard -- --session-id my-session --session-created-at 1787293200000 --session-cwd /workspace/demo',
    '```',
    '',
    '生成命令会完整替换目标目录。默认数据是确定性的，包含 3 条历史 refinement、2 次迭代、3 个候选版本和 3 套 benchmark。数据覆盖跨 benchmark 提升、回退红线、质量/延迟权衡，以及 improved/regressed/unchanged、invalid、timed-out、missing、provider-only、corrupt 和分页 raw evidence 场景。',
    '',
  ].join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await rm(options.output, { recursive: true, force: true })
  await mkdir(options.output, { recursive: true })
  let ordinal = 1
  for (const evaluation of evaluations) ordinal = await writeEvaluation(options.output, evaluation, ordinal)
  const session = { sessionId: options.sessionId, createdAt: options.sessionCreatedAt, cwd: options.sessionCwd }
  const fixtureRecords = records(session)
  await json(join(options.output, 'storage', 'refinement.json'), {
    unit: { name: 'refinement', version: 1 },
    global: null,
    tables: { refinements: Object.fromEntries(fixtureRecords.values.map(record => [record.id, record])) },
  })
  const manifest = {
    schemaVersion: 1,
    description: 'Deterministic, mountable REAR dashboard fixture',
    session: { id: options.sessionId, createdAt: options.sessionCreatedAt, cwd: options.sessionCwd },
    primaryRefinementId: fixtureRecords.primaryId,
    benchmarks: Object.values(benchmarks),
    mounts: {
      storage: { source: 'storage', readOnly: false, config: '@deepseek-ai/dsh-storage-json.root' },
      hitch: { source: 'hitch', readOnly: true, config: 'dsh-plugin-rear.hitch.root' },
    },
  }
  await json(join(options.output, 'manifest.json'), manifest)
  await text(join(options.output, 'README.md'), fixtureReadme(manifest))
  process.stdout.write(`Dashboard fixture generated at ${options.output}\n`)
  process.stdout.write(`Session: ${options.sessionId} @ ${options.sessionCreatedAt} (${options.sessionCwd})\n`)
}

await main()
