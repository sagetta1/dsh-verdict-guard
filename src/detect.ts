/**
 * Pure detection: given one turn's assistant text and the tool activity that
 * turn actually produced, decide whether the turn may close.
 *
 * Kept free of harness types so it can be unit-tested — and read — on its own.
 * @module dsh-plugin-verdict-guard/detect
 */

import {
  CLOSING_EN, CLOSING_RU, CONFIRMING_EN, CONFIRMING_RU, EVIDENCE, TRANSCRIPT,
} from './patterns.ts'

/** Which vocabularies participate. */
export type Locale = 'en' | 'ru' | 'both'

/** What the turn actually did, as read from the durable session log. */
export interface TurnActivity {
  /** Text of the closing assistant message — the part a reader would quote. */
  text: string
  /** Tool names whose results landed in this turn, in order. */
  toolNames: readonly string[]
  /** Tool names that count as verification (a subset of the above). */
  verifyingToolNames: readonly string[]
}

/** Why the turn was held back. */
export type Finding =
  /** A verdict with nothing to follow — no citation, no tool ran. */
  | { kind: 'unsupported'; verdict: string; closing: boolean }
  /** Output-shaped text in the answer while the turn ran no tool at all. */
  | { kind: 'fabricated'; verdict: string; closing: boolean }

export interface DetectOptions {
  locale?: Locale
  /** Extra verdict regex sources (case-insensitive), appended to the defaults. */
  extraVerdictPatterns?: readonly string[]
  /** Extra evidence regex sources, appended to the defaults. */
  extraEvidencePatterns?: readonly string[]
  /** Replace the defaults entirely instead of extending them. */
  verdictPatterns?: readonly string[]
  evidencePatterns?: readonly string[]
  /** A verdict must be backed by at least one tool result in the same turn. */
  requireToolEvidence?: boolean
}

function compile(sources: readonly string[]): RegExp[] {
  return sources.map(source => new RegExp(source, 'i'))
}

/**
 * An empty list means "not supplied", never "match nothing".
 *
 * The distinction is load-bearing: a schema that fills unset array options with
 * `[]` would otherwise replace the whole vocabulary with an empty one, and the
 * guard would silently pass everything while looking configured.
 */
function supplied(list: readonly string[] | undefined): readonly string[] | undefined {
  return list !== undefined && list.length > 0 ? list : undefined
}

function firstMatch(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return m[0]
  }
  return undefined
}

/** The vocabularies in force for one locale selection. */
export function vocabularies(options: DetectOptions = {}): {
  closing: RegExp[]
  confirming: RegExp[]
  evidence: RegExp[]
  transcript: RegExp[]
} {
  const locale = options.locale ?? 'both'
  const en = locale === 'en' || locale === 'both'
  const ru = locale === 'ru' || locale === 'both'

  const closingSources = [...en ? CLOSING_EN : [], ...ru ? CLOSING_RU : []]
  const confirmingSources = [...en ? CONFIRMING_EN : [], ...ru ? CONFIRMING_RU : []]

  // A caller-supplied `verdictPatterns` replaces both classes; the replacement
  // is treated as CLOSING, because the strict message is the safe default for
  // an unclassified custom vocabulary.
  const verdictOverride = supplied(options.verdictPatterns)
  const evidenceOverride = supplied(options.evidencePatterns)

  const closing = verdictOverride
    ? compile(verdictOverride)
    : compile([...closingSources, ...supplied(options.extraVerdictPatterns) ?? []])
  const confirming = verdictOverride ? [] : compile(confirmingSources)

  const evidence = evidenceOverride
    ? compile(evidenceOverride)
    : compile([...EVIDENCE, ...supplied(options.extraEvidencePatterns) ?? []])

  return { closing, confirming, evidence, transcript: compile(TRANSCRIPT) }
}

/**
 * Decide whether a turn may close.
 * @param activity - the closing text plus the turn's real tool activity.
 * @param options - vocabulary and strictness selection.
 * @returns the finding that holds the turn back, or `undefined` to let it close.
 */
export function detect(activity: TurnActivity, options: DetectOptions = {}): Finding | undefined {
  const text = activity.text.trim()
  if (text === '') return undefined

  const { closing, confirming, evidence, transcript } = vocabularies(options)

  const closingHit = firstMatch(text, closing)
  const verdict = closingHit ?? firstMatch(text, confirming)
  if (verdict === undefined) return undefined
  const isClosing = closingHit !== undefined

  const cited = firstMatch(text, evidence) !== undefined
  const ranTool = activity.toolNames.length > 0
  const verified = activity.verifyingToolNames.length > 0

  // The sharpest case first: the answer pastes something only an execution can
  // produce — a fenced block, an exit code, a test tally — while this turn
  // called no tool at all. Nothing produced that text except the model. A
  // text-only checker cannot see this; the session log can. A bare file path
  // is deliberately NOT enough here: a path can be honestly recalled from
  // earlier in the conversation, a transcript cannot.
  const pasted = firstMatch(text, transcript) !== undefined
  if (pasted && !ranTool) return { kind: 'fabricated', verdict, closing: isClosing }

  if (cited) return undefined

  const requireTool = options.requireToolEvidence ?? true
  if (requireTool ? verified : ranTool) return undefined

  return { kind: 'unsupported', verdict, closing: isClosing }
}
