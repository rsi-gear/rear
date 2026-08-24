/** Durable storage-domain declaration for refinement sidecars. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  HitchEvalId,
  RefinementCandidateId,
  RefinementId,
  RefinementIterationId,
  RefinementRecordV1,
  RefinementVersion,
} from './types.ts'

const safeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const failure = z.object({ code: z.string().min(1), message: z.string() })
const candidateId = z.string().min(1).transform(value => value as RefinementCandidateId)
const iterationId = z.string().min(1).transform(value => value as RefinementIterationId)

/** Runtime schema for one complete refinement row. */
export const refinementRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).transform(value => value as RefinementId),
  session: z.object({
    sessionId: z.string().min(1),
    createdAt: safeTime,
    cwd: z.string().optional(),
  }),
  objective: z.string().nullable(),
  driver: z.object({ id: z.string().min(1), operationId: z.string().min(1).nullable() }),
  evidenceProviderId: z.string().min(1),
  status: z.enum(['queued', 'running', 'awaiting-review', 'completed', 'failed', 'cancelled']),
  baselineCandidateId: candidateId.nullable(),
  activeIterationId: iterationId.nullable(),
  candidates: z.array(z.object({
    id: candidateId,
    role: z.enum(['baseline', 'candidate']),
    parentCandidateId: candidateId.nullable(),
    requestedHarnessRef: z.string().min(1),
    revisionIdentity: z.string().min(1).nullable(),
    label: z.string().min(1),
    createdAt: safeTime,
  })),
  iterations: z.array(z.object({
    id: iterationId,
    ordinal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['preparing', 'evaluating', 'settled', 'failed', 'cancelled']),
    candidateIds: z.array(candidateId),
    evaluationRefs: z.array(z.object({
      providerId: z.string().min(1),
      evalId: z.string().min(1).transform(value => value as HitchEvalId),
      candidateId,
      requestedModelId: z.string().min(1),
      benchmarkId: z.string().min(1),
      benchmarkRevision: z.string().min(1),
    })),
    createdAt: safeTime,
    completedAt: safeTime.optional(),
    failure: failure.optional(),
  })),
  createdAt: safeTime,
  updatedAt: safeTime,
  completedAt: safeTime.optional(),
  failure: failure.optional(),
  version: z.uuid().transform(value => value as RefinementVersion),
}).superRefine((record, ctx) => {
  if (record.updatedAt < record.createdAt) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt precedes createdAt' })
  }
  const candidates = new Set(record.candidates.map(item => item.id))
  if (candidates.size !== record.candidates.length) {
    ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'candidate ids must be unique' })
  }
  const iterations = new Set(record.iterations.map(item => item.id))
  if (iterations.size !== record.iterations.length) {
    ctx.addIssue({ code: 'custom', path: ['iterations'], message: 'iteration ids must be unique' })
  }
  if (record.baselineCandidateId !== null && !candidates.has(record.baselineCandidateId)) {
    ctx.addIssue({ code: 'custom', path: ['baselineCandidateId'], message: 'baseline candidate is absent' })
  }
  if (record.activeIterationId !== null && !iterations.has(record.activeIterationId)) {
    ctx.addIssue({ code: 'custom', path: ['activeIterationId'], message: 'active iteration is absent' })
  }
  for (const [index, iteration] of record.iterations.entries()) {
    if (iteration.candidateIds.some(id => !candidates.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['iterations', index, 'candidateIds'], message: 'iteration references an absent candidate' })
    }
    if (iteration.evaluationRefs.some(ref => ref.providerId !== record.evidenceProviderId || !candidates.has(ref.candidateId))) {
      ctx.addIssue({ code: 'custom', path: ['iterations', index, 'evaluationRefs'], message: 'evaluation ref escapes its refinement' })
    }
  }
}) as unknown as z.ZodType<RefinementRecordV1>

/** One row per refinement; the Session index is rebuilt from row ownership. */
export const refinementDomainSpec = defineDomain({
  name: 'refinement',
  version: 1,
  tables: {
    refinements: domainTable<RefinementId, RefinementRecordV1>(refinementRecordSchema),
  },
})
