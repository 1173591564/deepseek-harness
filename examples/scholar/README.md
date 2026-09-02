# scholar — Scholar Studio 原生接入 dsh（学术工作者实验 · P1）

把 [Scholar Studio](https://github.com/1173591564/academic-based-qoder)（581 篇 AI 论文知识库 + 16 MCP 工具（阅读阶梯）+ 15 学术技能）通过**原生 Cordis 插件**接入 deepseek-harness，让 dsh 从"显式调用 scholar 工具的 coding agent"变成**带文献环境感知的学术工作者**——不靠 skill 触发，谈技术时自动"想起"馆藏论文。

与 `examples/headless-dashboard`（memory 实验）同构：**零 dsh 源码改动**，全部内容在本目录，`setup.mjs uninstall` 即彻底移除。

## 架构：三层挂载 + 学术反射栈（P1 范围）

```
~/.dsh/profiles/headless/cordis.patch.yml  >>> scholar <<< 段（insert 语法）
  ├─ id: mcp-scholar       @deepseek-ai/dsh-mcp-client   ← 工具层（16 工具）
  │    stdio → python -m scholar_mcp
  │    env: SCHOLAR_HOME（知识库根，静态）
  │         SCHOLAR_WORKSPACE: !!js process.cwd()（★每次启动绑定当前目录）
  │    failOnStartupError: false（docker 未起时优雅降级）
  ├─ id: scholar-skills    @deepseek-ai/dsh-skill-filesystem ← 技能层（15 skills）
  │    隔离实例：providerName: scholar · includeDefaultRoots: false
  │    customSkillDirs: [<SCHOLAR_HOME>/.scholar/skills]
  └─ id: scholar-native    本目录 scholar-native.mjs ← 人格层（唯一新写插件）
       config.scholarHome ← Cordis config 通道（patch env 只进 MCP 子进程，见踩坑 #1）

scholar-native.mjs 内部（学术反射栈 P1）：
  静态层  systemPrompt.section("scholar-persona", order 110)
          人格 + 行为政策（文献先查/引用必真/先查已有工作/诚实边界）
          内容源：<SCHOLAR_HOME>/.scholar/rules/{identity,academic}.md + KB 规模快照
  动态层  systemPrompt.section("scholar-literature-context", order 150)
          agent/pre-step（waterfall，阻塞 LLM 请求）→ 最新用户消息话题提取
          → 话题漂移时纯词法匹配本地论文库（563 篇元数据，索引冷构建 187ms，
            缓存命中 3ms，检索 1ms，零外部依赖）
          → 注入 <literature_context> top-5（id+title+year+venue+摘要，≤2200 chars）
  退出开关  SCHOLAR_OFF=1 → 人格与注入全部退化为空段
```

**全局使用设计**：SCHOLAR_HOME（知识库/技能/规则）全局唯一；SCHOLAR_WORKSPACE 每次
`process.cwd()` 动态解析——在任意目录启动 dsh，该目录即工作区，产出（notes/drafts）
跟随当前项目，知识库永远共享。无需逐项目 init-workspace。

## 复现步骤

### 前置

1. Scholar Studio 可被 `python -m scholar_mcp` 导入：
   - **global 模式**（团队部署推荐）：`pip install git+https://github.com/1173591564/academic-based-qoder.git@v0.1.2`
     然后 `scholar init` 初始化 `~/.scholar-studio/`（KB 数据需另行迁移）
   - **dev 模式**（本机开发）：editable 安装 + `--mode dev --scholar-home <源码树>`
2. dsh 在 `experiment/dashboard-provider` 分支（或任何含 examples/ 的环境）
3. `~/.dsh/.credentials.yaml` 有 `DEEPSEEK_API_KEY`（settings.yaml 直连 DeepSeek API，
   沿用 memory 实验配置，本实验不改动 settings）

### 一键安装 / 验证 / 卸载

```bash
# 分项自测（无需 LLM/Gateway/数据库）
node examples/scholar/self-test.mjs          # → 33/33 passed

# 挂载三插件（global 模式）
node examples/scholar/setup.mjs
# 或 dev 模式（本机实验形态）
node examples/scholar/setup.mjs --mode dev --scholar-home "C:/Users/11735/Desktop/论文/Artificial Intelligence"

# 端到端判据（8 项 13 断言，含 ×2 稳定性；消耗 ~7 次 DeepSeek API 调用）
node examples/scholar/run-e2e.mjs            # → 13/13 判据通过

# 卸载（只删自己的 >>> scholar <<< 段，不碰其它实验段）
node examples/scholar/setup.mjs uninstall
```

### 手动体验

```bash
dsh --profile headless "解释一下 mixture-of-experts 模型中的负载均衡问题"
# 预期：无需任何显式指令，回复自动引用馆藏论文（paper_id + 标题 + 年份）
# 日志可见：[scholar-native] topic refreshed: mixture-of-experts,... → N hits
```

## 判据结果（2026-08-31，×3 全量复跑全绿）

| # | 判据 | 结果 |
|---|------|------|
| J1 | 三插件挂载 + scholarHome 配置通道生效 | ✓ 3/3 runs |
| J2 | LLM 实际调用 `mcp__scholar__*` 工具（CallToolRequest） | ✓ 2/2 ×3 |
| J3 | 15 个学术技能可被发现（回复含 research-survey 等特色名） | ✓ 3/3 |
| J4 | persona 段注入且可被模型复述（引用政策） | ✓ 3/3 |
| J5 | 动态层：话题命中注入 top-5 | ✓ 2/2 ×3（4 hits） |
| J6 | **核心命题：无显式指令自动引文献**（回复含馆藏 ULID） | ✓ 2/2 ×3 |
| J7 | exit 0 无挂死 | ✓ 全部 15+ 次调用 |
| J8 | 全局性：临时目录跑 dsh，工具可用 + 563 篇可见 + workspace 动态绑定 | ✓ 2/2 |

实测摘录（run 1 原文）：

```
[scholar-native] topic refreshed: mixture-of-experts,解释,释一,一下,下模,模型,型中,中的 → 4 hits
1. **路由坍缩 (routing collapse)** …（[DeepSeekMoE](01KT6MTCSRX2078M7CK4FJSB8J, 2021)）…
   当某专家收到的 token 超过容量时,超出的 token 会被"丢弃"…
   ([Switch Transformers](01KT6MTMPZ6P9VAFK0WFJE15RA, 2022))。
```

## 踩坑实录（全部有源码级根因）

| # | 症状 | 根因 | 解法 |
|---|------|------|------|
| 1 | 插件读到默认 `~/.scholar-studio`（0 篇），patch 里的 SCHOLAR_HOME 不生效 | mcp-client `config.env` 只注入 **MCP 子进程**；插件本体跑在 dsh 进程内，读不到 | 插件支持 `apply(ctx, config)` 的 `config.scholarHome`（Cordis config 通道），setup 写入 |
| 2 | 首个 LLM 请求拿不到首轮检索结果 | `agent.ts:230`：`systemPrompt.assemble` 发生在 pre-step waterfall **之前** | 接受时序事实：注入自下一 step 生效；首请求靠 persona 政策驱动模型主动调 `mcp__scholar__search`（互补设计） |
| 3 | 工具结果 step 会清空已注入的 litBlock | 工具结果以 user-role + ToolResultBlock 送达，`extractUserText` 返回空 → 旧逻辑把 hash/litBlock 重置 | 无用户文本的 step **保留现状**（只在新话题时刷新） |
| 4 | 检索永远 0 hits | `search` 内层 `s` 局部变量未累加到 `score`（笔误） | self-test 抓到，直接累加 |
| 5 | 脱离 repo 目录跑 dsh 报 `@deepseek-ai/cordis` 导出残缺 | tsx 从 **cwd 向上找 tsconfig**，临时目录下 `@deepseek-ai/*` 路径映射丢失 | 全局调用显式传 `TSX_TSCONFIG_PATH=<repo>/tsconfig.json` |
| 6 | pip 全局安装后 `SCHOLAR_HOME` 解析到 site-packages | scholar 侧 `config.py` 模式检测只认 frozen/源码树两种 | v0.1.2 修复：源码树探测（`.scholar` + `scholar_mcp` 共存），pip-global 归入 `~/.scholar-studio`（连带修复 `init_scholar_home` 的 `shutil` NameError 与重复定义） |
| 7 | patch 里 `env:` 块缩进错误导致 YAML 结构错乱 | setup 模板字符串缩进手工拼错 | 模板缩进对齐 config 子层级（8/10 空格） |
| 8 | 索引缓存永不命中（每次重建） | 缓存条数(3) vs 源文件数(4) 比较——损坏文件被跳过导致差 1 | 缓存存 `sourceCount`（构建时源文件数），与当前文件数比较 |

## 已知边界与后续

- **v0.2.0 上下文经济重构**（scholar 侧）：
  - MCP 模型面 **55 → 16 工具**：阅读阶梯 search/vec_search（找论文）→ info（摘要+节目录）→
    section（按节读取，~1.6K 字符/节）；passages（片段定位）；横向 cite_network/lineage/graph_query/graph_stats；
    read_parsed_paper 默认摘要卡、`full=true` 逃生门（200KB 截断）
  - **Neo4j 退役**：引用/概念图改为内存图（scholar/graph_mem.py，networkx），
    从 parsed JSON 秒级重建 + graph.json 缓存；`scholar sync` 一条命令刷新全部派生索引
  - **PG/pgvector 保留**：新表 `paper_vectors`（563 篇 `[标题+摘要]` 各一向量，L1 语义检索）；
    chunks（54k）保留为片段定位层，BM25 修复为全量覆盖
  - 维护类/重复皮工具（parse/rag-index/graph-build/stats/scan/quality/... 共 39 个）撤出 MCP，保留 CLI
- **P2 已实现（v0.1.4）**：
  - 反射层 `tools/post-execute`——write/str_replace_editor 写 `.tex/.bib` 后自动提取
    `\cite/\citep/\citet/\bibitem` 键，与库内元数据词法对账，注入 `<citation_audit>`（order 160）；
  - 主动层 `session/event`——捕获 user/message 话题词累积会话方向线程，
    注入 `<scholar_session_interests>`（order 120）；首次捕获打 `session interests started` 日志；
  - rules 分发——`scholar init-dsh` 将包内 `templates/dsh/rules/` 落到知识库
    （copy-if-missing，不覆盖用户自定义）
- **P3 习惯层/记忆层**：dsh jobs 定时 kb-update/auto-notes；腾讯 Agent Memory session-init
  串入 pre-step（memory-native 已验证），研究方向加权检索
- **词法检索边界**：英文术语为主信号；中文话题依赖 CJK 二元组 + 查询中的英文术语，
  双语 glossary 留后续；`moe` 这类缩写靠 tags 字段命中
- **R1 发布**：wheel 捆绑 dsh 插件模板 + `scholar init-dsh`；服务器 pypiserver + KB 集中化
- 多 agent 并发场景下 literature-context 段取"最近活跃 agent"（headless 单 agent 精确），
  按 agent scope 注册留待按需演进

## 文件清单

```
examples/scholar/
  scholar-native.mjs   核心 Cordis 插件：persona + 文献环境注入（零依赖，纯 node 内置）
  setup.mjs            幂等挂载/卸载/检查（patch 段管理 + preflight 校验）
  self-test.mjs        插件级自测 33 项（无需 dsh/LLM/数据库）
  run-e2e.mjs          端到端判据 runner（8 项 13 断言）
  README.md            本文档
```
