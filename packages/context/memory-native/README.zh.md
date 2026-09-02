# @deepseek-ai/dsh-memory-native

[English](README.md) | 中文

通过带凭证的 MemoryCore 元数据初始化 DSH session，使用 `ctx.userQuestions` 获取缺失选择，持久化 participation state，执行权威回读，然后把有大小限制的模型上下文追加到持久化 Session log。

## 配置

```yaml
- id: memory-native
  name: '@deepseek-ai/dsh-memory-native'
  config:
    enabled: true
    memoryEndpoint: https://memory.example
    proxyEndpoint: https://proxy.example
    userKeyEnv: MEMORY_USER_KEY
    proxyBearerTokenEnv: MEMORY_PROXY_TOKEN
```

凭证字段是 environment-style reference，每次操作都通过 `ctx.credentials` 解析。Literal key 不会进入配置、Session metadata 或插件公开状态。除显式 loopback 开发端点外必须使用 HTTPS，并拒绝 redirect。

插件启用后，认证和持久化都是 mandatory。只有 participation persistence 成功且 proxy 返回权威回读后，初始化才会发布模型上下文。Caller cancellation 会传递给 user question 和网络操作；客户端会区分 caller cancellation 与内部 request timeout。

## 模型体验

### 持久化参与上下文

#### 模型看到的内容

只有当同一选择同时存在于权威外部持久化状态与 Session log 后，请求才包含有大小限制的 user、team、agent 和 task snapshot。

#### Token 影响

初始化完成后，该上下文为每个组装请求增加最多 `contextMaxBytes`，重复组装不会继续增长。

#### KV Cache 影响

未变化的 participation snapshot 保持请求前缀不变。外部持久化选择变化会使第一个变化的上下文 token 之后无法复用。

## 已知限制与延期工作

- 部署必须提供兼容的 MemoryCore 与 proxy endpoint。
- 本插件不实现团队管理、配额或集中授权策略。
- 启用后的 session 可用性依赖所配置的 MemoryCore 与 proxy service，不会静默降级到本地状态。
