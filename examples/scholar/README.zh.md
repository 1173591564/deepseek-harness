# Scholar 第一阶段组合

[English](README.md) | 中文

本 example 通过已发布的 Cordis package 将 Scholar Studio 与 DSH 组合。可复用的 prompt、citation、lifecycle 与 security 行为归 [`@deepseek-ai/dsh-scholar-native`](../../packages/context/scholar-native/README.md) 和 [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md) 所有。

## 拓扑

- Local 模式通过 stdio 启动 `python -m scholar_mcp`，并可读取独立安装的本地 corpus data pack。
- Remote 模式通过 Proxy Hub 连接 Scholar。Server 拥有 central corpus、embedding 与 vector index；Proxy Hub 执行用户、租户、工具、配额、路由和审计策略。
- 两种模式都将 15 个固定 Scholar skill 保留为 client asset。
- 本地 stdio 将 Scholar 启动失败视为致命错误；远程 Proxy Hub 模式在初始失败后仍保持 academic composition 加载，并在后台重连。

## 本地开发安装

挂载 example 前先安装 Scholar Studio 0.2.7 并初始化本地资产：

```sh
python -m pip install scholar-studio==0.2.7
scholar init
node examples/scholar/setup.mjs
```

Setup script 会保留不相关的 profile 内容，并安装 stdio MCP client、隔离的 Scholar skill provider 和 native Scholar context package。只移除其 managed block：

```sh
node examples/scholar/setup.mjs uninstall
```

## Release 安装

Release bundle 包含 `scholar_studio-0.2.7-py3-none-any.whl`、`install.sh` 与 `install.ps1`。两个 installer 会初始化 15 个本地 skill 和 academic preset，但不保存 Token。

```sh
bash install.sh
```

运行 `dsh web` 并选择 academic preset。Onboarding step 只要求管理员签发的 Scholar Token，通过 Proxy Hub `/v1/me` 验证成功后才写入 owner-only Managed Credential；后续 session 自动复用该 credential。

明确的 `401` 会保留已保存的 Managed Credential，显示替换 Token 提示，并停止当前连接重试，直到保存替换值；明确的 `403` 是 authorization denial，不会使 credential 失效。Network failure、timeout 和 `5xx` response 也会保留已有 Managed Credential。

远程初始停机不会回滚 academic preset。DSH 会在后台重试；保存已配置的替换 Token 会唤醒已停止的 connection supervisor，无需重启 DSH。

该开发版本固定使用 `http://47.108.198.147:8081/v1/mcp/scholar` endpoint，并显示明文传输警告。只能使用可撤销的测试 Token；production release 必须使用固定 HTTPS endpoint。

## 验证

运行 example 验证套件：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts \
  examples/scholar/tests/scholar.e2e.ts
```

Keyless case 会启动真实 Loader configuration。存在 `DEEPSEEK_API_KEY` 时，真实 model 必须调用 Scholar MCP tool，测试验证 fixture server 的 audit record，而不接受 model prose。Scholar server protocol suite 另行覆盖缺失、错误与有效 Bearer authentication、MCP initialization、精确 16-tool catalog、lexical search 与 semantic search。Wheel 与 corpus data 保持为独立 artifact。

## 已知限制

- Remote operation 需要可用的 Scholar service 与 credential reference。
- Local literature ranking 需要独立安装的 data pack。
- Repository with-key smoke 使用本地 MCP fixture。Deployment release 仍需对其外部托管 endpoint 运行相同 protocol checks。
