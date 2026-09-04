# @deepseek-ai/dsh-client-ui-scholar-onboarding

[English](README.md) | 中文

学者模式首次 Token 引导。只有 Host roster 包含 `academic` agent preset，且可写的 `SCHOLAR_REMOTE_TOKEN` Managed Credential 尚未配置时，步骤才会激活。

弹窗使用 password-style 输入 Token，先通过配置的 Proxy Hub `/v1/me` endpoint 验证身份，并要求响应包含非空 `name`，成功后才调用 `credentials.set`。`401` 与 `403` 表示 credential 无效。网络错误、超时、redirect 和其他非成功响应不会修改 Managed Credential，并允许重试。

## Configuration

| 字段 | 必填 | 含义 |
|---|---|---|
| `gatewayUrl` | 是 | 固定的 Proxy Hub Scholar MCP endpoint；浏览器从同一 origin 派生 `/v1/me` |
| `allowInsecureHttp` | 否 | 仅用于 development 的非 loopback HTTP 许可；默认 `false` |
| `validationTimeoutMs` | 否 | 身份验证超时毫秒数；默认 `20000` |

发布的 web bundle 使用 `allowInsecureHttp: true` 组合当前 development HTTP gateway，因此弹窗会显示明文传输警告。HTTP 会暴露 Token 和研究请求，只能使用可撤销的测试 Token。Production composition 必须使用 HTTPS。

## Model Experience

无，因为本 package 只渲染浏览器 credential 引导；这里的内容不会进入 model request。

#### KV Cache effect

无；本 package 既不组装也不发送 provider request。

## Known Limitations and Deferred Work

- 本 package 识别 `academic` preset ID。重命名 Scholar preset 的 deployment 必须同时更新 composition 与本 package。
