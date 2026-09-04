# Agent Note: Scholar Proxy Hub Access Key

Status: implemented

[English](2026-09-03-scholar-proxy-hub-access-keys.md) | 中文

## Problem

[Scholar 直连组合](2026-09-02-scholar-phase-one-composition.md)接受 managed Bearer credential，但小型实验室需要由管理员控制身份生命周期，且不能要求每位研究用户理解 OIDC principal、tenant membership、一次性 enrolment 或 capability exchange。

## Decision

Proxy Hub 管理员为每位研究用户或设备签发独立的 `sk_scholar_v1_...` Access Key。每个 Key 绑定一个 managed researcher 和 tenant，限制 Scholar tools，可携带请求配额和有效期，并能独立轮换或撤销。Proxy Hub 在每次 MCP 请求中校验 Key，并注入自己的 Scholar backend credential；客户端 Key 绝不转发给上游。

Scholar installer 以不回显方式读取 Access Key，并通过 `scholar gateway-login --api-key-stdin` 传递。该命令校验版本化前缀，将 Key 存入 DSH managed credential，并只把 credential reference 写入 Scholar composition；它不会调用 enrolment session endpoint。`--code` 与 `--code-stdin` 在迁移期间保留一次性 enrolment 和短期 capability 流程。

实验室没有公网 TLS endpoint 时，可以通过 SSH port forwarding 提供 loopback HTTP gateway。隧道负责加密传输和服务器网络准入；Proxy Hub 仍负责身份、租户、工具、配额、有效期、撤销、路由和审计决策。

## Verification

Installer 场景断言 Access Key 只经过标准输入，且不出现在进程参数中。Scholar CLI 测试断言直接保存 Key 时不发起 session exchange、拒绝无效前缀、配置只保留 credential reference，并保留旧 enrolment exchange。

## Alternatives considered

**要求每位研究用户通过 Dex 认证。** 拒绝，因为 console 身份管理与 DSH 数据访问面向不同用户并具有不同生命周期。Dex 保留为管理员登录方式，而不是研究客户端的前置条件。

**只签发一次性 enrolment code 和短期 capability。** 拒绝作为实验室主流程，因为每次到期都需要管理员再次介入兑换。该流程保留用于兼容。

**把客户端 Access Key 转发给 Scholar。** 拒绝，因为这会让数据平面耦合 Proxy Hub credential，并把用户 secret 暴露给授权所有者以外的组件。

**把 SSH 账号当作 Scholar 身份。** 拒绝，因为隧道只能控制网络准入，无法表达 tenant membership、Scholar tool permission、应用配额或应用审计身份。

## Consequences

研究用户完成一次隐藏 Key 登录后，即可使用生成的 Scholar preset，直到 Key 过期、轮换或撤销。管理员无需配置 Dex 账号即可按用户或设备管理访问。长期 credential 要求服务端只保存 digest、完整 Key 只显示一次、客户端 owner-only 存储并支持独立轮换。旧 capability 流程在迁移支持移除前会增加临时实现与测试成本。
