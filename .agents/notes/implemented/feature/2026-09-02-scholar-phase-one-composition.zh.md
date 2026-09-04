# Agent Note: Scholar 第一阶段组合

Status: implemented

[English](2026-09-02-scholar-phase-one-composition.md) | 中文

## Problem

Scholar 实验混合了 example-local plugin、可选启动、literal HTTP authentication、进程全局 agent 状态，以及缺少统一安全策略的浏览器访问。该拓扑可以演示单项功能，但无法提供可复现安装、mandatory 学术工具、可重建模型上下文或安全并发 session。

## Decision

第一阶段采用 DSH client 直连 Scholar server 的拓扑。`@deepseek-ai/dsh-mcp-client` 提供 mandatory stdio 或 Streamable HTTP 工具，`@deepseek-ai/dsh-scholar-native` 提供按 owner 隔离的文献与引用上下文，`@deepseek-ai/dsh-user-questions-dashboard` 提供 loopback 交互，`@deepseek-ai/dsh-memory-native` 在启用时初始化外部持久化 participation context。Example tree 只保存 Loader wiring 与验证场景；可复用行为归这些 package 所有。

团队部署通过 [Proxy Hub Access Key](2026-09-03-scholar-proxy-hub-access-keys.md)扩展 remote transport；本地和直连认证的 Scholar 运行继续使用该组合。

Scholar activation 使用 `failOnStartupError: true`。Remote authentication 指向 credential reference，并为每个请求重新解析；静态敏感标头会被拒绝。HTTP 仅限 HTTPS 或显式 loopback 开发 endpoint，并拒绝 redirect。Release installer 要求显式 gateway，并通过标准输入把隐藏输入的 enrolment code 传给 `gateway-login`，不放入进程参数。Scholar server 拥有 remote corpus、embedding 与 vector index。本地 stdio 安装可以使用单独安装的 data pack；Scholar wheel 携带代码与固定本地 skills，不携带 corpus data。

Scholar 文献状态按发起请求的 agent 建立索引。Prompt assembly 在渲染前从持久化 user message 刷新；citation audit 只观察配置 Scholar output 目录内的成功写入。Memory 仅在 authentication、persistence、authoritative readback 与 Session log 记录均成功后发布上下文。Dashboard 绑定 loopback、校验精确 Host 与 same-origin Origin，并对 page、API 和 SSE 使用同一个随机 capability cookie。

## Verification

Package tests 覆盖 authentication policy、credential rotation、path containment、并发 agent 隔离、cancellation、persistence readback、question validation 与 disposal。Package-owned Loader fixture 通过真实 app composition 启动 Scholar、Dashboard 与 Memory，并断言 model-visible、durable 或 user-visible 输出。Scholar example 的 with-key smoke 要求真实 model 调用 MCP tool，并独立于 model prose 验证 fixture server audit record。Scholar protocol coverage 覆盖缺失、错误与有效 authentication、MCP initialization、精确 16-tool set、lexical search 与 semantic search。

## Alternatives considered

**保留 example-local plugin 实现。** 拒绝，因为 example 无法拥有可复用的 lifecycle、security、configuration 与 publication contract，也不受 package-level coverage 和 documentation gate 约束。

**允许 Scholar startup 静默降级。** 拒绝，因为缺少声明研究工具的 academic preset 会向模型提供误导性的运行环境。Operator 可以显式禁用该组合。

**从 remote server 同步 skills 与 vector index。** 拒绝，因为 skills 是固定 client asset，而 corpus 与派生 retrieval state 归 server 所有。混合这些 lifecycle 会使安装不可复现，并扩大 credentialed data surface。

**把 Proxy Hub 纳入基础组合。** 拒绝，因为本地和直连认证的 Scholar 运行不需要独立的团队 service 与 deployment model。团队部署在 remote transport 上增加 Proxy Hub。

## Consequences

第一阶段 availability 依赖所选 Scholar transport；启用 Memory 时还依赖配置的 Memory service。Failure 会显式暴露，而不会被本地 shadow state 替代。Remote client 不需要 corpus、database、embedding 或 vector-index credential。Direct-client security policy 不隐含 Proxy Hub 团队控制；部署必须显式选择该扩展。
