# Scholar DSH 学术专用版 0.2.5

该 bundle 为 DSH 学术组合提供 Scholar Studio wheel 与跨平台 installer。默认走 **Proxy Hub 网关模式**（多租户身份、工具策略、配额、审计），本地 stdio 模式仍可用于自带知识库。

## 内容物

- `scholar_studio-0.2.5-py3-none-any.whl`：Scholar CLI、MCP server 与 15 个固定本地 skill。
- `install.sh`：Linux/macOS installer。
- `install.ps1`：PowerShell installer。
- 本 README。

论文 corpus 不在 wheel 中。central corpus（563 篇）、embedding 与 vector index 全部在服务器侧，客户端零数据分发。

## 前置要求

- Python 3.10 或更高版本。
- 包含 `@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-scholar-native` 与 `@deepseek-ai/dsh-skill-filesystem` 的 DSH checkout。
- DeepSeek API key。
- **管理员签发的 Scholar Access Key（`sk_scholar_v1_...`）**。

## 网关安装（默认，Proxy Hub 模式）

```sh
# Windows
.\install.ps1 -Gateway https://scholar.example/v1/mcp/scholar
# Linux/macOS
SCHOLAR_GATEWAY_URL=https://scholar.example/v1/mcp/scholar bash install.sh
```

安装器以隐藏输入读取 Access Key，再通过标准输入执行：

```sh
printf '%s\n' "$SCHOLAR_ACCESS_KEY" | scholar gateway-login \
  --gateway https://scholar.example/v1/mcp/scholar \
  --api-key-stdin
```

Access Key 存入 DSH owner-only managed credential；配置文件只含 credential reference，不含明文 Key。Proxy Hub 管理员控制每个 Key 的工具权限、请求配额、有效期、轮换和撤销。

管理员轮换 Key 后，重新运行 installer 或使用 `--api-key-stdin` 覆盖凭据即可，配置无需修改。`--code` 与 `--code-stdin` 保留用于旧 enrolment/capability 部署。

Scholar connection 使用 `failOnStartupError: true`。缺失、过期或已撤销的 Access Key 会使学术组合启动失败，不会静默降级。

## 无域名方案：SSH 隧道

每台客户端只需具备 Proxy Hub 服务器的 SSH 账号。先在一个终端启动隧道并保持运行：

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:9845:127.0.0.1:8081 \
  <ssh-user>@<proxy-host>
```

验证隧道：

```sh
curl -I http://127.0.0.1:9845/console/
```

另开一个终端执行安装：

```powershell
# Windows PowerShell
.\install.ps1 -Gateway http://127.0.0.1:9845/v1/mcp/scholar
```

```sh
# Linux/macOS
SCHOLAR_GATEWAY_URL=http://127.0.0.1:9845/v1/mcp/scholar bash install.sh
```

应为每位用户配置独立 SSH 账号或 authorized key，以便单独撤销隧道权限。SSH 只负责加密传输；Proxy Hub 会校验 Access Key，并执行用户、租户、工具、配额、有效期和撤销策略。

DSH 使用 Scholar 时需保持 SSH 终端运行；`Ctrl+C` 关闭隧道，下次使用前重新启动。每台客户端各自建立隧道，且只监听客户端 `127.0.0.1`，不会向局域网开放转发端口。

## 本地 stdio 安装

本地数据模式先安装独立 data pack，再运行：

```sh
python -m pip install scholar_studio-0.2.5-py3-none-any.whl
scholar init
scholar init-dsh
```

`scholar init-dsh` 保留无关 DSH profile 内容，并同时生成 headless patch 与 academic preset。

## 验证

```sh
scholar --help
scholar gateway-login --help
dsh --profile headless "用 scholar 工具查询知识库统计"
```

## 卸载

```sh
scholar init-dsh --uninstall
python -m pip uninstall scholar-studio
```

团队权限（OIDC 登录、租户 RBAC）、tenant tool policy、quota、centralized audit 由 Proxy Hub 管理。
