import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as rear from '../../src/index.ts'
import type {
  RefinementDriver,
  RefinementDriverOperation,
} from '../../src/index.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('dsh-plugin-rear real Loader composition', () => {
  it('admits through /refine and returns before the configured driver settles', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-refine-loader-'))
    const configPath = join(root, 'cordis.yml')
    const storageRoot = join(root, 'storage')
    const hitchRoot = join(root, 'hitch')
    await mkdir(hitchRoot)
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(storageRoot)}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@test/connection'",
      "- name: 'dsh-plugin-rear'",
      '  config:',
      '    driver: fixture-driver',
      '    evidenceProvider: hitch',
      '    objectiveMaxBytes: 128',
      '    trajectoryResponseMaxBytes: 65536',
      '    providerEvidencePageMaxBytes: 4096',
      '    changeWaitMs: 50',
      '    hitch:',
      '      id: hitch',
      `      root: ${JSON.stringify(hitchRoot)}`,
      '      watchDebounceMs: 5',
      "- name: '@test/refinement-driver'",
      '',
    ].join('\n'))

    const settlement = Promise.withResolvers<undefined>()
    const operations: RefinementDriverOperation[] = []
    const driver: RefinementDriver = {
      id: 'fixture-driver',
      available: () => true,
      run: async (operation) => { operations.push(operation); await settlement.promise },
      resume: async (operation) => { operations.push(operation); await settlement.promise },
      cancel: async () => 'stopped',
    }
    const driverPlugin = {
      name: 'fixture-refinement-driver',
      inject: ['refinements'],
      apply(ctx: Context) { ctx.effect(() => ctx.refinements.registerDriver(driver)) },
    }
    const connectionPlugin = {
      name: 'fixture-connection',
      apply(ctx: Context) {
        ctx.provide('connection', {
          rpc: {
            handle: () => async () => {},
            intercept: () => async () => {},
          },
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', StorageJson],
      ['@deepseek-ai/dsh-storage-domain', StorageDomain],
      ['@test/connection', connectionPlugin],
      ['@test/refinement-driver', driverPlugin],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['dsh-plugin-rear', rear],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const session = context.sessions.create(SessionId('loader-command-refine'))
    const agent = { session, status: 'idle', options: {} } as unknown as Agent
    expect(context.refinements).toBeDefined()
    expect(context.commands.list(agent)).toContainEqual(expect.objectContaining({ name: 'refine' }))
    const execution = await context.commands.execute(
      agent,
      '/refine reduce regressions',
      [],
      new AbortController().signal,
    )
    if (execution === undefined) throw new Error('Loader composition did not resolve /refine')
    if (execution.result.kind !== 'success') throw new Error(execution.result.text)
    const created = session.events.filter(event => event.type === 'refinement/created')
    expect(created).toHaveLength(1)
    expect(session.events.at(-1)).toMatchObject({ type: 'command/done' })
    expect(execution.result.sourceEventSeq).toBe(created[0]?.seq)
    await vi.waitFor(() => { expect(operations).toHaveLength(1) })
    expect(operations[0]?.record.objective).toBe('reduce regressions')

    const beforeCreated = session.events.filter(event => event.type === 'refinement/created').length
    const rejected = await context.commands.execute(
      agent,
      `/refine ${'x'.repeat(129)}`,
      [],
      new AbortController().signal,
    )
    expect(rejected?.result).toMatchObject({ kind: 'error' })
    expect(session.events.filter(event => event.type === 'refinement/created')).toHaveLength(beforeCreated)
    expect(session.events.filter(event => event.type === 'command/run')).toHaveLength(2)
    expect(session.events.filter(event => event.type === 'command/done')).toHaveLength(2)
    settlement.resolve(undefined)
  })
})
