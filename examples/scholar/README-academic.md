# Scholar DSH 学术专用版（v0.2.1）

deepseek-harness（dsh）学术发行版： Scholar Studio 知识库（581 篇论文 / 16k sections / 43k 引用网络）以原生 Cordis 插件方式挂进 dsh，模型无需显式指令即可感知馆藏并自动引用。

## 内容物

- `scholar_studio-0.2.1-py3-none-any.whl` — 全部后端 + dsh 插件模板 + 学术人格 rules
- `install.ps1` / `install.sh` — 一键安装（wheel 直装 + `scholar init-dsh`）
- 本 README

## 前置要求

- Python ≥ 3.10（PATH 中的 `python` / `python3`）
- dsh 本体：克隆本仓库 `experiment/dashboard-provider` 分支并按上游 README 以源码方式运行（Node/Bun 环境）
- DeepSeek API Key

## 安装（3 步，服务器模式——推荐，论文数据零分发）

```bash
# 1) dsh 本体（源码运行）
git clone https://github.com/1173591564/deepseek-harness -b experiment/dashboard-provider
cd deepseek-harness && pnpm install   # 运行方式见上游 README

# 2) 解压本 Release 的 bundle，安装 scholar 插件层（人格/技能/规则，无需本地数据）
#    Windows: .\install.ps1    Linux/macOS: bash install.sh
#    安装脚本会执行：scholar init-dsh --remote http://127.0.0.1:9845/mcp

# 3) 开一条 SSH 隧道（唯一依赖），启动
ssh -N -L 9845:127.0.0.1:9845 <服务器别名> &
dsh --profile headless          # CLI one-shot（headless patch 通道）

#    Web UI：dsh web 启动后，设置 → Agent 预设 → 自定义 →「学术模式」
```

数据与索引（563 篇 parsed、pgvector、引用图、embedding）全部在服务器的
`scholar-mcp` 服务上（systemd），客户端只发 MCP 调用——无需 PG 凭据、
无需 embedding key、无需任何论文文件。

## 本地模式（自带知识库，可选）

不连服务器也可以完全本地化：`scholar init` 建库 + `scholar sync` 刷索引 +
`scholar init-dsh`（不带 --remote），MCP 以 stdio 跑在本机，数据自持。

## 验证

- `scholar search transformer` — 能连上知识库（本地或服务器索引）
- dsh 冒烟：不带任何显式指令问“推荐一篇注意力机制相关的论文”，回复应自动引用馆藏 ULID
- 挂载日志：`[scholar-native] indexed N papers` / `mcp-scholar server started`

## 功能层

| 层 | 机制 |
|---|---|
| P1 静态 | 学术人格 + 引用政策 + 15 技能目录（systemPrompt 注入） |
| P1 动态 | pre-step 词法检索，每步 top-5 命中注入 `<scholar_context>` |
| P2 反射 | 写 .tex/.bib 自动 `\cite` 键对账 `<citation_audit>`（observation-only） |
| P2 主动 | 会话话题捕获 `<scholar_session_interests>`，跨轮方向记忆 |

## 卸载

```bash
scholar init-dsh --uninstall   # 移除 headless patch 段 + academic 预设目录
python -m pip uninstall scholar-studio
```
