# Scholar 第一阶段组合

[English](README.md) | 中文

本 example 通过已发布的 Cordis package 将 Scholar Studio 与 DSH 组合。可复用的 prompt、citation、lifecycle 与 security 行为归 [`@deepseek-ai/dsh-scholar-native`](../../packages/context/scholar-native/README.md) 和 [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md) 所有。

## 拓扑

- Local 模式通过 stdio 启动 `python -m scholar_mcp`，并可读取独立安装的本地 corpus data pack。
- Remote 模式直连 Scholar Streamable HTTP endpoint。Server 拥有 central corpus、embedding 与 vector index。
- 两种模式都将 15 个固定 Scholar skill 保留为 client asset。
- Scholar connection 与 tool synchronization 是 mandatory；academic composition 使用 `failOnStartupError: true`。

Team authorization、quota、centralized audit 与 tenant corpus isolation 属于后续 Proxy Hub，不属于 direct-client composition。

## 本地开发安装

挂载 example 前先安装 Scholar Studio 0.2.5 并初始化本地资产：

```sh
python -m pip install scholar-studio==0.2.5
scholar init
node examples/scholar/setup.mjs
```

Setup script 会保留不相关的 profile 内容，并安装 stdio MCP client、隔离的 Scholar skill provider 和 native Scholar context package。只移除其 managed block：

```sh
node examples/scholar/setup.mjs uninstall
```

## Release 安装

Release bundle 包含 `scholar_studio-0.2.5-py3-none-any.whl`、`install.sh` 与 `install.ps1`。两个 installer 都会先初始化 15 个本地 skill，再生成引用 credential 的 DSH configuration。必须显式设置 Proxy Hub endpoint；公网 endpoint 使用 HTTPS，开发环境可以使用数字 loopback 地址。

```sh
SCHOLAR_GATEWAY_URL=https://scholar.example/v1/mcp/scholar bash install.sh
```

Token 以不回显方式读取并通过 stdin 传递。它存入 DSH managed credential，不会写入 YAML 或 process argument。

## 无公网域名时使用 SSH 隧道

只要拥有 Proxy Hub 服务器的 SSH 账号，即可通过加密的 loopback 连接使用网关，无需公网 HTTPS 域名。在一个终端启动隧道并保持运行：

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:9845:127.0.0.1:8081 \
  <ssh-user>@<proxy-host>
```

使用一次性兑换码前，先确认控制台能通过隧道响应：

```sh
curl -I http://127.0.0.1:9845/console/
```

在第二个终端中，让 installer 连接 loopback 网关：

```powershell
# Windows PowerShell
.\install.ps1 -Gateway http://127.0.0.1:9845/v1/mcp/scholar
```

```sh
# Linux/macOS
SCHOLAR_GATEWAY_URL=http://127.0.0.1:9845/v1/mcp/scholar bash install.sh
```

应为每位用户配置独立 SSH 账号或 authorized key，以便单独撤销隧道权限。SSH 只提供加密传输；Proxy Hub 仍会通过成员关系、工具策略、配额和用户 capability 对每次 Scholar 请求授权。

DSH 使用 Scholar 时必须保持隧道运行。按 `Ctrl+C` 可关闭；下次使用 Scholar 前重新执行同一条 SSH 命令。每台客户端各自建立隧道，且只绑定 `127.0.0.1`，不会把转发后的网关开放给客户端所在网络的其他电脑。

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
