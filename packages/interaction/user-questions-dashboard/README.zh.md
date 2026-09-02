# @deepseek-ai/dsh-user-questions-dashboard

[English](README.md) | 中文

通过 loopback HTTP dashboard 提供 `ctx.userQuestions`。每个 plugin instance 都会生成随机 HttpOnly capability，并校验精确的 loopback `Host` 与 same-origin `Origin`；缺少任一条件的请求都会被拒绝。

## 配置

```yaml
- id: dashboard-provider
  name: '@deepseek-ai/dsh-user-questions-dashboard'
  config:
    port: 8790
    timeoutMs: 120000
    autoOpen: true
```

Question ID 必须唯一。Answer 必须保持问题顺序、满足 required field，并遵守 single-select 或 multi-select 的 custom-answer 语义。Caller abort、timeout 和 plugin disposal 都会拒绝 pending work，并清理 timer 与 listener。

Provider registration 和 HTTP server 都属于 Cordis plugin lifecycle。Disposal 会注销 provider、拒绝 pending question、关闭 SSE connection，并等待 loopback server 停止接收工作。

## 模型体验

### Dashboard 答案

#### 模型看到的内容

本地 dashboard 完成当前 batch 后，面向模型的 consumer 按原始问题顺序收到已接受答案；`dsh-user-questions` 结果不包含 HTTP capability 或 validation 细节。

#### Token 影响

只有 consumer 渲染的问题和已接受答案产生 token；Dashboard transport 状态不增加 token。

#### KV Cache 影响

已接受答案追加在可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与延期工作

- 仅支持本地 same-origin browser；本 package 不是团队共享 dashboard。
- Plugin restart 会使随机 capability 和 pending question 失效。
- Remote access、tenant identity、quota 和集中审计属于后续 Proxy Hub。
