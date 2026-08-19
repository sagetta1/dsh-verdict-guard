/**
 * verdict-guard — a native DeepSeek Harness plugin.
 *
 * A turn that states a verdict does not close until the verdict carries
 * something a reader can follow. On `agent/turn-stopping` the plugin reads the
 * closing assistant message and the tool activity the same turn actually
 * produced; a claim with neither a citation nor a real tool result is steered
 * back with the reason, and the machine runs another step.
 *
 * Why this and not a shell hook: the check is not about the text alone. The
 * session log says whether anything RAN. A pasted transcript in a turn that
 * called no tool is the one failure a text-only checker cannot see.
 *
 * @module dsh-plugin-verdict-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { detect, type DetectOptions, type Finding, type Locale } from './detect.ts'
import { VERIFYING_TOOLS } from './patterns.ts'

export { detect, vocabularies, type Finding, type Locale, type TurnActivity } from './detect.ts'
export * from './patterns.ts'

export const name = 'verdict-guard'

/**
 * Nothing is injected: the plugin only listens. A deployment without the agent
 * loop loads it harmlessly and the listener never fires.
 */
export const inject: string[] = []

export interface Config {
  /** Which verdict vocabularies participate. Default `both`. */
  locale?: Locale
  /** Verdict regexes appended to the defaults (case-insensitive sources). */
  extraVerdictPatterns?: string[]
  /** Evidence regexes appended to the defaults. */
  extraEvidencePatterns?: string[]
  /** Replace the built-in verdict vocabulary entirely. */
  verdictPatterns?: string[]
  /** Replace the built-in evidence vocabulary entirely. */
  evidencePatterns?: string[]
  /**
   * A verdict must be backed by a VERIFYING tool result, not merely by any
   * tool result. Default `true` — writing a file is not checking a claim.
   */
  requireToolEvidence?: boolean
  /** Tool names that count as verification. Default {@link VERIFYING_TOOLS}. */
  verifyingTools?: string[]
  /**
   * How many times one turn may be held back. Default `1`.
   *
   * The harness's own loop guard is absent here: the CC bridge reports
   * `stop_hook_active: false` unconditionally and the loop carries a
   * `TODO(stop-loop-guard)`, so a listener that steers must cap itself or it
   * can hold a turn open forever.
   */
  maxInterventionsPerTurn?: number
  /** How many times one session may be held back in total. Default `6`. */
  maxInterventionsPerSession?: number
  /** Log every pass/hold decision at debug level. Default `false`. */
  verbose?: boolean
}

export const Config: z<Config> = z.object({
  locale: z.union([z.const('en'), z.const('ru'), z.const('both')]).default('both'),
  extraVerdictPatterns: z.array(z.string()),
  extraEvidencePatterns: z.array(z.string()),
  verdictPatterns: z.array(z.string()),
  evidencePatterns: z.array(z.string()),
  requireToolEvidence: z.boolean().default(true),
  verifyingTools: z.array(z.string()),
  maxInterventionsPerTurn: z.number().default(1),
  maxInterventionsPerSession: z.number().default(6),
  verbose: z.boolean().default(false),
})

/** Per-agent intervention budget; the harness offers no loop guard of its own. */
interface Budget {
  turn: number
  inTurn: number
  inSession: number
}

/** Flatten an assistant message's blocks to the text a reader would quote. */
function blocksToText(content: readonly ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/** The closing assistant text of `turn`, plus what that turn actually ran. */
export function readTurn(events: readonly SessionEvent[], turn: number): {
  text: string
  toolNames: string[]
} {
  let text = ''
  const toolNames: string[] = []
  const calls = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data.turn === turn) {
      // Interrupted output is a truncated prefix, not a statement the model
      // chose to close on. The flag arrived in a later `dsh-session` than the
      // oldest one this plugin supports, so it is read defensively rather than
      // pinning a floor on the peer range.
      const interrupted = (event.data as { interrupted?: boolean }).interrupted === true
      if (!interrupted) text = blocksToText(event.data.message.content)
    } else if (event.type === 'tool/call' && event.data.turn === turn) {
      calls.set(String(event.data.callId), event.data.name)
    } else if (event.type === 'tool/result' && event.data.turn === turn) {
      // A result carries its call identity on the message source
      // (`ToolMessageSource`), which is how the name is recovered.
      const source = event.data.message.source as { callId?: unknown }
      const named = calls.get(String(source.callId ?? ''))
      if (named !== undefined) toolNames.push(named)
    }
  }
  return { text, toolNames }
}

/** The steering text handed back to the model. */
export function reasonFor(finding: Finding): string {
  const head = finding.kind === 'fabricated'
    ? `Held back: the answer quotes output that nothing in this turn produced ("${finding.verdict}").`
    : `Held back: a verdict without evidence ("${finding.verdict}").`

  const body = finding.kind === 'fabricated'
    ? [
        'The reply contains a command transcript, an exit code, or a test tally,',
        'but this turn called no tool at all — so that text was written, not observed.',
        '',
        'Run the thing and quote the real result, or drop the transcript and say',
        'plainly that it has not been run.',
      ]
    : [
        'The reply states a claim about reality with nothing a reader can follow:',
        'no command output, no file:line, no log name, and no verifying tool ran',
        'in this turn.',
        '',
        finding.closing
          ? 'A closing verdict costs more than a confirming one. "It works" is caught by the next run; "it does not work" closes the direction quietly and nobody re-opens it. So this class needs the higher standard, not the lower.'
          : 'A confirming verdict is what later work is built on, so it carries its proof with it.',
        '',
        'Either attach the evidence — the command and its output, the file and line,',
        'the number and where it was measured — or withdraw the verdict and say',
        'plainly that it is not checked yet.',
      ]

  return [head, '', ...body].join('\n')
}

export function apply(ctx: Context, config: Config = {}): void {
  // A schema that fills unset array options with `[]` must not be read as
  // "no tool counts as verification" — an empty list means "use the default".
  const configuredTools = config.verifyingTools !== undefined && config.verifyingTools.length > 0
    ? config.verifyingTools
    : VERIFYING_TOOLS
  const verifying = new Set(configuredTools.map(t => t.toLowerCase()))
  const maxPerTurn = config.maxInterventionsPerTurn ?? 1
  const maxPerSession = config.maxInterventionsPerSession ?? 6
  const budgets = new WeakMap<Agent, Budget>()

  const list = (value: string[] | undefined): string[] | undefined =>
    value !== undefined && value.length > 0 ? value : undefined
  const detectOptions: DetectOptions = {
    ...config.locale === undefined ? {} : { locale: config.locale },
    ...list(config.verdictPatterns) === undefined ? {} : { verdictPatterns: list(config.verdictPatterns)! },
    ...list(config.evidencePatterns) === undefined ? {} : { evidencePatterns: list(config.evidencePatterns)! },
    ...list(config.extraVerdictPatterns) === undefined ? {} : { extraVerdictPatterns: list(config.extraVerdictPatterns)! },
    ...list(config.extraEvidencePatterns) === undefined ? {} : { extraEvidencePatterns: list(config.extraEvidencePatterns)! },
    ...config.requireToolEvidence === undefined ? {} : { requireToolEvidence: config.requireToolEvidence },
  }

  ctx.on('agent/turn-stopping', ({ agent, turn }): void => {
    const budget = budgets.get(agent) ?? { turn, inTurn: 0, inSession: 0 }
    if (budget.turn !== turn) { budget.turn = turn; budget.inTurn = 0 }
    budgets.set(agent, budget)

    // Self-limiting comes first: a guard that can loop is worse than no guard.
    if (budget.inTurn >= maxPerTurn || budget.inSession >= maxPerSession) return

    const { text, toolNames } = readTurn([...agent.session.events], turn)
    const verifyingToolNames = toolNames.filter(n => verifying.has(n.toLowerCase()))

    const finding = detect({ text, toolNames, verifyingToolNames }, detectOptions)

    if (finding === undefined) {
      if (config.verbose === true) ctx.logger.debug(`verdict-guard: turn ${turn} closes`)
      return
    }

    budget.inTurn += 1
    budget.inSession += 1
    const reason = reasonFor(finding)
    ctx.logger.info(`verdict-guard: holding turn ${turn} (${finding.kind}: ${finding.verdict})`)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: reason }],
      source: { kind: 'plugin', plugin: name },
    }))
  })
}

export default { name, inject, Config, apply }
