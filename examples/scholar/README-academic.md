# Scholar DSH 学术专用版（v0.1.4）

deepseek-harness（dsh）学术发行版： Scholar Studio 知识库（581 篇论文 / 16k sections / 43k 引用网络）以原生 Cordis 插件方式挂进 dsh，模型无需显式指令即可感知馆藏并自动引用。

## 内容物

- `scholar_studio-0.1.4-py3-none-any.whl` — 全部后端 + dsh 插件模板 + 学术人格 rules
- `install.ps1` / `install.sh` — 一键安装（wheel 直装 + `scholar init-dsh`）
- 本 README

## 前置要求

- Python ≥ 3.10（PATH 中的 `python` / `python3`）
- dsh 本体：克隆本仓库 `experiment/dashboard-provider` 分支并按上游 README 以源码方式运行（Node/Bun 环境）
- DeepSeek API Key

## 安装（3 步）

```bash
# 1) dsh 本体（源码运行）
git clone https://github.com/1173591564/deepseek-harness -b experiment/dashboard-provider
cd deepseek-harness && pnpm install   # 运行方式见上游 README

# 2) 解压本 Release 的 bundle，安装 scholar 后端 + 挂载
#    Windows: .\install.ps1    Linux/macOS: bash install.sh

# 3) 用 init-dsh 输出的 profile 启动 dsh
dsh --profile headless
```

## 连接团队服务器索引（无本地知识库时）

安装后默认连 `localhost`（端口 5433/7687）。首次运行 `scholar init` 会引导本地建库；
若直接使用团队服务器上的共享索引，配置环境变量（或 `<home>/.scholar/.env`）：

```
SCHOLAR_PG_HOST=<服务器IP>   SCHOLAR_PG_PORT=5432   SCHOLAR_PG_NAME=scholar
SCHOLAR_PG_USER=scholar      SCHOLAR_PG_PASS=<向管理员获取>
SCHOLAR_NEO4J_URI=bolt://<服务器IP>:7687
SCHOLAR_NEO4J_USER=neo4j     SCHOLAR_NEO4J_PASS=<向管理员获取>
```

服务器端口默认仅对 SSH 隧道开放，访问权限向管理员申请。

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
scholar init-dsh --uninstall   # 移除 cordis.patch.yml 中 scholar 段
python -m pip uninstall scholar-studio
```
