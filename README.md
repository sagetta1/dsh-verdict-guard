# verdict-guard

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin.
**A turn that states a verdict does not close until the verdict carries something a reader can follow.**

```
model:  "The filter does not work. Closing this direction."
guard:  held back — a verdict without evidence.
model:  (runs the check, quotes the output — or withdraws the claim)
```

## Why

The most expensive thing an agent produces is not a wrong fix. It is a wrong
**closing verdict**: *"it doesn't work"*, *"no bug here"*, *"not reproducible"*.

A false *"it works"* is caught by the next run — it leaves a trace.
A false *"it doesn't work"* leaves none. The direction is closed quietly, and
nobody re-opens a question that already has an answer. The two error classes
are not equally priced, so they should not carry the same standard of proof.

This plugin makes the asymmetry mechanical: at the turn's stop boundary it
reads what the model is about to close on, and what the turn **actually did**.

## What counts as evidence

| Signal | Where it comes from |
|---|---|
| a fenced block, an exit code, a test tally, an HTTP status | the answer's text |
| `file.ts:88`, a path, a log name, `journalctl`, `pytest`, … | the answer's text |
| a verifying tool result — `bash`, `read`, `grep`, `test`, … | **the session log for that turn** |

The third row is why this is a plugin and not a shell hook. A text-only checker
sees what the model *wrote*. The session log says what actually **ran**.

That gives one check a hook cannot make:

> The answer pastes a command transcript — a fenced block, `12 passed, 0 failed`,
> an exit code — while the turn called **no tool at all**. Nothing produced that
> text except the model. It is held back with a sharper message than a plain
> missing citation.

A bare file path is deliberately *not* enough to trigger that stricter case: a
path can honestly be recalled from earlier in the conversation, a transcript cannot.

## Install

```sh
dsh plugin add dsh-plugin-verdict-guard
```

Then add one row to your profile's `cordis.patch.yml`
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: verdict-guard
      name: 'dsh-plugin-verdict-guard'
      config:
        locale: both
        requireToolEvidence: true
        maxInterventionsPerTurn: 1
```

Verify it composed into the tree:

```sh
dsh --profile headless --dump-config | grep -A 5 verdict-guard
```

## Config

| Option | Default | Meaning |
|---|---|---|
| `locale` | `both` | which verdict vocabularies participate — `en`, `ru`, `both` |
| `requireToolEvidence` | `true` | a verdict needs a **verifying** tool result, not merely any tool result — writing a file is not checking a claim |
| `verifyingTools` | bash/read/grep/test/… | tool names that count as verification |
| `extraVerdictPatterns` | — | regex sources appended to the built-in verdict vocabulary |
| `extraEvidencePatterns` | — | regex sources appended to the built-in evidence vocabulary |
| `verdictPatterns` | — | replace the built-in verdict vocabulary entirely |
| `evidencePatterns` | — | replace the built-in evidence vocabulary entirely |
| `maxInterventionsPerTurn` | `1` | how many times one turn may be held back |
| `maxInterventionsPerSession` | `6` | total holds per session |
| `verbose` | `false` | log every pass decision at debug level |

An empty list is read as *"not supplied"*, never as *"match nothing"* — so a
config that fills unset array options with `[]` cannot silently disarm the guard.

## How it works

One listener on `agent/turn-stopping`, the harness's own stop boundary:

```
agent/turn-stopping  →  read the turn's closing assistant text
                     →  read the turn's tool/call + tool/result events
                     →  verdict? evidence?  →  agent.steer(reason)
```

Steering makes the machine observe pending input and run another step, which is
the documented way for a listener to object at that boundary. Nothing in the
agent loop is modified.

**The guard caps itself.** The harness has no loop guard here yet: the loop
carries a `TODO(stop-loop-guard)`, and the Claude Code hook bridge reports
`stop_hook_active: false` unconditionally, so a listener that steers must limit
itself or it can hold a turn open forever. `maxInterventionsPerTurn` (default
`1`) is that limit — one hold, then the turn closes whatever the model says.

## Compatibility

Built and tested against `0.1.0-rc.8`.

⚠️ **The `latest` dist-tag on the harness's own sub-packages is stale.**
`@deepseek-ai/dsh-tools`, `-llm`, `-session` and friends publish their current
line under `next` (`0.1.0-rc.8`) while `latest` still points at `0.0.1-rc.1`.
Installing them without an explicit range mixes two incompatible generations —
and some `0.0.1-rc.1` packages depend on `@deepseek-ai/dsh-bash`, which no
longer exists. Pin `^0.1.0-rc.8`, or install with `@next`.

## Development

```sh
npm install
npm test     # 21 tests: the detector, plus the plugin on a real agent loop
npm run build
```

The integration tests drive the real `AgentLoop` with a scripted model adapter,
so both outcomes — held and closed — are proven without a provider key.

## License

MIT

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
