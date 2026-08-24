/**
 * npm-installable DeepSeek Harness refinement workbench plugin.
 *
 * One package contributes a Host lifecycle/evidence service and a browser
 * `./client` half. Drivers remain separate plugins and register through
 * `ctx.refinements.registerDriver()`.
 */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { apply as applyCommand } from './command.ts'
import { apply as applyHitchProvider, type Config as HitchConfig } from './hitch-provider.ts'
import { mountRefinementRpc } from './rpc.ts'
import { RefinementRuntime, type Config as RuntimeConfig } from './runtime.ts'

export type * from './types.ts'
export type * from './providers.ts'
export { RefinementProviderError } from './providers.ts'
export { refinementDomainSpec, refinementRecordSchema } from './spec.ts'
export { RefinementRuntime } from './runtime.ts'
export { HitchRefinementEvidenceProvider } from './hitch-provider.ts'

/** Public single-package configuration. All byte limits and provider choices are explicit. */
export interface Config extends RuntimeConfig {
  /** Event-driven browser change wait timeout; responses carry no evidence payload. */
  readonly changeWaitMs: number
  /** Read-only Hitch run-centered evidence source. */
  readonly hitch: HitchConfig
}

export const name = 'rear-refinement'
export const inject = ['storageDomain', 'sessions', 'commands', 'connection']

/** Loader schema; no machine-specific paths or hidden byte-limit defaults. */
export const Config: s<Config> = s.object({
  driver: s.string().required(),
  evidenceProvider: s.string().required(),
  objectiveMaxBytes: s.number().step(1).min(1).required(),
  trajectoryResponseMaxBytes: s.number().step(1).min(1).required(),
  providerEvidencePageMaxBytes: s.number().step(1).min(1).required(),
  changeWaitMs: s.number().step(1).min(1).required(),
  hitch: s.object({
    id: s.string().required(),
    root: s.string().required(),
    watchDebounceMs: s.number().step(1).min(1).required(),
  }).required(),
})

/** Compose the durable service, Hitch provider, command, and browser RPC under one Loader row. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(RefinementRuntime, config)
  await ctx.inject(['refinements'], (refinementCtx) => {
    applyHitchProvider(refinementCtx, config.hitch)
    applyCommand(refinementCtx)
    mountRefinementRpc(refinementCtx, refinementCtx.refinements, config.changeWaitMs)
  })
}
