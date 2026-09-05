import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HitchEvalId,
  HitchRunId,
  RefinementCandidateId,
  RefinementEvaluationRef,
} from '../../src/types.ts'
import { HitchRefinementEvidenceProvider } from '../../src/hitch-provider.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

function digest(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digestJson(value: unknown): string {
  return digest(canonicalJson(value))
}

function bundleRole(path: string): string {
  if (path === 'request.json') return 'request'
  if (path === 'resolution.json') return 'resolution'
  if (path === 'manifest.json') return 'manifest'
  if (path === 'result.json') return 'result'
  if (path === 'runtime.ref.json') return 'runtime-ref'
  if (path === 'execution.json') return 'execution-evidence'
  if (path === 'events.jsonl') return 'control-events'
  if (path === 'environment/image.manifest.json') return 'environment-manifest'
  if (path.startsWith('interactions/')) return 'interaction-capture'
  if (path === 'eval/publication.json') return 'eval-publication'
  if (path.startsWith('verifier/')) return 'verifier-evidence'
  if (path === 'trajectory.ref.json' || path.startsWith('trajectory/')) return 'trajectory'
  return 'diagnostic'
}

async function bundleFiles(root: string, directory = root, prefix = ''): Promise<Array<Record<string, unknown>>> {
  const files: Array<Record<string, unknown>> = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await bundleFiles(root, absolute, relative))
    else if (relative !== 'bundle.index.json') {
      const bytes = await readFile(absolute)
      files.push({ role: bundleRole(relative), path: relative, size: bytes.length, sha256: digest(bytes) })
    }
  }
  return files.sort((left, right) => Buffer.from(String(left['path'])).compare(Buffer.from(String(right['path']))))
}

async function sealBundle(directory: string, manifest: Record<string, unknown>, executionEvidence: boolean): Promise<void> {
  const interactionRef = await readFile(join(directory, 'interactions', 'interaction.ref.json'), 'utf8')
    .then(value => JSON.parse(value) as Record<string, unknown>)
    .catch(() => undefined)
  const files = await bundleFiles(directory)
  const identity = {
    schema_version: '1',
    run_id: manifest['run_id'],
    sealed: true,
    context_identity: digestJson({
      context: manifest['context'], parent: manifest['parent'], harness: manifest['harness'],
      model: manifest['model'], protocol: manifest['protocol'], observation: manifest['observation'],
    }),
    files,
    capture: interactionRef === undefined
      ? {
          mode: 'native', required: false, completeness: 'complete', interaction_count: 0,
          redaction: { policy: 'hitch-provider-redaction-v1', status: 'not-needed', rules: [] },
        }
      : {
          mode: interactionRef['mode'], required: interactionRef['required'], completeness: interactionRef['completeness'],
          interaction_count: interactionRef['interaction_count'], redaction: interactionRef['redaction'],
        },
    ...(interactionRef === undefined ? {} : { interaction_ref: 'interactions/interaction.ref.json' }),
    ...(executionEvidence ? {
      environment: {
        images: [{ image_id: digest('image-id'), image_digest: digest('image-manifest'), reference: 'registry/image@sha256:123' }],
        provider: 'local-docker', worker_id: 'worker-1', lease_id: `lease_${'5'.repeat(32)}`,
      },
      resources: {
        requested: { cpu_millis: 1_000, memory_bytes: 1_024, container_slots: 1, build_slots: 0 },
        observed: { cpu_millis: 900, memory_bytes: 768 },
      },
    } : {}),
    provenance: { benchmark_id: 'bench', benchmark_revision: 'rev' },
  }
  await json(join(directory, 'bundle.index.json'), {
    ...identity,
    bundle_digest: digestJson(identity),
    created_at: '2026-09-01T00:00:00.000Z',
  })
}

function canonical(runId: string): string {
  const now = 1_700_000_000_000
  return [
    { type: 'session', version: 0, id: `session-${runId}`, createdAt: now },
    { type: 'turn/start', seq: 0, time: now, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: now + 1, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 2, time: now + 2, data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } } },
    { type: 'assistant/chunk', seq: 3, time: now + 3, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'done' } } },
    { type: 'assistant/message', seq: 4, time: now + 4, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'done' }], source: { provider: 'test', model: 'model' } }, usage: { inputTokens: 7, outputTokens: 3 } } },
    { type: 'step/end', seq: 5, time: now + 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time: now + 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n'
}

interface RunFixture {
  readonly runId: HitchRunId
  readonly candidateId: RefinementCandidateId
  readonly trialId: string
  readonly attempt: number
  readonly reward?: number
  readonly invalidReason?: string
  readonly trajectory: 'canonical' | 'provider-only' | 'missing' | 'corrupt-path'
  readonly providerContent?: string
  readonly corruptOwnership?: boolean
  readonly protocolTimeout?: number
  readonly taskId?: string
  readonly sealedBundle?: boolean
  readonly interactions?: readonly Record<string, unknown>[]
  readonly sealed?: boolean
  readonly bundleExecution?: boolean
}

async function run(root: string, evalId: HitchEvalId, value: RunFixture): Promise<void> {
  const directory = join(root, 'runs', value.runId)
  await mkdir(directory, { recursive: true })
  const files: Array<Record<string, unknown>> = []
  if (value.trajectory === 'canonical') {
    const content = canonical(value.runId)
    const path = 'trajectory/canonical/session.jsonl'
    await mkdir(join(directory, 'trajectory/canonical'), { recursive: true })
    await writeFile(join(directory, path), content, 'utf8')
    files.push({ role: 'canonical_session', path, media_type: 'application/x-ndjson', sha256: digest(content), bytes: Buffer.byteLength(content) })
  } else if (value.trajectory === 'provider-only') {
    const content = value.providerContent ?? '{"native":true}\n'
    const path = 'trajectory/provider/events.jsonl'
    await mkdir(join(directory, 'trajectory/provider'), { recursive: true })
    await writeFile(join(directory, path), content, 'utf8')
    files.push({ role: 'provider_events', path, media_type: 'application/x-ndjson', sha256: digest(content), bytes: Buffer.byteLength(content) })
  } else if (value.trajectory === 'corrupt-path') {
    files.push({ role: 'canonical_session', path: '../outside', media_type: 'application/x-ndjson', sha256: `sha256:${'0'.repeat(64)}`, bytes: 1 })
  }
  if (value.trajectory !== 'missing') {
    await json(join(directory, 'trajectory.ref.json'), { schema_version: '2', run_id: value.runId, files })
  }
  const valid = value.invalidReason === undefined
  const manifest = {
    schema_version: '1',
    run_id: value.runId,
    sealed: value.sealed ?? true,
    context: {
      kind: 'benchmark_task', benchmark_id: 'bench', benchmark_revision: 'rev', task_id: value.taskId ?? 'task-1',
      task_digest: 'task-digest', verifier_identity: 'verifier',
    },
    parent: {
      kind: 'eval',
      eval_id: value.corruptOwnership ? 'eval-other' : evalId,
      trial_id: value.trialId,
      attempt: value.attempt,
    },
    status: 'succeeded',
    harness: { requested_ref: String(value.candidateId), harness_id: String(value.candidateId), revision_identity: `rev-${value.candidateId}` },
    model: { requested_id: 'model', provider: 'test', effective_id: 'model-snapshot', identity_resolved: true },
    protocol: { timeout_ms: value.protocolTimeout ?? 1_000 },
    observation: valid ? { status: 'valid', reward: value.reward } : { status: 'invalid', invalid_reason: value.invalidReason },
    ...(value.trajectory === 'missing' ? {} : { trajectory_ref: 'trajectory.ref.json' }),
  }
  await json(join(directory, 'manifest.json'), manifest)
  if (value.sealedBundle === true) {
    if (value.bundleExecution === true) {
      await json(join(directory, 'execution.json'), { schema_version: '1', provider: 'local-docker', worker_id: 'worker-1' })
      await json(join(directory, 'environment', 'image.manifest.json'), { schema_version: '1', reference: 'registry/image@sha256:123' })
    }
    if (value.interactions !== undefined) {
      const rows = value.interactions.map((interaction, ordinal) => ({
        schema_version: '1',
        interaction_id: `interaction_${String(ordinal + 1).padStart(32, '0')}`,
        run_id: value.runId,
        sequence: ordinal + 1,
        requested_model: 'model',
        endpoint_identity: digest('endpoint'),
        started_at: '2026-09-01T00:00:00.000Z',
        status: 'succeeded',
        ...interaction,
      }))
      await mkdir(join(directory, 'interactions'), { recursive: true })
      await writeFile(join(directory, 'interactions', 'interactions.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length === 0 ? '' : '\n'}`, 'utf8')
      await json(join(directory, 'interactions', 'interaction.ref.json'), {
        schema_version: '1', run_id: value.runId, mode: 'proxy', required: false, topology: 'host-side',
        completeness: rows.length === 0 ? 'none' : 'complete', interaction_count: rows.length,
        interactions_ref: 'interactions/interactions.jsonl',
        redaction: { policy: 'hitch-model-interaction-redaction-v1', status: 'not-needed', rules: [] },
      })
    }
    const trial = {
      trial_id: value.trialId, run_id: value.runId, task_id: value.taskId ?? 'task-1', attempt: value.attempt,
      ...(valid ? { observation_status: 'valid', reward: value.reward } : { observation_status: 'invalid', invalid_reason: value.invalidReason }),
    }
    await json(join(directory, 'eval', 'publication.json'), {
      schema_version: '1', eval_id: evalId, mode: 'settle', trial, created_at: '2026-09-01T00:00:00.000Z',
    })
    await sealBundle(directory, manifest, value.bundleExecution === true)
  }
}

async function evaluation(root: string, evalId: HitchEvalId, fixtures: readonly RunFixture[]): Promise<void> {
  for (const fixture of fixtures) await run(root, evalId, fixture)
  await json(join(root, 'evals', evalId, 'result.json'), {
    schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'succeeded',
    trials: fixtures.map(value => ({
      trial_id: value.trialId, run_id: value.runId, task_id: value.taskId ?? 'task-1', attempt: value.attempt,
      ...(value.invalidReason === undefined
        ? { observation_status: 'valid', reward: value.reward }
        : { observation_status: 'invalid', invalid_reason: value.invalidReason }),
    })),
  })
}

function ref(evalId: HitchEvalId, candidateId: RefinementCandidateId): RefinementEvaluationRef {
  return { providerId: 'hitch', evalId, candidateId, requestedModelId: 'model', benchmarkId: 'bench', benchmarkRevision: 'rev' }
}

describe('HitchRefinementEvidenceProvider', () => {
  it('watches a Gear-owned eval id before its Hitch directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-early-watch-'))
    roots.push(root)
    await mkdir(join(root, 'evals'), { recursive: true })
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const changed = vi.fn()
    const evalId = 'eval_early_watch' as HitchEvalId
    const dispose = provider.watchEval(evalId, changed)
    // macOS FSEvents can acknowledge a newly-created watcher asynchronously;
    // let the watch settle before exercising the create-directory edge.
    await new Promise(resolve => setTimeout(resolve, 50))
    await json(join(root, 'evals', evalId, 'request.json'), { benchmark_id: 'bench', benchmark_revision: 'rev' })
    await vi.waitFor(() => { expect(changed).toHaveBeenCalled() }, { timeout: 10_000 })
    dispose()
  }, 15_000)

  it('projects and validates daemon control-plane lifecycle without using it as trial membership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-control-plane-'))
    roots.push(root)
    const evalId = `eval_${'1'.repeat(32)}` as HitchEvalId
    const request = {
      schema_version: '1', backend: 'harbor', dataset: 'bench@rev', benchmark_id: 'bench', benchmark_revision: 'rev',
      harness_ref: 'pi@version:1.0.0', model: 'model', attempts: 1, max_concurrent: 2,
    }
    const execution = {
      provider: 'local-docker', max_parallelism: 2,
      resources: { default_trial: { cpu_millis: 1_000, memory_bytes: 1_024, container_slots: 1, build_slots: 0 } },
      build: { mode: 'backend' }, model_capture: { mode: 'native', required: false },
    }
    const now = '2026-09-01T00:00:00.000Z'
    await json(join(root, 'evals', evalId, 'request.json'), request)
    await json(join(root, 'evals', evalId, 'submission.json'), {
      schema_version: '1', eval_id: evalId, request, execution,
      submission_digest: digestJson({ request, execution }), submitted_at: now,
    })
    await json(join(root, 'evals', evalId, 'execution-plan.json'), {
      schema_version: '1', eval_id: evalId,
      slots: [{ task_id: 'task-a' }, { task_id: 'task-b' }, { task_id: 'task-a' }],
    })
    const control = (state: string, generation: number, error?: Record<string, unknown>) => ({
      schema_version: '1', eval_id: evalId, generation, state,
      requested_parallelism: 2, admitted_parallelism: state === 'queued' ? 0 : 1,
      active_leases: [], queued_work_items: [], terminal_work_items: [],
      ...(error === undefined ? {} : { error }), created_at: now, updated_at: now,
    })
    await json(join(root, 'evals', evalId, 'control.json'), control('queued', 0))
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(evalId, 'candidate-control' as RefinementCandidateId))).resolves.toMatchObject({
      status: 'queued', phase: 'queued', plannedTasks: 2, settledTasks: 0, runs: [], diagnostics: [],
    })

    await json(join(root, 'evals', evalId, 'control.json'), control('planning', 1))
    await expect(provider.evaluation(ref(evalId, 'candidate-control' as RefinementCandidateId))).resolves.toMatchObject({
      status: 'running', phase: 'planning', settledTasks: 0,
    })

    await json(join(root, 'evals', evalId, 'result.json'), {
      schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev',
      status: 'cancelled', trials: [], error: { code: 'cancelled', message: 'cancelled before launch' },
    })
    await json(join(root, 'evals', evalId, 'control.json'), control('cancelled', 2, { code: 'cancelled', message: 'cancelled before launch' }))
    await expect(provider.evaluation(ref(evalId, 'candidate-control' as RefinementCandidateId))).resolves.toMatchObject({
      status: 'cancelled', settledTasks: 0, diagnostics: [{ code: 'cancelled', message: 'cancelled before launch' }],
    })
  })

  it('preserves attempts, invalid observations, and canonical/provider-only availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-provider-'))
    roots.push(root)
    const evalId = 'eval_fixture' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const fixtures: RunFixture[] = [
      { runId: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HitchRunId, candidateId, trialId: 'trial-a', attempt: 1, reward: 0, trajectory: 'canonical' },
      { runId: 'run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as HitchRunId, candidateId, trialId: 'trial-b', attempt: 2, invalidReason: 'infrastructure', trajectory: 'provider-only' },
      { runId: 'run_cccccccccccccccccccccccccccccccc' as HitchRunId, candidateId, trialId: 'trial-c', attempt: 3, reward: 1, trajectory: 'missing' },
    ]
    await evaluation(root, evalId, fixtures)
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const projection = await provider.evaluation(ref(evalId, candidateId))
    expect(projection.runs.map(item => item.attempt)).toEqual([1, 2, 3])
    expect(projection.runs.map(item => item.trajectory.availability)).toEqual(['available', 'provider-only', 'missing'])
    expect(projection.runs[0]?.observation).toEqual({ state: 'valid', reward: 0 })
    expect(projection.runs[1]?.observation).toEqual({ state: 'invalid', reason: 'infrastructure' })
    expect(projection.runs[0]?.trajectory.summary?.ttftMs).toBe(2)
    const document = await provider.trajectory({ evalRef: ref(evalId, candidateId), runId: fixtures[0]?.runId as HitchRunId })
    expect(document.records).toHaveLength(7)
    const page = await provider.providerEvidence({
      evalRef: ref(evalId, candidateId),
      runId: fixtures[1]?.runId as HitchRunId,
      fileOrdinal: 0,
      cursor: null,
      maxBytes: 1_024,
    })
    expect(page.content).toContain('native')
  })

  it('marks escaped evidence paths corrupt before returning bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-corrupt-'))
    roots.push(root)
    const evalId = 'eval_corrupt' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const fixture: RunFixture = {
      runId: 'run_dddddddddddddddddddddddddddddddd' as HitchRunId,
      candidateId,
      trialId: 'trial-d',
      attempt: 1,
      reward: 1,
      trajectory: 'corrupt-path',
    }
    await evaluation(root, evalId, [fixture])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const projection = await provider.evaluation(ref(evalId, candidateId))
    expect(projection.runs[0]?.trajectory.availability).toBe('corrupt')
    expect(projection.runs[0]?.integrity).toBe('corrupt')
  })

  it('verifies additive sealed bundle indexes and eval publication receipts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-bundle-index-'))
    roots.push(root)
    const evalId = `eval_${'2'.repeat(32)}` as HitchEvalId
    const fixture: RunFixture = {
      runId: `run_${'3'.repeat(32)}` as HitchRunId,
      candidateId: 'candidate-bundle' as RefinementCandidateId,
      trialId: 'task-one__1', taskId: 'task-one', attempt: 1, reward: 1,
      trajectory: 'provider-only', sealedBundle: true,
      bundleExecution: true,
      interactions: [{ usage: { input_tokens: 7, output_tokens: 3 } }],
    }
    await evaluation(root, evalId, [fixture])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(evalId, fixture.candidateId))).resolves.toMatchObject({
      status: 'succeeded', runs: [{
        id: fixture.runId,
        integrity: 'valid',
        executionEvidence: {
          provider: 'local-docker', workerId: 'worker-1', leaseId: `lease_${'5'.repeat(32)}`,
          requestedResources: { cpu_millis: 1_000 }, observedResources: { cpu_millis: 900 },
        },
        capture: { mode: 'proxy', completeness: 'complete', interactionCount: 1, interactionAvailable: true },
      }],
      diagnostics: [],
    })
    const interactions = await provider.interactionEvidence({
      evalRef: ref(evalId, fixture.candidateId), runId: fixture.runId, cursor: null, maxBytes: 2_048,
    })
    expect(interactions.encoding).toBe('utf8')
    expect(interactions.content).toContain('input_tokens')

    const indexPath = join(root, 'runs', fixture.runId, 'bundle.index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as Record<string, unknown>
    await json(indexPath, { ...index, bundle_digest: `sha256:${'0'.repeat(64)}` })
    const fresh = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(fresh.evaluation(ref(evalId, fixture.candidateId))).resolves.toMatchObject({
      status: 'succeeded', runs: [], diagnostics: [{ code: 'corrupt-run-link' }],
    })
  })

  it('pages text evidence without splitting UTF-8 code points', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-utf8-'))
    roots.push(root)
    const evalId = 'eval_utf8' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const content = '证据🧪'.repeat(80)
    const fixture: RunFixture = {
      runId: 'run_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as HitchRunId,
      candidateId,
      trialId: 'trial-e',
      attempt: 1,
      reward: 1,
      trajectory: 'provider-only',
      providerContent: content,
    }
    await evaluation(root, evalId, [fixture])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const pages: string[] = []
    let cursor: string | null = null
    do {
      const page = await provider.providerEvidence({
        evalRef: ref(evalId, candidateId),
        runId: fixture.runId,
        fileOrdinal: 0,
        cursor,
        maxBytes: 512,
      })
      pages.push(page.content)
      cursor = page.nextCursor
    } while (cursor !== null)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join('')).toBe(content)
    expect(pages.join('')).not.toContain('�')
  })

  it('keeps running evaluations run-free and reports corrupt eval/run ownership links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-lifecycle-'))
    roots.push(root)
    const runningId = 'eval_running' as HitchEvalId
    await mkdir(join(root, 'evals', runningId), { recursive: true })
    await json(join(root, 'evals', runningId, 'plan.json'), { tasks: [{ id: 'a' }, { id: 'b' }] })
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(runningId, 'candidate-a' as RefinementCandidateId))).resolves.toMatchObject({
      status: 'running',
      plannedTasks: 2,
      settledTasks: 0,
      runs: [],
    })

    const corruptId = 'eval_corrupt_link' as HitchEvalId
    const corrupt: RunFixture = {
      runId: 'run_ffffffffffffffffffffffffffffffff' as HitchRunId,
      candidateId: 'candidate-a' as RefinementCandidateId,
      trialId: 'trial-f',
      attempt: 1,
      reward: 1,
      trajectory: 'canonical',
      corruptOwnership: true,
    }
    await evaluation(root, corruptId, [corrupt])
    const projection = await provider.evaluation(ref(corruptId, corrupt.candidateId))
    expect(projection.runs).toEqual([])
    expect(projection.diagnostics).toMatchObject([{ code: 'corrupt-run-link' }])

    const unsealedId = 'eval_unsealed_link' as HitchEvalId
    const unsealed: RunFixture = {
      runId: `run_${'8'.repeat(32)}` as HitchRunId,
      candidateId: 'candidate-a' as RefinementCandidateId,
      trialId: 'trial-unsealed', attempt: 1, reward: 1, trajectory: 'canonical', sealed: false,
    }
    await evaluation(root, unsealedId, [unsealed])
    await expect(provider.evaluation(ref(unsealedId, unsealed.candidateId))).resolves.toMatchObject({
      runs: [], diagnostics: [{ code: 'corrupt-run-link' }],
    })
  })

  it('projects published progress trials before terminal result and rejects a conflicting final set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-progress-'))
    roots.push(root)
    const evalId = 'eval_progress' as HitchEvalId
    const candidateId = 'candidate-progress' as RefinementCandidateId
    const fixture: RunFixture = {
      runId: 'run_99999999999999999999999999999999' as HitchRunId,
      candidateId,
      trialId: 'task-one__1',
      attempt: 1,
      reward: 1,
      trajectory: 'canonical',
      taskId: 'task-one',
    }
    const progress = (trials: readonly Record<string, unknown>[], generation: number) => ({
      schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'running',
      generation, planned_tasks: 2, planned_trials: 2, trials,
      summary: {
        settled_trials: trials.length,
        valid_trials: trials.filter(trial => trial['observation_status'] === 'valid').length,
        invalid_trials: trials.filter(trial => trial['observation_status'] === 'invalid').length,
      },
      started_at: '2026-08-26T00:00:00.000Z', updated_at: `2026-08-26T00:00:0${generation}.000Z`,
    })
    await json(join(root, 'evals', evalId, 'progress.json'), progress([], 0))
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(evalId, candidateId))).resolves.toMatchObject({
      status: 'running', plannedTasks: 2, settledTasks: 0, runs: [],
    })

    await run(root, evalId, fixture)
    const trial = {
      trial_id: fixture.trialId, run_id: fixture.runId, task_id: fixture.taskId,
      attempt: 1, observation_status: 'valid', reward: 1,
    }
    await json(join(root, 'evals', evalId, 'progress.json'), progress([trial], 1))
    const partial = await provider.evaluation(ref(evalId, candidateId))
    expect(partial).toMatchObject({ status: 'running', plannedTasks: 2, settledTasks: 1 })
    expect(partial.runs).toHaveLength(1)
    await expect(provider.trajectory({ evalRef: ref(evalId, candidateId), runId: fixture.runId })).resolves.toMatchObject({
      runId: fixture.runId,
    })

    await json(join(root, 'evals', evalId, 'result.json'), {
      schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'succeeded', trials: [trial],
    })
    await expect(provider.evaluation(ref(evalId, candidateId))).resolves.toMatchObject({ status: 'succeeded', runs: [{ id: fixture.runId }] })
    await json(join(root, 'evals', evalId, 'result.json'), {
      schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'succeeded', trials: [],
    })
    await expect(provider.evaluation(ref(evalId, candidateId))).resolves.toMatchObject({
      status: 'corrupt', runs: [], diagnostics: [{ code: 'corrupt-eval' }],
    })
  })

  it('uses task progress during an active rerun while the terminal result is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-rerun-progress-'))
    roots.push(root)
    const evalId = 'eval_rerun_progress' as HitchEvalId
    const candidateId = 'candidate-rerun' as RefinementCandidateId
    const retained: RunFixture = {
      runId: 'run_77777777777777777777777777777777' as HitchRunId,
      candidateId, trialId: 'task-one__1', attempt: 1, reward: 0.25, trajectory: 'canonical', taskId: 'task-one',
    }
    const invalid: RunFixture = {
      runId: 'run_66666666666666666666666666666666' as HitchRunId,
      candidateId, trialId: 'task-two__1', attempt: 1, invalidReason: 'infra', trajectory: 'provider-only', taskId: 'task-two',
    }
    const repaired: RunFixture = {
      runId: 'run_55555555555555555555555555555555' as HitchRunId,
      candidateId, trialId: 'task-two__1', attempt: 1, reward: 1, trajectory: 'canonical', taskId: 'task-two',
    }
    await evaluation(root, evalId, [retained, invalid])
    await run(root, evalId, repaired)
    const trials = [retained, repaired].map(value => ({
      trial_id: value.trialId, run_id: value.runId, task_id: value.taskId, attempt: value.attempt,
      observation_status: 'valid', reward: value.reward,
    }))
    await json(join(root, 'evals', evalId, 'progress.json'), {
      schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'running',
      generation: 3, planned_tasks: 2, planned_trials: 2, trials,
      summary: { settled_trials: 2, valid_trials: 2, invalid_trials: 0 },
      started_at: '2026-08-26T00:00:00.000Z', updated_at: '2026-08-26T00:01:00.000Z',
    })
    const rerunId = `rerun_${'4'.repeat(32)}`
    await json(join(root, 'evals', evalId, 'reruns', rerunId, 'state.json'), {
      schema_version: '1', rerun_id: rerunId, eval_id: evalId, status: 'queued',
      rerun_type: 'verifier-only', semantics: { preserve_run_identity: true },
      tasks: ['task-two'], repaired_tasks: [], trials: [{ task_id: 'task-two', attempt: 1 }],
      submitted_at: '2026-08-26T00:00:20.000Z', updated_at: '2026-08-26T00:00:20.000Z',
    })
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(evalId, candidateId))).resolves.toMatchObject({ status: 'rerunning' })
    await json(join(root, 'evals', evalId, 'reruns', rerunId, 'state.json'), {
      schema_version: '1', rerun_id: rerunId, eval_id: evalId, status: 'running',
      rerun_type: 'verifier-only', semantics: { preserve_run_identity: true },
      tasks: ['task-two'], repaired_tasks: ['task-two'],
      started_at: '2026-08-26T00:00:30.000Z', updated_at: '2026-08-26T00:01:00.000Z',
    })
    const projection = await provider.evaluation(ref(evalId, candidateId))
    expect(projection).toMatchObject({
      status: 'rerunning', plannedTasks: 2, settledTasks: 2,
      runs: [
        { id: retained.runId, observation: { state: 'valid', reward: 0.25 } },
        { id: repaired.runId, observation: { state: 'valid', reward: 1 } },
      ],
    })
  })

  it('owns strict harness comparison and degrades protocol mismatches to exploratory evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-comparison-'))
    roots.push(root)
    const baselineId = 'eval_baseline' as HitchEvalId
    const candidateId = 'eval_candidate' as HitchEvalId
    const mismatchId = 'eval_mismatch' as HitchEvalId
    const baseline: RunFixture = {
      runId: 'run_11111111111111111111111111111111' as HitchRunId,
      candidateId: 'candidate-a' as RefinementCandidateId,
      trialId: 'trial-1', attempt: 1, reward: 0, trajectory: 'canonical',
    }
    const candidate: RunFixture = {
      runId: 'run_22222222222222222222222222222222' as HitchRunId,
      candidateId: 'candidate-b' as RefinementCandidateId,
      trialId: 'trial-2', attempt: 1, reward: 1, trajectory: 'canonical',
    }
    const mismatch: RunFixture = {
      runId: 'run_33333333333333333333333333333333' as HitchRunId,
      candidateId: 'candidate-c' as RefinementCandidateId,
      trialId: 'trial-3', attempt: 1, reward: 1, trajectory: 'canonical', protocolTimeout: 2_000, taskId: 'task-2',
    }
    await evaluation(root, baselineId, [baseline])
    await evaluation(root, candidateId, [candidate])
    await evaluation(root, mismatchId, [mismatch])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const strict = await provider.compare({
      refs: [ref(baselineId, baseline.candidateId), ref(candidateId, candidate.candidateId)],
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(strict.strict).toBe(true)
    expect(strict.tasks).toMatchObject([{ referenceMean: 0, candidateMean: 1, delta: 1, status: 'improved' }])

    const exploratory = await provider.compare({
      refs: [ref(baselineId, baseline.candidateId), ref(mismatchId, mismatch.candidateId)],
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(exploratory.strict).toBe(false)
    expect(exploratory.exclusions).toContainEqual({ runId: mismatch.runId, code: 'protocol-identity-mismatch' })
    expect(exploratory.exclusions).toContainEqual({ runId: mismatch.runId, code: 'benchmark-reference-missing' })
  })
})
