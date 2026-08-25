import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as rear from '../../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('dsh-plugin-rear real Loader composition', () => {
  it('mounts a read-only Gear projection without registering /refine', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-rear-loader-'))
    const configPath = join(root, 'cordis.yml')
    const gearRoot = join(root, 'gear')
    const hitchRoot = join(root, 'hitch')
    await mkdir(gearRoot)
    await mkdir(hitchRoot)
    await writeFile(join(gearRoot, 'registry.json'), JSON.stringify({ schemaVersion: 1, evolutions: [] }), 'utf8')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@test/connection'",
      "- name: 'dsh-plugin-rear'",
      '  config:',
      '    trajectoryResponseMaxBytes: 65536',
      '    providerEvidencePageMaxBytes: 4096',
      '    changeWaitMs: 50',
      '    gear:',
      `      root: ${JSON.stringify(gearRoot)}`,
      '      watchDebounceMs: 5',
      '    hitch:',
      '      id: hitch',
      `      root: ${JSON.stringify(hitchRoot)}`,
      '      watchDebounceMs: 5',
      '',
    ].join('\n'))

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
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@test/connection', connectionPlugin],
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

    const session = (context.get('sessions') as SessionStore).create(SessionId('loader-rear-readonly'))
    const agent = { session, status: 'idle', options: {} } as unknown as Agent
    expect(context.refinements.list({ sessionId: session.id })).toEqual({ ok: true, value: { records: [] } })
    expect(context.commands.list(agent)).not.toContainEqual(expect.objectContaining({ name: 'refine' }))
  })
})
