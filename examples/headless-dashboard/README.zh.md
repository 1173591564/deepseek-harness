# Headless Dashboard 与 Memory 组合

[English](README.md) | 中文

本 example 将 native loopback question dashboard 与可选但启用后 mandatory 的 Memory initialization 组合。可复用行为归 [`@deepseek-ai/dsh-user-questions-dashboard`](../../packages/interaction/user-questions-dashboard/README.md) 和 [`@deepseek-ai/dsh-memory-native`](../../packages/context/memory-native/README.md) 所有。

## Security 与 lifecycle

- Dashboard 绑定 `127.0.0.1`，校验精确 Host 与 same-origin Origin，并为 page、API 和 SSE 要求随机 HttpOnly capability cookie。
- Question ID 必须唯一；已接受答案保持请求顺序，并满足 required/custom-answer semantics。
- Disposal 会拒绝 pending question、移除 timer 与 abort listener、关闭 SSE client、注销 provider，并等待 server shutdown。
- Memory 可以禁用。启用时，authentication、participation persistence、authoritative readback 与 Session log 记录必须全部成功，之后才发布 model context。
- Memory credential 是通过 `ctx.credentials` 解析的 reference；key 不会存入 Session metadata 或 public plugin state。

## 挂载 example

Setup script 会保留不相关的 headless-profile 内容，只安装一个 managed block：

```sh
node examples/headless-dashboard/setup.mjs
node examples/headless-dashboard/setup.mjs uninstall
```

启用 session 前，配置的 Memory endpoint 与 credential reference 必须匹配 deployment。Team administration 与 centralized authorization 仍由外部 service 负责。

## 验证

运行 package behavior check：

```sh
node examples/headless-dashboard/self-test.mjs
node examples/headless-dashboard/test-memory-client.mjs
node examples/headless-dashboard/test-memory-native.mjs
node examples/headless-dashboard/test-setup.mjs
```

运行 Dashboard 与 Memory 的 package-owned 真实 Loader fixture：

```sh
node --import tsx/esm packages/interaction/user-questions-dashboard/tests/loader-driver.ts \
  examples/headless-dashboard/tests/fixtures/interaction/user-questions-dashboard/cordis.yml
node --import tsx/esm packages/context/memory-native/tests/loader-driver.ts \
  examples/headless-dashboard/tests/fixtures/context/memory-native/cordis.yml
```

`run-e2e-native.mjs` 驱动 credentialed headless session、回答 dashboard form、从持久化 metadata 发现 durable session identifier，并向配置的 proxy 查询 authoritative state。

## 已知限制

- Dashboard 是本地 browser interaction，不是远程共享团队 UI。
- 启用的 Memory session 依赖兼容的 MemoryCore 与 proxy endpoint。
- Multi-tenant authorization、quota、centralized audit 与更广泛的 corpus isolation 属于后续 Proxy Hub。
