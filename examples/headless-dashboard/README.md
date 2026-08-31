# headless-dashboard

> dsh headless 模式的外部仪表盘答题实验 —— 验证 headless dsh 能否通过"原生 Cordis 插件 + 外部浏览器仪表盘"把交互式人机问答外包给独立 UI，全程不改 dsh 一行源码。

## 实验分两阶段

### P0-P3：仪表盘答题闭环（已完成）

验证 dsh headless 能否把 `ask_user_question` 工具的问答外包到外部浏览器仪表盘。

**判据全通过**：dashboard server up → question popped → answer accepted → dsh exit 0 → stdout contains answer。

### P4-b：三元组身份识别 + 上下文注入（已完成）

在 P0-P3 基础上，把 proxy 的 session-init 状态机 + 注入链路搬到 dsh 原生插件里。

**判据全通过**（6/6）：dashboard up → 3 轮 form（asset_confirm → agent_select → task_select）→ all accepted → exit 0 → agent replied → session-init completed + persisted to proxy。

## 文件

| 文件 | 阶段 | 作用 |
|---|---|---|
| `dashboard-provider.mjs` | P0-P3 | Cordis 插件：注册 userQuestions provider + HTTP 服务 |
| `dashboard.html` | P0-P3 | 仪表盘单文件 HTML |
| `setup.mjs` | P0-P3 | 幂等挂载/卸载（profile 补丁 + settings） |
| `self-test.mjs` | P0-P3 | 插件级自测（12 项） |
| `run-e2e.mjs` | P0-P3 | 端到端验证（单轮问答） |
| `memory-client.mjs` | P4-b | Gateway HTTP client（7 方法） |
| `test-memory-client.mjs` | P4-b | Gateway client 自测（7/7） |
| `memory-native.mjs` | P4-b | 状态机 + 注入插件（pre-step hook + systemPrompt section） |
| `run-e2e-native.mjs` | P4-b | 端到端验证（3 轮 form + 注入 + 持久化） |

## 复现步骤

### P0-P3（仪表盘答题）

```sh
node examples/headless-dashboard/setup.mjs
node examples/headless-dashboard/run-e2e.mjs
# 浏览器打开 http://127.0.0.1:8790
node examples/headless-dashboard/setup.mjs uninstall
```

### P4-b（三元组身份识别 + 注入）

```sh
# 前置：MemoryCore Gateway(:8420) + MemoryProxy(:8096) 在跑
# 前置：~/.dsh/.credentials.yaml 有 PROXY_USER_KEY

# 1. 停 docker proxy，本地起 proxy（带 native-init 端点）
docker stop tdai-proxy
cd ../../Projects/TencentDB-Agent-Memory/MemoryProxy && node --import tsx/esm src/index.ts --config config.yaml &

# 2. 挂载实验插件（3 个：tool-ask-user + dashboard-provider + memory-native）
node examples/headless-dashboard/setup.mjs

# 3. 端到端验证（自动答 3 轮 form）
node examples/headless-dashboard/run-e2e-native.mjs

# 4. 卸载 + 恢复
node examples/headless-dashboard/setup.mjs uninstall
docker start tdai-proxy
```

## P4-b 端到端验证结果

```
[e2e-native] ✓ dashboard server up
[e2e-native] round 1: Asset Confirm → "是，关联团队资产"
[e2e-native] round 2: Agent Select → "mem-e2e-agent"
[e2e-native] round 3: Task Select → "session-init 全链路验证"
[e2e-native] ✓ forms popped (3)
[e2e-native] ✓ all answers accepted
[e2e-native] [memory-native] persisted to proxy: dsh:session-xxx
[e2e-native] [memory-native] session-init complete: team=team-d03qdb2oty agent=agt-icyfau04jg task=task-icyf84pzjb
[e2e-native] [memory-native] registered systemPrompt section "memory-native-session-context"
[e2e-native] ✓ dsh exit code 0
[e2e-native] ✓ stdout indicates agent replied
[e2e-native] ✓ session-init completed / persisted
```

Gateway client 自测 7/7：verifyAuth / listTeams / listAgents / listTasks / getAgent / getTask / appendParticipationLog。

## 技术要点

- **挂载方式**：`cordis.patch.yml` 用 `- insert:` 包裹新插件行（普通条目只覆盖已有行）
- **状态机阻塞**：用 `agent/pre-step` waterfall（阻塞 LLM 请求），不用 `agent/session-start`（emit 不阻塞，会导致 LLM 在状态机完成前就跑）
- **注入方式**：用 `ctx.systemPrompt.section()` 注册动态 section（text 是函数，每次 assemble 时取最新 session 状态），不改 pre-step 的 messages（改 messages 会触发 TRANSPORT 错误）
- **provider 超时**：强制 10 min 超时 + abort signal 监听（防 dsh 工具执行器永不放弃导致的进程挂死）
- **proxy 持久化**：新增 `POST /v3/session/native-init` 端点（实验用，无鉴权），外部插件选完三元组后 POST 给 proxy，proxy 落 SessionStore（L1 内存 + L2 SQLite）

## 结论

**两阶段全部跑通。**

1. **P0-P3**：headless dsh 可以通过原生 Cordis 插件 + 外部仪表盘外包交互式问答，零 dsh 源码改动。
2. **P4-b**：dsh 原生插件可以完整复刻 proxy 的 session-init 状态机（asset_confirm → team → agent → task，含 auto-select/bypass）+ 持久化到 proxy SessionStore + 注入 `<session_context>` [Agent]/[Task] 段到 system prompt。

这证明了 **dsh 原生插件 + 外部仪表盘是 headless dsh 接入腾讯 agent memory 的可行完整路径**——从身份识别到上下文注入，全链路原生实现，不依赖 proxy 的 HTTP 拦截。
