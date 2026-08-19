/**
 * Default detector vocabularies.
 *
 * Two independent axes are matched against the assistant's closing text:
 *
 * - a **verdict** — a claim about reality that closes a question
 *   ("it doesn't work", "verified", "deployed", "no bug found");
 * - an **evidence citation** — a pointer a reader can follow
 *   (a fenced block, `file:line`, a log name, a command).
 *
 * Closing verdicts are listed separately from confirming ones because they
 * are not equally expensive. A false "it works" is caught by the next run.
 * A false "it doesn't work" closes a direction quietly and leaves no trace:
 * nobody re-opens a question that is already answered. That asymmetry is the
 * whole reason this plugin exists, and it is why `closing` carries a stricter
 * message than `confirming`.
 *
 * @module dsh-plugin-verdict-guard/patterns
 */

/** Claims that CLOSE a direction — the expensive, trace-free error. */
export const CLOSING_EN = [
  String.raw`\b(does|do|did)\s*n[o']?t\s+work\b`,
  String.raw`\bnot\s+working\b`,
  String.raw`\bis\s+(dead|broken|useless|pointless)\b`,
  String.raw`\b(impossible|infeasible|unachievable)\b`,
  String.raw`\bwon[' ]?t\s+(work|help|scale)\b`,
  String.raw`\bcan[' ]?t\s+be\s+done\b`,
  String.raw`\bno\s+(bug|issue|problem|regression|leak)s?\s+(found|here|present)\b`,
  String.raw`\bnothing\s+(wrong|broken|to\s+fix)\b`,
  String.raw`\bdead\s+end\b`,
  String.raw`\bruled\s+out\b`,
  String.raw`\bnot\s+reproducible\b`,
  String.raw`\bfalse\s+positive\b`,
]

/** Claims that CONFIRM a result — cheaper to be wrong about, still a claim. */
export const CONFIRMING_EN = [
  String.raw`\b(it|this|that|everything)\s+works\b`,
  String.raw`\beverything\s+(passes|passed|is\s+green|checks\s+out)\b`,
  String.raw`\bworks\s+(now|fine|correctly|as\s+expected)\b`,
  String.raw`\b(verified|confirmed|validated)\b`,
  String.raw`\b(all\s+)?tests?\s+(pass|passing|passed|are\s+green)\b`,
  String.raw`\b(fix|bug|issue|problem)\s+is\s+(fixed|resolved|gone)\b`,
  String.raw`\b(deployed|shipped|released|live)\b`,
  String.raw`\b(done|complete|completed|ready)\b`,
  String.raw`\bproven\b`,
]

/** Russian mirror of the same two classes (the author's working language). */
export const CLOSING_RU = [
  'не работает',
  'не сработал',
  'не сработало',
  'мёртв|мертв|мертва|мёртвая',
  'бесполезн',
  'невозможно',
  'нереально',
  'не выйдет',
  'не получится',
  'направление закрыт',
  'тупик',
  'это шум',
  'не подтвердил',
  'не воспроизвод',
  'ошибок нет',
  'проблем нет',
]

export const CONFIRMING_RU = [
  'подтвержд',
  'доказано',
  'сработало',
  'прошёл проверку|прошла проверку|прошли проверку',
  'можно в бой',
  'готово к бою',
  'результат получен',
  'всё работает|все работает',
  'задеплоен|задеплоил|развернут|развёрнут',
  'тесты (зелёные|зеленые|прошли)',
  'готово',
]

/**
 * Shapes a reader can follow to the source. Deliberately generous: the goal is
 * to catch the bare assertion, not to grade the quality of a citation.
 */
export const EVIDENCE = [
  '```',                                   // a fenced block (output, diff, code)
  String.raw`\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|h|cpp|sh|sql|yml|yaml|json|toml|md|log|csv|txt)\b`,
  String.raw`\b[\w./-]+:\d+\b`,            // file:line
  String.raw`\bexit\s+(code\s+)?\d+\b`,
  String.raw`\b(systemctl|journalctl|docker|kubectl|pytest|vitest|jest|npm\s+(test|run)|pnpm|cargo|go\s+test|make)\b`,
  String.raw`\b\d+\s*(passed|failed|skipped|errors?)\b`,
  String.raw`\bHTTP/\d|\b[1-5]\d\d\s+(OK|Created|Found|Bad|Unauthorized|Forbidden|Not\s+Found|Internal)`,
  'из лога|по логу|снимок|вывод команды|эталон|контроль сош',
]

/**
 * The strong subset: shapes that can only come from something having RUN —
 * a fenced block, an exit code, a test tally, an HTTP status line. A file path
 * alone is not here, because a path can honestly be recalled from earlier in
 * the conversation while a pasted transcript cannot.
 */
export const TRANSCRIPT = [
  '```',
  String.raw`\bexit\s+(code\s+)?\d+\b`,
  String.raw`\b\d+\s*(passed|failed|skipped|errors?)\b`,
  String.raw`\bHTTP/\d|\b[1-5]\d\d\s+(OK|Created|Found|Bad|Unauthorized|Forbidden|Not\s+Found|Internal)`,
  String.raw`\b(active\s*\(running\)|inactive\s*\(dead\)|Job\s+for\s+\S+\s+failed)\b`,
]

/** Tools whose result counts as an act of verification, not just of writing. */
export const VERIFYING_TOOLS = [
  'bash', 'shell', 'run_command', 'execute',
  'read', 'read_file', 'view', 'cat',
  'grep', 'search', 'glob', 'find',
  'test', 'run_tests', 'web_fetch', 'fetch',
]
