/**
 * Integration: the plugin on a real agent loop. The model is scripted, so both
 * outcomes are proven without a provider key.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as VerdictGuard from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(VerdictGuard, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Run a shell command.',
    parameters: { command: { type: 'string', required: true, description: 'command' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: () => Promise.resolve('12 passed, 0 failed'),
  }))
  return ctx
}

function run(ctx: Context, text = 'check the filter') {
  const agent = ctx.agentLoop.create(SessionId('s1'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  return agent
}

describe('verdict-guard on a live turn', () => {
  it('holds a bare verdict and steers the reason back to the model', async () => {
    const adapter = new MockAdapter([
      textResponse('The filter does not work. Closing this direction.'),
      textResponse('Withdrawn — not checked yet.'),
    ])
    const ctx = await harness(adapter)
    const agent = run(ctx)
    await agent.whenIdle()

    // A second request ran → the turn was held open.
    expect(adapter.requests).toHaveLength(2)
    const steered = JSON.stringify(adapter.requests[1]!.messages)
    expect(steered).toContain('a verdict without evidence')
    expect(steered).toContain('closes the direction quietly')
  })

  it('lets an evidenced verdict close the turn', async () => {
    const adapter = new MockAdapter([
      textResponse('The filter does not work — it returns early at src/detect.ts:114.'),
    ])
    const ctx = await harness(adapter)
    const agent = run(ctx)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
  })

  it('lets a verdict close when a verifying tool ran in the same turn', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'bash', { command: 'npm test' }),
      textResponse('All tests pass.'),
    ])
    const ctx = await harness(adapter)
    const agent = run(ctx)
    await agent.whenIdle()

    // Two requests: the tool call and the answer after it. No third — no hold.
    expect(adapter.requests).toHaveLength(2)
  })

  it('holds a pasted transcript that no tool in the turn produced', async () => {
    const adapter = new MockAdapter([
      textResponse('Ran it, everything passes:\n\n```\n12 passed, 0 failed\n```'),
      textResponse('Not run yet.'),
    ])
    const ctx = await harness(adapter)
    const agent = run(ctx)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages))
      .toContain('quotes output that nothing in this turn produced')
  })

  it('holds a turn at most once — the harness has no loop guard of its own', async () => {
    // The model repeats the same unsupported verdict; the plugin must not
    // hold the turn a second time.
    const adapter = new MockAdapter([
      textResponse('It does not work.'),
      textResponse('It still does not work.'),
    ])
    const ctx = await harness(adapter)
    const agent = run(ctx)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
  })

  it('respects a raised per-turn budget', async () => {
    const adapter = new MockAdapter([
      textResponse('It does not work.'),
      textResponse('It still does not work.'),
      textResponse('Withdrawn.'),
    ])
    const ctx = await harness(adapter, { maxInterventionsPerTurn: 2 })
    const agent = run(ctx)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(3)
  })
})
