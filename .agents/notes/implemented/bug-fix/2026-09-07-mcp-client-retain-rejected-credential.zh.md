# Agent Note: 保留被拒绝的 MCP credential

Status: implemented

[English](2026-09-07-mcp-client-retain-rejected-credential.md) | 中文

## Problem

策略限制的 gateway 可能对有效 Scholar Token 返回 HTTP 403 `tool_denied`。如果把该响应当作 authentication rejection，就会删除有效 credential，使后续请求只得到含糊的“credential 未配置”错误。

## Decision

只有 HTTP 401 才是 authentication rejection。MCP client 保留已配置 credential，发出包含 server name 与 credential reference 的 `mcp-client/authentication-rejected`，停止当前 connection outage，并在配置替换 credential 后恢复。Scholar onboarding controller 不依赖 credential 是否已配置，单独显示替换 Token 提示。

## Alternatives considered

**继续在 401 时 unset。** 拒绝，因为会静默丢失数据，也不会说明需要替换哪个 credential。

**根据 server error code 区分 authentication failure。** 拒绝，因为 gateway-specific error code 不能定义 transport-level authentication contract。

## Consequences

HTTP 403 仍然作为 authorization failure 结束请求，同时保留 credential。HTTP 401 向浏览器提供足够的身份信息，使其能显示替换 Token 提示，而无需用户先重新输入值才能看到失败原因。
