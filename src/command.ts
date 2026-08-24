/** Human-facing `/refine` admission command. @module dsh-plugin-rear/command */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import './runtime.ts'

/** Cordis plugin name. */
export const name = 'command-refine'
/** Command registry and refinement runtime must exist before registration. */
export const inject = ['commands', 'refinements']

/** Admit one refinement and return before its driver evaluation settles. */
async function execute(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const objective = invocation.rawInput.trim()
  const result = await ctx.refinements.start(
    invocation.agent,
    { objective: objective === '' ? null : objective },
    invocation.signal,
  )
  if (!result.ok) {
    return { kind: 'error', text: `Unable to start refinement: ${result.error.message} (${result.error.code})` }
  }
  return {
    kind: 'success',
    text: 'Refinement started. Open Refine to follow evaluation progress.',
    sourceEventSeq: result.value.sourceEventSeq,
  }
}

/** Register `/refine [objective]` as a global human command. @param ctx - host command context. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'refine',
    description: 'iterate and evaluate a candidate harness for this Session',
    input: { hint: '[objective]' },
    recordInput: false,
    handler: invocation => execute(ctx, invocation),
  }), 'command-refine: /refine')
}
