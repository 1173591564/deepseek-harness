# Scholar DSH 学术专用版 0.2.3

该 bundle 为 DSH 第一阶段学术组合提供 Scholar Studio wheel 与跨平台 installer。Remote 模式采用 DSH client 直连 Scholar Streamable HTTP server；Local 模式通过 stdio 启动同一 Scholar MCP surface。

## 内容物

- `scholar_studio-0.2.3-py3-none-any.whl`：Scholar CLI、MCP server 与 15 个固定本地 skill。
- `install.sh`：Linux/macOS installer。
- `install.ps1`：PowerShell installer。
- 本 README。

论文 corpus 不在 wheel 中。Remote server 拥有 central corpus、embedding 与 vector index；Local stdio 可使用单独安装并校验的 data pack。

## 前置要求

- Python 3.10 或更高版本。
- 包含 `@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-scholar-native` 与 `@deepseek-ai/dsh-skill-filesystem` 的 DSH checkout。
- DeepSeek API key。
- Remote 模式所需的 Scholar Bearer token。

## Remote 安装

公网 endpoint 必须使用 HTTPS：

```sh
SCHOLAR_REMOTE_URL=https://scholar.example/mcp bash install.sh
```

默认 endpoint 为 `http://127.0.0.1:9845/mcp`，仅用于显式 SSH tunnel：

```sh
ssh -N -L 9845:127.0.0.1:9845 scholar-server
bash install.sh
```

Installer 依次安装 0.2.3 wheel、初始化 15 个本地 skill，并调用 `scholar init-dsh --remote ... --token-stdin`。Token 输入不回显，通过 stdin 传递，并存入 DSH owner-only managed credential；YAML 与 process argument 只包含 credential reference。

Scholar connection 与 16-tool synchronization 使用 `failOnStartupError: true`。缺失或错误的 credential 会使学术组合启动失败，不会静默降级。

## Local stdio 安装

本地数据模式先安装独立 data pack，再运行：

```sh
python -m pip install scholar_studio-0.2.3-py3-none-any.whl
scholar init
scholar init-dsh
```

`scholar init-dsh` 保留无关 DSH profile 内容，并同时生成 headless patch 与 academic preset。Scholar native context 使用 DSH package，不从 wheel 安装 ad-hoc JavaScript plugin。

## 验证

```sh
scholar --help
scholar init-dsh --check --remote https://scholar.example/mcp
dsh --profile headless "用 scholar 工具查询知识库统计"
```

Release validation 还会检查 wheel version、15 个 skill、clean HOME、现有文件保留、credential YAML、owner-only permission、malformed credential rollback，以及配置和 process argument 中不存在 literal token。

## 卸载

```sh
scholar init-dsh --uninstall
python -m pip uninstall scholar-studio
```

团队权限、tenant policy、quota、centralized audit 与 corpus isolation 属于第二阶段 Proxy Hub。
