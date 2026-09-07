# Agent Note: Scholar 单实验室 Token 引导

Status: implemented

[English](2026-09-04-scholar-single-lab-token-onboarding.md) | 中文

## Problem

[Proxy Hub Access Key 流程](2026-09-03-scholar-proxy-hub-access-keys.md)支持 tenant membership、policy、quota 和有效期选择，而单个实验室与单套 Corpus 不需要这些选择。研究用户需要一个由管理员签发的 Token 和一次 DSH 首次使用操作，无需访问管理员 console 或 deployment endpoint。

## Decision

单实验室 Proxy Hub 在现有管理员 OIDC 登录后提供 Token management、Service status 与 Audit log。Token 名称经过 trim、NFKC normalization 和 case folding 后标识一个 active Token。新的 facade Token 获得全部 Scholar MCP Tools，不设置用户 quota，并持续有效直到 rotation 或 revoke；Proxy Hub 保留全局 concurrency、request-size、timeout 和 Scholar Backend circuit protection。服务端只保存 digest，raw Token 只显示一次，且绝不转发给 Scholar Backend。

`@deepseek-ai/dsh-client-ui-scholar-onboarding` 注册一个 `settings.onboarding` 步骤。存在 `academic` preset 且可写的 `SCHOLAR_REMOTE_TOKEN` Managed Credential 缺失时，该步骤出现。Deployment composition 提供固定 `gatewayUrl`，普通用户只输入 Token。Controller 从 gateway origin 派生 `/v1/me`，使用 Bearer authentication 调用该地址，并仅在成功响应包含非空 `name` 后写入 Managed Credential。

MCP HTTP transport 在明确收到 `401` 后保留 provider-managed credential、发出 typed rejection event，并停止当前 connection outage，直到配置替换值。明确的 `403` 是 authorization denial，不会使 credential 失效。网络错误、超时、redirect、`5xx` response 和 MCP Tool error 也保留该 credential。若初始连接或重连预算已经停止，保存替换 credential 会启动新的连接尝试；已建立的连接在下一次请求时读取新值。除非 DSH composition 显式允许非 loopback HTTP，否则必须使用 HTTPS；Proxy Hub deployment 还需单独允许 development HTTP。启用 HTTP 时，浏览器显示明文传输警告。

Token 和 onboarding state 不进入 Session event 或 model request。

## Verification

Package tests 覆盖激活条件、验证顺序、request header、identity parsing、credential write failure、双语 dialog state、固定 endpoint composition 和 slot disposal。MCP integration tests 覆盖 authentication rejection 后保留 credential 与发送 rejection event、`5xx` 后保留 credential，以及匹配且已配置的 credential 更新后重新连接。发布的 web composition 与 browser replay 覆盖 package 注册和首次使用 dialog。

## Alternatives considered

**向实验室管理员暴露 tenant、membership、policy 和 quota 控制。** 拒绝，因为这些控制在单 Corpus deployment 中不代表真实选择。Proxy Hub 保留其内部 compatibility model。

**允许每位研究用户编辑 Proxy Hub endpoint。** 拒绝，因为 endpoint ownership 属于 deployment composition，且可编辑 endpoint 会增加 phishing 与明文传输风险。

**验证前保存 Token。** 拒绝，因为被拒绝或 malformed credential 会进入 durable storage，并需要独立清理路径。

**每次 connection failure 都删除 credential。** 拒绝，因为 Scholar Backend 或网络的 transient failure 会破坏有效本地配置并反复打开 onboarding。

**把 Token 放入 static MCP header。** 拒绝，因为 static sensitive header 可能通过配置泄露，并绕过 Managed Credential ownership。

## Consequences

研究用户首次使用时粘贴一次 Token，后续 Scholar session 复用仅 owner 可读的 Managed Credential。Rotation 或 revoke 会使下一次明确的 authentication rejection 保留 managed value、通知浏览器并显示替换 Token onboarding。保存替换 Token 后，已停止的 MCP connection 无需重启 DSH 即可恢复。管理员操作一个 Token facade，内部 tenant 与 policy record 继续用于 compatibility。

Development HTTP 允许针对当前公网 endpoint 测试，但会明文暴露 Token 与研究流量。该 composition 只能使用可撤销的测试 Token；分发长期 Token 必须使用 HTTPS 或加密私网。
