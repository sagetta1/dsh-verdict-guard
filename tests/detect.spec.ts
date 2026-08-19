import { describe, expect, it } from 'vitest'
import { detect } from '../src/detect.ts'

const bare = (text: string, tools: string[] = [], verifying: string[] = []) =>
  detect({ text, toolNames: tools, verifyingToolNames: verifying })

describe('detect — a verdict needs something a reader can follow', () => {
  it('holds a closing verdict stated with nothing behind it', () => {
    const f = bare('I checked the filter and it does not work. Moving on.')
    expect(f?.kind).toBe('unsupported')
    expect(f?.closing).toBe(true)
  })

  it('holds a confirming verdict stated with nothing behind it', () => {
    const f = bare('All tests pass, we are done here.')
    expect(f?.kind).toBe('unsupported')
    expect(f?.closing).toBe(false)
  })

  it('lets a verdict through when the answer cites a file and line', () => {
    expect(bare('It does not work — the guard returns early at src/index.ts:88.')).toBeUndefined()
  })

  it('lets a verdict through when a verifying tool ran in the same turn', () => {
    expect(bare('Tests pass now.', ['bash'], ['bash'])).toBeUndefined()
  })

  it('holds a verdict when only a writing tool ran', () => {
    expect(bare('Fixed, it works now.', ['write'], [])?.kind).toBe('unsupported')
  })

  it('accepts any tool when requireToolEvidence is off', () => {
    expect(detect(
      { text: 'Fixed, it works now.', toolNames: ['write'], verifyingToolNames: [] },
      { requireToolEvidence: false },
    )).toBeUndefined()
  })

  it('says nothing about an answer that states no verdict', () => {
    expect(bare('Here are three options; which do you want?')).toBeUndefined()
  })

  it('ignores empty output', () => {
    expect(bare('   ')).toBeUndefined()
  })
})

describe('detect — pasted output that nothing produced', () => {
  const pasted = [
    'Ran the suite, everything passes:',
    '',
    '```',
    '12 passed, 0 failed',
    '```',
  ].join('\n')

  it('flags a transcript in a turn that called no tool', () => {
    const f = bare(pasted)
    expect(f?.kind).toBe('fabricated')
  })

  it('accepts the same transcript when a tool actually ran', () => {
    expect(bare(pasted, ['bash'], ['bash'])).toBeUndefined()
  })

  it('does not flag a bare file path as fabricated', () => {
    // A path can be honestly recalled from earlier in the conversation.
    expect(bare('It does not work; see src/detect.ts:114.')).toBeUndefined()
  })
})

describe('detect — vocabularies', () => {
  it('reads Russian by default', () => {
    expect(bare('Проверил — фильтр не работает, закрываю направление.')?.closing).toBe(true)
  })

  it('can be narrowed to one language', () => {
    expect(detect(
      { text: 'фильтр не работает', toolNames: [], verifyingToolNames: [] },
      { locale: 'en' },
    )).toBeUndefined()
  })

  it('takes a caller vocabulary in place of the built-in one', () => {
    const f = detect(
      { text: 'ship it', toolNames: [], verifyingToolNames: [] },
      { verdictPatterns: ['ship it'] },
    )
    expect(f?.kind).toBe('unsupported')
    expect(f?.closing).toBe(true)
  })

  it('extends the built-in vocabulary without replacing it', () => {
    const opts = { extraVerdictPatterns: [String.raw`\bno further action\b`] }
    expect(detect({ text: 'No further action needed.', toolNames: [], verifyingToolNames: [] }, opts)?.kind)
      .toBe('unsupported')
    expect(detect({ text: 'It does not work.', toolNames: [], verifyingToolNames: [] }, opts)?.kind)
      .toBe('unsupported')
  })
})
