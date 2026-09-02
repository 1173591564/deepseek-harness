/**
 * setup.mjs — 把 scholar 三层插件挂进 dsh headless profile（幂等、可回滚）。
 *
 * 挂载三个插件（patch 段 >>> scholar <<<，与其它实验段共存互不影响）：
 *   1. mcp-scholar      — dsh-mcp-client: stdio 挂 `python -m scholar_mcp`（16 工具）
 *                         SCHOLAR_HOME 静态绑定知识库；SCHOLAR_WORKSPACE 用 !!js process.cwd()
 *                         每次启动动态绑定当前目录（全局使用、随意挂工作目录的核心机制）
 *   2. scholar-skills   — 隔离 skill-filesystem 实例，customSkillDirs 指向 <SCHOLAR_HOME>/.scholar/skills
 *   3. scholar-native   — 人格 + 文献环境注入 package
 *
 * 用法：
 *   node examples/scholar/setup.mjs                     # 安装（默认 --mode global）
 *   node examples/scholar/setup.mjs check               # 前置校验 + 打印当前 patch 段
 *   node examples/scholar/setup.mjs uninstall           # 卸载（只删自己的段）
 *
 * 选项：
 *   --scholar-home <path>   知识库根（默认 $SCHOLAR_HOME 或 ~/.scholar-studio）
 *   --python <cmd>          MCP server 用的解释器（默认 $SCHOLAR_PYTHON 或 python）
 *   --mode global|dev       global：直接用全局安装的 scholar 包；
 *                           dev：额外注入 PYTHONPATH=<scholar-home>（editable 源码开发）
 *
 * 幂等：重复运行只刷新自己的段，不触碰其它段（如 experiment/dashboard-provider）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

// ── 参数解析 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv.find(a => !a.startsWith('--')) || 'install';
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const mode = opt('--mode') || 'global';
const pythonCmd = opt('--python') || process.env.SCHOLAR_PYTHON || 'python';
const scholarHome = normalize(opt('--scholar-home') || process.env.SCHOLAR_HOME || join(homedir(), '.scholar-studio'));
const PROFILE = opt('--profile') || 'headless';

if (PROFILE !== 'headless') {
  console.error(`[setup] profile "${PROFILE}" 未在本实验范围（仅 headless），退出`);
  process.exit(2);
}
const PROF_DIR = join(DSH_HOME, 'profiles', PROFILE);
const PATCH = join(PROF_DIR, 'cordis.patch.yml');
const MARKER = '# >>> scholar';
const END_MARKER = '# <<< scholar';

const y = p => String(p).replace(/\\/g, '/');
const SKILLS_DIR = y(join(scholarHome, '.scholar', 'skills'));

// ── patch 段 ───────────────────────────────────────────────────────────────
const mcpEnv = [`        env:`,
  `          SCHOLAR_HOME: "${y(scholarHome)}"`,
  `          SCHOLAR_WORKSPACE: !!js process.cwd()`];
if (mode === 'dev') mcpEnv.push(`          PYTHONPATH: "${y(scholarHome)}"`);

const PATCH_BLOCK = `${MARKER}
- insert:
    - id: mcp-scholar
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: scholar
        transport: stdio
        command: "${y(pythonCmd)}"
        args: ['-m', 'scholar_mcp']
${mcpEnv.join('\n')}
        failOnStartupError: true
    - id: scholar-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: scholar
        includeDefaultRoots: false
        customSkillDirs:
          - "${SKILLS_DIR}"
    - id: scholar-native
      name: '@deepseek-ai/dsh-scholar-native'
      config:
        scholarHome: "${y(scholarHome)}"
${END_MARKER}`;

// ── 前置校验 ───────────────────────────────────────────────────────────────
function preflight() {
  const problems = [];
  console.log(`[preflight] mode=${mode} python=${pythonCmd}`);
  console.log(`[preflight] SCHOLAR_HOME=${scholarHome}`);
  // 1. 解释器 + scholar 包可导入（global 模式下验证 pip 全局安装）
  try {
    const out = execFileSync(pythonCmd, ['-c',
      'import scholar_mcp, scholar.config as c; print(c.SCHOLAR_HOME)'],
      { encoding: 'utf8', timeout: 30000 });
    const resolved = out.trim().split(/\r?\n/).pop();
    console.log(`[preflight] [OK] scholar_mcp importable, resolved SCHOLAR_HOME=${resolved}`);
    if (mode === 'global' && normalize(resolved).toLowerCase() !== scholarHome.toLowerCase()) {
      console.log(`[preflight] [WARN] 解释器解析的 SCHOLAR_HOME(${resolved}) 与目标(${scholarHome})不同——patch env 将强制覆盖为后者`);
    }
  } catch (e) {
    problems.push(`python "${pythonCmd}" 无法 import scholar_mcp${mode === 'global' ? '（global 模式需先 pip install scholar-studio，或改用 --mode dev）' : ''}`);
  }
  // 2. 技能目录
  if (existsSync(SKILLS_DIR)) {
    const n = readdirSync(SKILLS_DIR).filter(d => !d.startsWith('.')).length;
    console.log(`[preflight] [OK] skills 目录: ${n} 个技能 @ ${SKILLS_DIR}`);
    if (n === 0) problems.push(`skills 目录为空: ${SKILLS_DIR}`);
  } else {
    problems.push(`skills 目录不存在: ${SKILLS_DIR}（先 scholar init 或确认 --scholar-home）`);
  }
  // 3. 知识库 parsed 目录（动态层索引的数据源；MCP 工具层不依赖它）
  const parsed = join(scholarHome, 'output', 'parsed');
  if (existsSync(parsed)) console.log(`[preflight] [OK] parsed 目录: ${readdirSync(parsed).length} 个文件`);
  else console.log(`[preflight] [WARN] parsed 目录不存在（动态层注入将为空，工具层不受影响）: ${parsed}`);
  return problems;
}

// ── 安装/卸载/检查 ─────────────────────────────────────────────────────────
function ensureProfileDir() {
  if (!existsSync(PROF_DIR)) mkdirSync(PROF_DIR, { recursive: true });
}

function install() {
  const problems = preflight();
  if (problems.length) {
    console.error('\n[setup] 前置校验未通过:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  ensureProfileDir();
  let prev = existsSync(PATCH) ? readFileSync(PATCH, 'utf8') : '';
  if (prev.includes(MARKER)) {
    const re = new RegExp(`${MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
    prev = prev.replace(re, PATCH_BLOCK.trim());
    writeFileSync(PATCH, prev, 'utf8');
    console.log(`[setup] refreshed scholar block @ ${PATCH}`);
  } else {
    const stripped = prev.replace(/^\s*\[\]\s*\n?/m, '').replace(/\s+$/, '');
    const next = stripped ? `${stripped}\n\n${PATCH_BLOCK}\n` : `${PATCH_BLOCK}\n`;
    writeFileSync(PATCH, next, 'utf8');
    console.log(`[setup] appended scholar block @ ${PATCH}`);
  }
  console.log(`\n[setup] done. 验证:`);
  console.log(`  dsh --profile headless "用 scholar 工具查一下知识库规模"`);
  console.log(`\n[setup] uninstall: node examples/scholar/setup.mjs uninstall`);
}

function uninstall() {
  if (!existsSync(PATCH)) { console.log(`[uninstall] patch 不存在，无事可做`); return; }
  let prev = readFileSync(PATCH, 'utf8');
  if (prev.includes(MARKER)) {
    const re = new RegExp(`\\n?${MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'm');
    prev = prev.replace(re, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    writeFileSync(PATCH, prev, 'utf8');
    console.log(`[uninstall] removed scholar block @ ${PATCH}`);
  } else {
    console.log(`[uninstall] 无 scholar 段，skip`);
  }
}

function check() {
  preflight();
  console.log(`\n[check] patch 文件: ${PATCH} ${existsSync(PATCH) ? '' : '(不存在)'}`);
  if (existsSync(PATCH)) {
    const prev = readFileSync(PATCH, 'utf8');
    const m = prev.match(new RegExp(`${MARKER}[\\s\\S]*?${END_MARKER}`, 'm'));
    console.log(m ? `--- scholar 段 ---\n${m[0]}\n---` : '[check] patch 中无 scholar 段（未安装）');
  }
}

if (cmd === 'uninstall') uninstall();
else if (cmd === 'check') check();
else install();
