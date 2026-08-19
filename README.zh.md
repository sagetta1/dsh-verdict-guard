# verdict-guard

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 原生插件。
**一个下了结论的回合，在结论拿不出可查证的东西之前不会结束。**

```
模型：  “这个过滤器不工作，这个方向到此为止。”
插件：  拦下 —— 有结论，没有证据。
模型：  （去跑一遍，贴出真实输出；或者收回这句话）
```

## 为什么

Agent 产出的最贵的东西不是一个改错的补丁，而是一个下错的**否定结论**：
「不工作」「这里没有 bug」「复现不了」。

说错的「能用」会被下一次运行抓住 —— 它留下痕迹。
说错的「不能用」不留痕迹：一个方向被悄悄关掉，而已经有答案的问题没人会再打开。
两类错误的代价并不相等，那么它们要求的证明标准就不该相同。

这个插件把这种不对称变成机制：在回合的停止边界上，它读两样东西 ——
模型准备用来收尾的那段话，以及这个回合**实际做过什么**。

## 什么算证据

| 信号 | 来源 |
|---|---|
| ``` 代码块、退出码、测试计数、HTTP 状态行 | 回答的文本 |
| `file.ts:88`、文件路径、日志名、`journalctl`、`pytest` … | 回答的文本 |
| 一次「验证类」工具的结果 —— `bash`、`read`、`grep`、`test` … | **该回合的会话日志** |

第三行正是它是插件而不是 shell hook 的原因。纯文本检查只能看到模型**写了**什么，
会话日志才说明**跑过**什么。

由此得到一项 hook 做不到的检查：

> 回答里贴着命令输出 —— ``` 代码块、`12 passed, 0 failed`、退出码 ——
> 而这个回合**一个工具都没调用**。那段文字只可能是写出来的，不是观察到的。
> 这种情况会被拦下，并给出比「缺引用」更明确的说明。

单独一个文件路径**不会**触发这条更严格的判定：路径可以是从对话前文如实回忆的，
而一段命令记录不能。

## 安装

```sh
dsh plugin add dsh-plugin-verdict-guard
```

安装到此为止。包内声明了 `dsh.bundle` manifest，插件会以自己的 bundle 层进入 profile，
所有选项取默认值 —— 不需要手写任何一行配置。确认它进入了插件树：

```sh
dsh --profile headless --dump-config | grep -A 3 verdict-guard
```

要改默认值，在 profile 自己的 patch 层
（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`，它在所有 bundle 层之后应用）里加一行：

```yaml
- id: verdict-guard
  config:
    locale: en
    requireToolEvidence: false
    maxInterventionsPerTurn: 2
```

## 配置

| 选项 | 默认值 | 含义 |
|---|---|---|
| `locale` | `both` | 启用哪套结论词表 —— `en`、`ru`、`both` |
| `requireToolEvidence` | `true` | 结论需要一次**验证类**工具结果，而不是任意一次工具调用 —— 写文件不等于核对 |
| `verifyingTools` | bash/read/grep/test… | 算作验证的工具名 |
| `extraVerdictPatterns` | — | 追加到内置结论词表的正则 |
| `extraEvidencePatterns` | — | 追加到内置证据词表的正则 |
| `verdictPatterns` | — | 整体替换内置结论词表 |
| `evidencePatterns` | — | 整体替换内置证据词表 |
| `maxInterventionsPerTurn` | `1` | 同一回合最多被拦几次 |
| `maxInterventionsPerSession` | `6` | 同一会话累计最多被拦几次 |
| `verbose` | `false` | 以 debug 级别记录每次放行 |

空数组一律读作「没有提供」，而不是「什么都不匹配」——
这样一来，把未设置的数组选项填成 `[]` 的配置，不会让插件看起来配好了却其实全部放行。

## 它不是什么

它不判断一个结论**是否为真** —— 没有 oracle，没有验收标准，没有契约。
它只查一件事：这个回答有没有给出任何可以去查的东西。
一个错误的结论只要旁边有真实的命令输出，在这里就会放行，交给读的人去发现；
一个正确的结论如果旁边什么都没有，会被拦下。

默认情况下每个回合也只拦**一次**。它是出门前的一道减速带，不是必须闯过的关卡。

## 工作原理

一个监听器，挂在 harness 自己的停止边界 `agent/turn-stopping` 上：

```
agent/turn-stopping  →  读该回合收尾的 assistant 文本
                     →  读该回合的 tool/call + tool/result 事件
                     →  有结论？有证据？  →  agent.steer(原因)
```

steer 会让状态机重新观察待处理输入并再跑一步，这正是该边界上「监听器提出异议」的
既定做法。agent loop 本身没有被改动任何一处。

**插件自己限流。** harness 在这里还没有防循环保护：loop 里写着
`TODO(stop-loop-guard)`，而 Claude Code hook 桥接层无条件上报
`stop_hook_active: false`。因此一个会 steer 的监听器必须自己设上限，否则它可能让一个
回合永远关不掉。`maxInterventionsPerTurn`（默认 `1`）就是这个上限 ——
拦一次，之后无论模型说什么，回合都会结束。

## 兼容性

针对 `0.1.0-rc.8` 构建与测试。

⚠️ **harness 自己那些子包的 `latest` dist-tag 是过期的。**
`@deepseek-ai/dsh-tools`、`-llm`、`-session` 等把当前线发布在 `next`（`0.1.0-rc.8`）下，
而 `latest` 仍指向 `0.0.1-rc.1`。不写明范围地安装它们会混进两代不兼容的包 ——
并且部分 `0.0.1-rc.1` 依赖 `@deepseek-ai/dsh-bash`，这个包已经不存在了。
请锁定 `^0.1.0-rc.8`，或用 `@next` 安装。

## 开发

```sh
npm install
npm test     # 24 个测试：检测器本身，以及插件在真实 agent loop 上的行为
npm run build
```

集成测试用脚本化的模型适配器驱动真实的 `AgentLoop`，
因此两种结果 —— 被拦下与正常结束 —— 都不需要 provider key 就能验证。

## 许可

MIT

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
