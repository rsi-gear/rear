import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HitchEvalId,
  HitchRunId,
  RefinementCandidateId,
  RefinementGetResult,
  RefinementGetRequest,
  RefinementId,
  RefinementIterationId,
  RefinementRecordV1,
  RefinementVersion,
} from '../../src/types.ts'
import {
  RefinementController,
  type RefinementRemoteClient,
} from '../../src/client/controller.ts'

const SID = 'session-refinement' as SessionId

function record(id: string, createdAt = 1): RefinementRecordV1 {
  return {
    schemaVersion: 1,
    id: id as RefinementId,
    session: { sessionId: SID, createdAt: 1 },
    objective: id,
    driver: { id: 'fixture', operationId: null },
    evidenceProviderId: 'hitch',
    status: 'running',
    baselineCandidateId: null,
    activeIterationId: null,
    candidates: [],
    iterations: [],
    createdAt,
    updatedAt: createdAt,
    version: `version-${id}` as RefinementVersion,
  }
}

function summary(value: RefinementRecordV1) {
  return {
    id: value.id,
    objective: value.objective,
    status: value.status,
    activeIterationId: value.activeIterationId,
    iterationCount: value.iterations.length,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
  }
}

function remote(records: RefinementRecordV1[]): RefinementRemoteClient {
  return {
    list: vi.fn(async () => ({ ok: true as const, value: { records: records.map(summary) } })),
    get: vi.fn(async (request: RefinementGetRequest) => ({
      ok: true as const,
      value: records.find(value => value.id === request.refinementId) ?? records[0] as RefinementRecordV1,
    })),
    evaluation: vi.fn(async () => ({ ok: false as const, error: { code: 'evaluation-not-found' as const, message: 'unused' } })),
    trajectory: vi.fn(async () => ({ ok: false as const, error: { code: 'trajectory-not-found' as const, message: 'unused' } })),
    providerEvidence: vi.fn(async () => ({ ok: false as const, error: { code: 'trajectory-not-found' as const, message: 'unused' } })),
    interactionEvidence: vi.fn(async () => ({ ok: false as const, error: { code: 'trajectory-not-found' as const, message: 'unused' } })),
    changes: vi.fn((_request, signal?: AbortSignal) => new Promise<{
      readonly token: string | null
      readonly refinementId: RefinementId | null
    }>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

describe('RefinementController', () => {
  it('closes provider evidence only for its owning run', async () => {
    const first = record('refinement-a')
    const runId = 'run-a' as HitchRunId
    const client = remote([first])
    client.providerEvidence = vi.fn(async () => ({
      ok: true as const,
      value: {
        runId,
        file: { ordinal: 0, role: 'provider', mediaType: 'application/x-ndjson', bytes: 2, sha256: '00' },
        encoding: 'utf8' as const,
        content: '{}',
        nextCursor: null,
      },
    }))
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await controller.loadProviderEvidence(runId, 0, null)
    expect(controller.getSnapshot().providerEvidence?.runId).toBe(runId)
    controller.closeProviderEvidence('run-b' as HitchRunId)
    expect(controller.getSnapshot().providerEvidence?.runId).toBe(runId)
    controller.closeProviderEvidence(runId)
    expect(controller.getSnapshot().providerEvidence).toBeNull()
    controller.dispose()
  })

  it('keeps model-interaction evidence separate from provider-native evidence', async () => {
    const first = record('refinement-a')
    const runId = 'run-a' as HitchRunId
    const client = remote([first])
    client.interactionEvidence = vi.fn(async () => ({
      ok: true as const,
      value: {
        runId,
        file: { ordinal: 0, role: 'interaction-capture', mediaType: 'application/x-ndjson', bytes: 3, sha256: '00' },
        encoding: 'utf8' as const,
        content: '{}\n',
        nextCursor: null,
      },
    }))
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await controller.loadInteractionEvidence(runId, null)
    expect(controller.getSnapshot().interactionEvidence?.runId).toBe(runId)
    expect(controller.getSnapshot().providerEvidence).toBeNull()
    controller.closeInteractionEvidence('run-b' as HitchRunId)
    expect(controller.getSnapshot().interactionEvidence?.runId).toBe(runId)
    controller.closeInteractionEvidence(runId)
    expect(controller.getSnapshot().interactionEvidence).toBeNull()
    controller.dispose()
  })

  it('cold-loads once and coalesces duplicate matching invalidations', async () => {
    const first = record('refinement-a')
    const client = remote([first])
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await controller.ensure()
    // oxlint-disable-next-line typescript/unbound-method -- Vitest mock inspection does not invoke the method.
    expect(client.list).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().detail?.id).toBe(first.id)

    controller.invalidate(first.id)
    controller.invalidate(first.id)
    await vi.waitFor(() => {
      // oxlint-disable-next-line typescript/unbound-method -- Vitest mock inspection does not invoke the method.
      expect(client.list).toHaveBeenCalledTimes(2)
    })
    controller.dispose()
  })

  it('aborts superseded detail reads and rejects their stale response', async () => {
    const first = record('refinement-a')
    const second = record('refinement-b', 2)
    const a = deferred<RefinementGetResult>()
    const b = deferred<RefinementGetResult>()
    let firstSignal: AbortSignal | undefined
    const client = remote([second, first])
    client.get = vi.fn((request: RefinementGetRequest, signal?: AbortSignal) => {
      if (request.refinementId === first.id) {
        firstSignal = signal
        return a.promise
      }
      return b.promise
    })
    const controller = new RefinementController(client, SID)
    const selectingA = controller.selectRefinement(first.id)
    const selectingB = controller.selectRefinement(second.id)
    expect(firstSignal?.aborted).toBe(true)
    b.resolve({ ok: true, value: second })
    await selectingB
    a.resolve({ ok: true, value: first })
    await selectingA
    expect(controller.getSnapshot().selectedRefinementId).toBe(second.id)
    expect(controller.getSnapshot().detail?.id).toBe(second.id)
    controller.dispose()
  })

  it('isolates state and invalidations between Session controllers', async () => {
    const first = record('refinement-a')
    const client = remote([first])
    const other = 'other-session' as SessionId
    const left = new RefinementController(client, SID)
    const right = new RefinementController(client, other)
    await left.ensure()
    right.invalidate(first.id)
    expect(right.getSnapshot().status).toBe('cold')
    expect(left.getSnapshot().status).toBe('ready')
    left.dispose()
    right.dispose()
  })

  it('re-synchronizes after reconnect while retaining a still-valid selection', async () => {
    const first = record('refinement-a')
    const second = record('refinement-b', 2)
    const client = remote([second, first])
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await controller.selectRefinement(first.id)
    await controller.resync()
    expect(controller.getSnapshot().selectedRefinementId).toBe(first.id)
    expect(controller.getSnapshot().detail?.id).toBe(first.id)
    // oxlint-disable-next-line typescript/unbound-method -- Vitest mock inspection does not invoke the method.
    expect(client.list).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('retains evaluation projections from every tested iteration for overview ranking', async () => {
    const candidateId = 'candidate-a' as RefinementCandidateId
    const firstIterationId = 'iteration-1' as RefinementIterationId
    const secondIterationId = 'iteration-2' as RefinementIterationId
    const evalRef = (ordinal: number) => ({
      providerId: 'hitch',
      evalId: `eval-${ordinal}` as HitchEvalId,
      candidateId,
      requestedModelId: 'model-a',
      benchmarkId: 'benchmark-a',
      benchmarkRevision: 'revision-a',
    })
    const value: RefinementRecordV1 = {
      ...record('refinement-history'),
      baselineCandidateId: candidateId,
      activeIterationId: secondIterationId,
      candidates: [{
        id: candidateId,
        role: 'baseline',
        parentCandidateId: null,
        requestedHarnessRef: 'harness-a',
        revisionIdentity: 'revision-a',
        label: 'Baseline',
        createdAt: 1,
      }],
      iterations: [firstIterationId, secondIterationId].map((id, index) => ({
        id,
        ordinal: index + 1,
        status: 'settled',
        candidateIds: [candidateId],
        evaluationRefs: [evalRef(index + 1)],
        createdAt: index + 1,
        completedAt: index + 2,
      })),
    }
    const client = remote([value])
    client.evaluation = vi.fn(async request => ({
      ok: true as const,
      value: {
        evidenceVersion: String(request.iterationId),
        evaluations: [],
        comparison: {
          strict: true,
          dimension: request.dimension,
          referenceRunId: null,
          exclusions: [],
          tasks: [],
        },
      },
    }))
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await vi.waitFor(() => {
      expect(Object.keys(controller.getSnapshot().evaluationHistory).sort()).toEqual([
        firstIterationId,
        secondIterationId,
      ])
    })
    controller.dispose()
  })

  it('opens a trajectory comparison from runs in different iterations', async () => {
    const candidateId = 'candidate-cross-iteration' as RefinementCandidateId
    const firstIterationId = 'iteration-cross-1' as RefinementIterationId
    const secondIterationId = 'iteration-cross-2' as RefinementIterationId
    const firstRunId = 'run-cross-1' as HitchRunId
    const secondRunId = 'run-cross-2' as HitchRunId
    const value: RefinementRecordV1 = {
      ...record('refinement-cross-iteration'),
      baselineCandidateId: candidateId,
      activeIterationId: secondIterationId,
      candidates: [{
        id: candidateId,
        role: 'baseline',
        parentCandidateId: null,
        requestedHarnessRef: 'harness-a',
        revisionIdentity: 'revision-a',
        label: 'Baseline',
        createdAt: 1,
      }],
      iterations: [firstIterationId, secondIterationId].map((id, index) => ({
        id,
        ordinal: index + 1,
        status: 'settled',
        candidateIds: [candidateId],
        evaluationRefs: [{
          providerId: 'hitch',
          evalId: `eval-cross-${index + 1}` as HitchEvalId,
          candidateId,
          requestedModelId: 'model-a',
          benchmarkId: 'benchmark-a',
          benchmarkRevision: 'revision-a',
        }],
        createdAt: index + 1,
      })),
    }
    const client = remote([value])
    client.evaluation = vi.fn(async request => {
      const first = request.iterationId === firstIterationId
      const runId = first ? firstRunId : secondRunId
      const evalId = `eval-cross-${first ? 1 : 2}` as HitchEvalId
      return {
        ok: true as const,
        value: {
          evidenceVersion: String(request.iterationId),
          evaluations: [{
            ref: {
              providerId: 'hitch', evalId, candidateId, requestedModelId: 'model-a',
              benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a',
            },
            status: 'succeeded' as const,
            plannedTasks: 1,
            settledTasks: 1,
            runs: [{
              id: runId,
              evalId,
              candidateId,
              trialId: `trial-${first ? 1 : 2}`,
              attempt: 1,
              taskKey: 'task-key-a',
              taskId: 'task-a',
              execution: 'succeeded' as const,
              observation: { state: 'valid' as const, reward: first ? 0 : 1 },
              integrity: 'valid' as const,
              harness: {
                requestedRef: first ? 'harness-a' : 'harness-b',
                id: first ? 'harness-a' : 'harness-b',
                revisionIdentity: first ? 'revision-a' : 'revision-b',
              },
              model: { requestedId: 'model-a', provider: 'test', effectiveId: 'model-a' },
              protocolIdentity: 'protocol-a',
              trajectory: { availability: 'available' as const, hasCanonical: true, providerFileCount: 0 },
            }],
            diagnostics: [],
          }],
          comparison: {
            strict: true,
            dimension: request.dimension,
            referenceRunId: null,
            exclusions: [],
            tasks: [],
          },
        },
      }
    })
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await vi.waitFor(() => {
      expect(Object.keys(controller.getSnapshot().evaluationHistory)).toHaveLength(2)
    })
    await controller.selectRuns([firstRunId, secondRunId])
    expect(controller.getSnapshot()).toMatchObject({
      level: 'comparison',
      selectedTaskKey: 'task-key-a',
      selectedRunIds: [firstRunId, secondRunId],
    })
    controller.dispose()
  })

  it('opens a provider-only task from a single failed baseline evaluation without duplicating its run', async () => {
    const candidateId = 'candidate-failed-baseline' as RefinementCandidateId
    const iterationId = 'iteration-failed' as RefinementIterationId
    const evalId = 'eval-failed' as HitchEvalId
    const runId = 'run-failed' as HitchRunId
    const evalRef = {
      providerId: 'hitch',
      evalId,
      candidateId,
      requestedModelId: 'model-a',
      benchmarkId: 'benchmark-a',
      benchmarkRevision: 'revision-a',
      failedEvaluation: {
        phase: 'seed-baseline',
        code: 'invalid-observation',
        message: 'invalid observation',
      },
    }
    const value: RefinementRecordV1 = {
      ...record('refinement-failed'),
      status: 'failed',
      baselineCandidateId: candidateId,
      candidates: [{
        id: candidateId,
        role: 'baseline',
        parentCandidateId: null,
        requestedHarnessRef: 'harness-a',
        revisionIdentity: 'revision-a',
        label: 'Failed baseline',
        createdAt: 1,
      }],
      iterations: [{
        id: iterationId,
        ordinal: 1,
        status: 'failed',
        candidateIds: [candidateId],
        evaluationRefs: [evalRef],
        createdAt: 1,
        completedAt: 2,
      }],
    }
    const client = remote([value])
    client.evaluation = vi.fn(async request => ({
      ok: true as const,
      value: {
        evidenceVersion: 'failed-evidence',
        evaluations: [{
          ref: evalRef,
          status: 'failed' as const,
          plannedTasks: 1,
          settledTasks: 1,
          runs: [{
            id: runId,
            evalId,
            candidateId,
            trialId: 'trial-1',
            attempt: 1,
            taskKey: 'task-key',
            taskId: 'task-1',
            execution: 'failed' as const,
            observation: { state: 'invalid' as const, reason: 'invalid observation' },
            integrity: 'valid' as const,
            harness: { requestedRef: 'harness-a', id: 'harness-a', revisionIdentity: 'revision-a' },
            model: { requestedId: 'model-a', provider: 'test', effectiveId: 'model-a' },
            protocolIdentity: 'protocol-a',
            trajectory: { availability: 'provider-only' as const, hasCanonical: false, providerFileCount: 1 },
          }],
          diagnostics: [],
        }],
        comparison: {
          strict: false,
          dimension: request.dimension,
          referenceRunId: runId,
          exclusions: [],
          tasks: [{
            taskKey: 'task-key',
            taskId: 'task-1',
            referenceRunIds: [runId],
            candidateRunIds: [runId],
            referenceMean: null,
            candidateMean: null,
            delta: null,
            status: 'invalid' as const,
          }],
        },
      },
    }))
    const controller = new RefinementController(client, SID)
    await controller.ensure()
    await controller.openTask('task-key')
    expect(controller.getSnapshot()).toMatchObject({
      level: 'comparison',
      selectedRunIds: [runId],
      attemptPairing: 'unpaired',
      trajectories: { [runId]: null },
    })
    controller.dispose()
  })
})
