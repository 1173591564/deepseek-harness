# Scholar DSH 学术专用版 0.2.7

该 bundle 为 DSH 学术组合提供 Scholar Studio wheel 与跨平台 installer。管理员在 Proxy Hub 签发长期 Scholar Token；用户首次进入 DSH 学术模式时只需粘贴 Token，验证成功后由 Managed Credential 永久保存。

## 内容物

- `scholar_studio-0.2.7-py3-none-any.whl`：Scholar CLI、MCP server 与 15 个固定本地 skill。
- `install.sh`：Linux/macOS installer。
- `install.ps1`：PowerShell installer。
- 本 README。

论文 corpus 不在 wheel 中。central corpus（563 篇）、embedding 与 vector index 全部在服务器侧，客户端零数据分发。

## 前置要求

- Python 3.10 或更高版本。
- 包含 `@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-scholar-native` 与 `@deepseek-ai/dsh-skill-filesystem` 的 DSH checkout。
- DeepSeek API key。
- **管理员签发的 Scholar Token**。

## 安装

```sh
# Windows
.\install.ps1
# Linux/macOS
bash install.sh
```

安装器安装 wheel、初始化 15 个本地 skill，并写入 DSH 学术模式预设。网关地址由该版本固定配置，普通用户不需要输入或修改。

启动 `dsh web`，选择「学术模式」。缺少 `SCHOLAR_REMOTE_TOKEN` 时，设置页显示 Token onboarding；粘贴 Token 后，DSH 调用 Proxy Hub `/v1/me` 验证 Token 名称与 Scholar 状态，成功后才写入 owner-only Managed Credential。后续会话自动复用该凭据。

远程 MCP 初始暂时不可用时，学术模式保持加载并在后台重试，不需要重启 DSH。明确的 `401` 会保留已保存的 Managed Credential，显示替换 Token 提示，并停止当前连接重试，直到粘贴管理员新签发的 Token；保存新 Token 会唤醒已停止的连接重试。明确的 `403` 是 authorization denial，不会使 credential 失效。网络故障、超时和 `5xx` 也不会清除已有 Managed Credential。管理员轮换 Token 后旧值会被 Proxy Hub 拒绝。

当前版本固定连接开发测试网关 `http://47.108.198.147:8081/v1/mcp/scholar`，DSH 会持续显示明文传输警告。仅使用可撤销的测试 Token；正式分发必须发布固定 HTTPS endpoint 的新版本。

## 本地 stdio 安装

本地数据模式先安装独立 data pack，再运行：

```sh
python -m pip install scholar_studio-0.2.7-py3-none-any.whl
scholar init
scholar init-dsh
```

`scholar init-dsh` 保留无关 DSH profile 内容，并同时生成 headless patch 与 academic preset。

## 验证

```sh
scholar --help
dsh web
```

## 卸载

```sh
scholar init-dsh --uninstall
python -m pip uninstall scholar-studio
```

管理员通过 OIDC 登录 Proxy Hub，进行 Token 签发、轮换、撤销、服务状态检查和审计日志查询。研究用户不登录管理员控制台。
