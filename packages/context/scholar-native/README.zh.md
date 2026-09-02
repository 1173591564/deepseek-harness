# @deepseek-ai/dsh-scholar-native

[English](README.md) | 中文

在 DSH system prompt 组装阶段加入按 agent 隔离的 Scholar Studio 文献上下文，并在学术文件写入成功后审计未解析的引用键。

## 配置

```yaml
- id: scholar-native
  name: '@deepseek-ai/dsh-scholar-native'
  config:
    scholarHome: /path/to/.scholar
```

插件启用时必须提供 `scholarHome`。该目录保存本地规则、用户兴趣和可选的本地 corpus data pack。索引是派生缓存；corpus 文件元数据变化时会原子重建。

插件在 system prompt 组装前为当前请求所属的 agent 刷新文献，只从持久化 user message 派生 session topic，并使用该 agent 的状态渲染每个 prompt section。并发 agent 不能提供或替换彼此的 section。

仅当 `write` 或 `str_replace_editor` 成功且目标仍位于 Scholar output 目录内时才执行引用审计。审计结果通过 model-visible additional context 返回。审计失败会阻止模型直接收尾，但不会暴露文件路径或解析细节。

## 模型体验

### Scholar 文献上下文

#### 模型看到的内容

请求包含有大小限制的 Scholar 人格、研究兴趣和排序文献上下文；这些内容来自当前 agent 的持久化 user message 与本地 Scholar 资产。

#### Token 影响

人格与兴趣增加有大小限制的稳定文本。文献最多增加 `literatureMaxBytes`；话题变化会替换当前请求的 section，而不是累积副本。

#### KV Cache 影响

稳定的人格与兴趣保持请求前缀不变。文献话题变化会使第一个变化的文献 token 之后无法复用。

### 引用审计反馈

#### 模型看到的内容

学术文件成功写入后，未解析的引用键会作为额外工具上下文出现，要求模型在结束前重新读取并修正文件。

#### Token 影响

有大小限制的引用键列表只在符合条件的写入后增加上下文；除非普通 Session log 保留该工具结果，否则不会进入后续请求。

#### KV Cache 影响

追加式工具上下文位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与延期工作

- Remote MCP 检索和中央 corpus 由 Scholar server 提供；本 package 不下载或同步 corpus。
- 本地排序仅为 lexical ranking，且只在安装 local data pack 时可用。
- 团队策略、配额、集中审计和多租户 corpus 隔离需要计划中的 Proxy Hub，不属于 direct-client plugin。
