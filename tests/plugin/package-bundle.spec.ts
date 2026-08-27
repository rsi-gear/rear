import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('published DSH bundle', () => {
  it('declares a dormant install-safe dual-face plugin row', async () => {
    const root = resolve(import.meta.dirname, '../..')
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      name?: string
      dsh?: {
        bundle?: { patch?: string }
        client?: { platform?: string; inject?: string[] }
      }
      exports?: Record<string, unknown>
      files?: string[]
      peerDependencies?: Record<string, string>
    }
    expect(pkg.name).toBe('dsh-plugin-rear')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(pkg.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-trajectory')
    expect(pkg.exports).toHaveProperty('./client')
    expect(pkg.files).toContain('cordis.patch.yml')
    expect(pkg.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-agent')
    expect(pkg.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-commands')
    expect(pkg.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-storage-domain')

    const patch = load(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
    expect(patch).toEqual([{ insert: [{ id: 'rear-refinement', name: 'dsh-plugin-rear', disabled: true }] }])
  })

  it('emits a DSH module-table client bundle with only declared shared requires', async () => {
    const root = resolve(import.meta.dirname, '../..')
    const bundle = await readFile(resolve(root, 'lib/client.js'), 'utf8')
    expect(bundle).toContain('window.__ModuleLoader__.load({')
    expect(bundle).toContain('id: "dsh-plugin-rear"')
    expect(bundle).toContain('ConversationNodeAssembler')
    expect(bundle).toContain('REAR requires the registered DSH trajectory conversation view')
    expect(bundle).not.toContain('rear-refinement-native-table')
    const requires = [...bundle.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1]).sort()
    expect([...new Set(requires)]).toEqual([
      '@deepseek-ai/dsh-client-runtime/client',
      'react',
      'react/jsx-runtime',
    ])
  })
})
