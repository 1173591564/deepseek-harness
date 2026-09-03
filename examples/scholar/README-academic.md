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
- **管理员发放的一次性兑换码（enrolment code）**。

## 网关安装（默认，Proxy Hub 模式）

```sh
# Windows
.\install.ps1 -Gateway https://scholar.example/v1/mcp/scholar
# Linux/macOS
SCHOLAR_GATEWAY_URL=https://scholar.example/v1/mcp/scholar bash install.sh
```

安装器以隐藏输入读取一次性兑换码，再通过标准输入执行：

```sh
printf '%s\n' "$ENROLMENT_CODE" | scholar gateway-login \
  --gateway https://scholar.example/v1/mcp/scholar \
  --code-stdin
```

流程：兑换码 → Proxy Hub `/v1/session` 换取短期 capability → capability 存入 DSH owner-only managed credential（配置文件只含 credential reference，不含明文 token）。有效期以 Proxy Hub 返回的 `expires_at` 为准。

**capability 到期后**向管理员索取新兑换码，重跑 installer 或使用 `--code-stdin` 即可——只需覆盖凭据，配置不动。

Scholar connection 使用 `failOnStartupError: true`。缺失或过期的 capability 会使学术组合启动失败，不会静默降级；此时即为本命令重跑的时机。

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
