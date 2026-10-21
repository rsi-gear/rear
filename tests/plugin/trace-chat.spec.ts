import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TraceChatService, traceChatRequestSchema, type TraceChatRequest } from '../../src/trace-chat.ts'
import { readTraceSnapshot, sha256, TRACE_EXPORT_MAX_BYTES } from '../../src/trace-context.ts'
import { trajectoryPage } from '../../src/trajectory-pages.ts'
import type { RefinementRuntime } from '../../src/runtime.ts'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const path = await realpath(await mkdtemp(join(tmpdir(), 'rear-trace-chat-'))); roots.push(path); return path }
function trace(runId: string, system: string): CanonicalTrajectoryDocument {
  return { runId: runId as never, header: { id: `source-${runId}` } as never,
    records: [{ type: 'request/header', seq: 42, time: 100, data: { header: { system } } }] }
}
const documents = { a: trace('a', '中文🙂 ARCHIVED_INSTRUCTION '.repeat(30)), b: trace('b', 'SYSTEM_B'), c: trace('c', 'UNSELECTED') }
function runtime(docs: Record<string, CanonicalTrajectoryDocument> = documents): RefinementRuntime {
  return {
    get: () => ({ ok: true, value: { id: 'experiment', objective: 'Inspect fixtures', version: 'version-1', session: { cwd: '/unused' } } }),
    trajectoryPage: async ({ runId, cursor }: { runId: string; cursor: string | null }) => docs[runId]
      ? { ok: true, value: trajectoryPage(docs[runId], cursor, 512) }
      : { ok: false, error: { message: 'Run is outside this experiment' } },
  } as unknown as RefinementRuntime
}
function request(): TraceChatRequest {
  return { sessionId: 'source', refinementId: 'experiment', runIds: ['b', 'a'], requestId: randomUUID(), question: 'Compare actual system prompts' }
}
const success = (value: unknown) => ({ rpcId: 'test', result: { ok: true, value } })
function host() {
  const api = {
    workspace: {
      create: vi.fn(async ({ payload }: { payload: { path: string } }) => success({ workspace: { workspaceId: 'workspace', path: payload.path } })),
      rename: vi.fn(async () => success({})),
    },
    sessions: {
      models: vi.fn(async () => success({ routable: true, current: { provider: 'fixture', model: 'model', reasoningEffort: 'high' } })),
      create: vi.fn(async ({ payload }: { payload: { sessionId: string } }) => success({ sessionId: payload.sessionId })),
      selectModel: vi.fn(async () => success({})),
      rename: vi.fn(async () => success({})),
      prompt: vi.fn(async () => success({ accepted: true })),
    },
  }
  return { api, ctx: { get: (name: string) => name === 'apiProxy' ? api : undefined } as unknown as Context }
}
const signal = () => new AbortController().signal

describe('durable native trace chats', () => {
  it('prepares a blank native chat without inference and preserves later model choices on retry/restart', async () => {
    const path = await root(), { api, ctx } = host()
    const { question: _question, ...input } = request()
    expect(traceChatRequestSchema.safeParse(input).success).toBe(true)
    const service = new TraceChatService(ctx, runtime(), path)
    const [chat, duplicate] = await Promise.all([service.create({ ...input, locale: 'zh' }, signal()), service.create(input, signal())])
    expect(chat).toEqual(duplicate)
    expect(chat.title).toContain('轨迹分析 · 2 条轨迹')
    expect(api.sessions.prompt).not.toHaveBeenCalled()
    expect(api.sessions.selectModel).toHaveBeenCalledTimes(1)
    const record = JSON.parse(await readFile(join(chat.directory, 'session.json'), 'utf8'))
    expect(record).toMatchObject({ prompt: '', promptStatus: 'idle' })
    expect(await new TraceChatService(ctx, runtime(), path).create({ ...input, locale: 'en' }, signal())).toEqual(chat)
    expect(api.sessions.selectModel).toHaveBeenCalledTimes(1)
    expect(api.sessions.prompt).not.toHaveBeenCalled()
    expect(await service.list(input)).toEqual([chat])
  })

  it('allows an unconfigured model to be selected from the blank native composer', async () => {
    const path = await root(), { api, ctx } = host()
    api.sessions.models.mockResolvedValue(success({ routable: false, current: { provider: '', model: '' } }))
    const chat = await new TraceChatService(ctx, runtime(), path).create({ ...request(), question: '' }, signal())
    expect(chat.sessionId).toContain('session-trace-')
    expect(api.sessions.selectModel).not.toHaveBeenCalled()
    expect(api.sessions.prompt).not.toHaveBeenCalled()
  })

  it('recovers blank-session initialization failures without creating another folder or submitting a turn', async () => {
    const path = await root(), { api, ctx } = host(), input = { ...request(), question: '' }
    api.sessions.create.mockRejectedValueOnce(new Error('host unavailable'))
    const service = new TraceChatService(ctx, runtime(), path)
    await expect(service.create(input, signal())).rejects.toThrow('host unavailable')
    expect(await service.list(input)).toEqual([])
    const chat = await service.create(input, signal())
    expect(JSON.parse(await readFile(join(chat.directory, 'session.json'), 'utf8')).promptStatus).toBe('idle')
    expect(await readdir(path)).toEqual([`trace-${input.requestId}`])
    expect(api.sessions.prompt).not.toHaveBeenCalled()
  })

  it('restores only the exact source session, experiment and selected run set without starting another turn', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    const service = new TraceChatService(ctx, runtime(), path)
    expect(await service.list(input)).toEqual([])
    const chat = await service.create(input, signal())
    await service.create({ ...input, requestId: randomUUID(), sessionId: 'other-source' }, signal())
    await service.create({ ...input, requestId: randomUUID(), runIds: ['a'] }, signal())
    const restarted = new TraceChatService(ctx, runtime(), path)
    expect(await restarted.list({ ...input, runIds: ['a', 'b'] })).toEqual([chat])
    expect(await restarted.list({ ...input, refinementId: 'other-experiment' })).toEqual([])
    expect(api.sessions.prompt).toHaveBeenCalledTimes(3)
  })

  it('ignores partial, malformed and symlink directories when restoring conversations', async () => {
    const path = await root(), { ctx } = host(), input = request()
    const service = new TraceChatService(ctx, runtime(), path), chat = await service.create(input, signal())
    const broken = join(path, `trace-${randomUUID()}`)
    await mkdir(broken)
    await writeFile(join(broken, 'manifest.json'), 'null')
    await writeFile(join(broken, 'session.json'), '{}')
    await symlink(chat.directory, join(path, `trace-${randomUUID()}`))
    expect(await service.list(input)).toEqual([chat])
    await writeFile(join(broken, 'manifest.json'), '{broken')
    expect(await service.list(input)).toEqual([chat])
    await writeFile(join(chat.directory, 'session.json'), 'null')
    expect(await service.list(input)).toEqual([])
    await expect(service.create(input, signal())).rejects.toThrow('metadata is invalid')
  })

  it('exports complete selected evidence, indexed sources, and creates a native agent in that directory', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    const chat = await new TraceChatService(ctx, runtime(), path).create(input, signal())
    expect(chat.directory).toBe(join(path, `trace-${input.requestId}`))
    expect(chat.runIds).toEqual(['a', 'b'])
    const manifest = JSON.parse(await readFile(join(chat.directory, 'manifest.json'), 'utf8'))
    expect(manifest.sourceSessionId).toBe('source')
    expect(manifest.experiment.version).toBe('version-1')
    expect(manifest.sources.map((source: { runId: string }) => source.runId)).toEqual(['a', 'b'])
    for (const [i, doc] of [documents.a, documents.b].entries()) {
      const source = manifest.sources[i]
      const canonical = await readFile(join(chat.directory, source.canonical), 'utf8')
      expect(JSON.parse(canonical)).toEqual(doc)
      expect(sha256(canonical)).toBe(source.sha256)
      const events = await readFile(join(chat.directory, source.events), 'utf8')
      expect(sha256(events)).toBe(source.eventsSha256)
      expect(events.trim().split('\n').map(line => JSON.parse(line))).toEqual(doc.records)
      expect(JSON.parse(await readFile(join(chat.directory, source.index), 'utf8'))).toEqual([{ line: 1, seq: 42, type: 'request/header', systemPromptPath: 'data.header.system' }])
    }
    const record = JSON.parse(await readFile(join(chat.directory, 'session.json'), 'utf8'))
    expect(record.promptStatus).toBe('submitted')
    expect(record.prompt).toBe(input.question)
    expect(record.prompt).not.toContain('ARCHIVED_INSTRUCTION')
    expect(record.prompt).not.toContain('UNSELECTED')
    expect(record.model).toEqual({ provider: 'fixture', model: 'model', reasoningEffort: 'high' })
    expect(await readFile(join(chat.directory, 'AGENTS.md'), 'utf8')).toContain('untrusted evidence')
    expect(api.workspace.create).toHaveBeenCalledWith(expect.objectContaining({ payload: { path: chat.directory } }))
    expect(api.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ payload: { workspaceId: 'workspace', sessionId: chat.sessionId } }))
    expect(api.sessions.prompt).toHaveBeenCalledTimes(1)
  })

  it('reopens the same durable session after retries/restart without re-exporting newer evidence or resending', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    const first = await new TraceChatService(ctx, runtime(), path).create(input, signal())
    const second = await new TraceChatService(ctx, runtime({ a: trace('a', 'NEW_EVIDENCE'), b: documents.b }), path).create(input, signal())
    expect(second).toEqual(first)
    expect(api.sessions.prompt).toHaveBeenCalledTimes(1)
    expect(await readFile(join(first.directory, 'traces/01.json'), 'utf8')).not.toContain('NEW_EVIDENCE')
    expect(await readdir(path)).toEqual([`trace-${input.requestId}`])
  })

  it('does not dispatch a second prompt after an uncertain admission failure', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    api.sessions.prompt.mockRejectedValueOnce(new Error('connection lost after admission'))
    const service = new TraceChatService(ctx, runtime(), path)
    await expect(service.create(input, signal())).rejects.toThrow('connection lost')
    await service.create(input, signal())
    expect(api.sessions.prompt).toHaveBeenCalledTimes(1)
  })

  it('rejects request-id reuse for a different selection or question', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    const service = new TraceChatService(ctx, runtime(), path)
    await service.create(input, signal())
    await expect(service.create({ ...input, runIds: ['b'] }, signal())).rejects.toThrow('identity conflict')
    await expect(service.create({ ...input, question: 'Different question' }, signal())).rejects.toThrow('identity conflict')
    expect(api.sessions.prompt).toHaveBeenCalledTimes(1)
  })

  it('refuses missing evidence before creating an agent or leaving a partial export', async () => {
    const path = await root(), { api, ctx } = host()
    await expect(new TraceChatService(ctx, runtime(), path).create({ ...request(), runIds: ['missing'] }, signal())).rejects.toThrow('outside')
    expect(api.sessions.create).not.toHaveBeenCalled()
    expect(await readdir(path)).toEqual([])
  })

  it('honors cancellation when reopening an existing export before touching native sessions', async () => {
    const path = await root(), { api, ctx } = host(), input = request()
    const service = new TraceChatService(ctx, runtime(), path)
    await service.create(input, signal())
    vi.clearAllMocks()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(service.create(input, cancelled.signal)).rejects.toThrow()
    expect(api.workspace.create).not.toHaveBeenCalled()
    expect(api.sessions.create).not.toHaveBeenCalled()
    expect(api.sessions.prompt).not.toHaveBeenCalled()
  })

  it('validates selection count, duplicate IDs, and safe request directory IDs', () => {
    expect(traceChatRequestSchema.safeParse({ ...request(), runIds: [] }).success).toBe(false)
    expect(traceChatRequestSchema.safeParse({ ...request(), runIds: ['a', 'a'] }).success).toBe(false)
    expect(traceChatRequestSchema.safeParse({ ...request(), runIds: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(traceChatRequestSchema.safeParse({ ...request(), requestId: '../outside' }).success).toBe(false)
  })
})

describe('trace snapshot reader', () => {
  it('reassembles Unicode pages and rejects checksum mismatch', async () => {
    const snapshot = await readTraceSnapshot(runtime(), request(), signal())
    expect(snapshot.traces.map(trace => trace.document)).toEqual([documents.a, documents.b])
    const broken = { ...runtime(), trajectoryPage: async () => ({ ok: true, value: { content: JSON.stringify(documents.a), nextCursor: null, sha256: 'wrong' } }) } as unknown as RefinementRuntime
    await expect(readTraceSnapshot(broken, { ...request(), runIds: ['a'] }, signal())).rejects.toThrow('checksum')
  })

  it('honors cancellation and the export size bound without truncating', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(readTraceSnapshot(runtime(), request(), controller.signal)).rejects.toThrow()
    const large = { ...runtime(), trajectoryPage: async () => ({ ok: true, value: { content: 'x'.repeat(TRACE_EXPORT_MAX_BYTES + 1), sha256: '', nextCursor: null } }) } as unknown as RefinementRuntime
    await expect(readTraceSnapshot(large, request(), signal())).rejects.toThrow('no evidence was truncated')
  })
})
