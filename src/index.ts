/**
 * npm-installable DeepSeek Harness refinement workbench plugin.
 *
 * One package contributes a read-only Gear/Hitch projection service and a
 * browser `./client` half. Gear remains the sole refinement control plane.
 */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { mountRefinementRpc } from './rpc.ts'
import { RefinementRuntime, type Config as RuntimeConfig } from './runtime.ts'

export type * from './types.ts'
export type * from './providers.ts'
export { RefinementProviderError } from './providers.ts'
export { RefinementRuntime } from './runtime.ts'
export { HitchRefinementEvidenceProvider } from './hitch-provider.ts'

/** Public single-package configuration. All byte limits and provider choices are explicit. */
export interface Config extends RuntimeConfig {
  /** Event-driven browser change wait timeout; responses carry no evidence payload. */
  readonly changeWaitMs: number
  /** Dedicated analysis folders; defaults to trace-chats under the source session cwd. */
  readonly traceChatsRoot?: string
}

export const name = 'rear-refinement'
export const inject = ['sessions', 'connection']

/** Loader schema; no machine-specific paths or hidden byte-limit defaults. */
export const Config: s<Config> = s.object({
  trajectoryResponseMaxBytes: s.number().step(1).min(1).required(),
  providerEvidencePageMaxBytes: s.number().step(1).min(1).required(),
  changeWaitMs: s.number().step(1).min(1).required(),
  traceChatsRoot: s.string(),
  gear: s.object({
    root: s.string().required(),
    watchDebounceMs: s.number().step(1).min(1).required(),
  }).required(),
  hitch: s.object({
    id: s.string().required(),
    root: s.string().required(),
    watchDebounceMs: s.number().step(1).min(1).required(),
  }).required(),
})

/** Compose the read-only Gear projection and browser RPC under one Loader row. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(RefinementRuntime, config)
  await ctx.inject(['refinements'], (refinementCtx) => {
    mountRefinementRpc(refinementCtx, refinementCtx.refinements, config.changeWaitMs, config.traceChatsRoot)
  })
}
