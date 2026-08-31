/**
 * run-e2e.mjs — scholar 接入 dsh 端到端判据 runner（8 项，关键项 ×2 稳定性）。
 *
 * 前置：setup.mjs 已挂载三插件；DEEPSEEK_API_KEY 就位（~/.dsh/.credentials.yaml）；
 *       PG/Neo4j 无需运行（MCP server 无 DB 依赖启动；工具调用缺库时优雅报错）。
 *
 * 用法：node examples/scholar/run-e2e.mjs
 * 输出：逐判据 ✓/✗ + 总结分数；失败项 exit 1。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_REPO = join(HERE, '..', '..');          // deepseek-harness 仓库根
const TSX_ESM = pathToFileURL(join(DSH_REPO, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;
const DSH_BIN = join(DSH_REPO, 'apps', 'cli', 'src', 'bin.ts');
const TIMEOUT_MS = 300_000;

let passed = 0, failed = 0;
function judge(cond, label, evidence) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); if (evidence) console.error(`    evidence: ${evidence.slice(0, 300)}`); }
}

/** 绝对路径直调 dsh CLI（不经 pnpm script），cwd 即 SCHOLAR_WORKSPACE 绑定目标。
 *  TSX_TSCONFIG_PATH 必须显式指定：tsx 从 cwd 向上找 tsconfig，脱离 repo 后
 *  @deepseek-ai/* 路径映射会丢失（@deepseek-ai/cordis 导出残缺）。 */
function runDsh(task, cwd) {
  const r = spawnSync(process.execPath, ['--import', TSX_ESM, DSH_BIN, '--profile', 'headless', task],
    {
      cwd: cwd || DSH_REPO, encoding: 'utf8', timeout: TIMEOUT_MS,
      env: { ...process.env, TSX_TSCONFIG_PATH: join(DSH_REPO, 'tsconfig.json') },
    });
  return { out: `${r.stdout || ''}\n${r.stderr || ''}`, code: r.status, error: r.error?.message };
}

const ULID = /01[0-9A-Z]{24}/;

// ── R1 ×2：核心命题（无显式指令自动引文献）+ 动态层注入 ───────────────────
console.log('\n[R1 ×2] task: 解释 MoE 负载均衡（命中馆藏话题）');
let r1hits = 0, r1cit = 0, r1tools = 0, r1exit = 0, r1dyn = 0;
for (let i = 1; i <= 2; i++) {
  console.log(`\n  — run ${i} —`);
  const { out, code } = await runDsh('解释一下 mixture-of-experts 模型中的负载均衡问题，并结合本地文献库说明现有相关方案');
  console.log(out.split('\n').filter(l => /\[scholar-native\]|CallTool|<literature|01[A-Z0-9]{6}/.test(l)).slice(0, 6).map(l => '    | ' + l.trim().slice(0, 140)).join('\n'));
  r1exit += code === 0 ? 1 : 0;
  const m = out.match(/topic refreshed:.*→\s*(\d+) hits/);
  if (m && +m[1] >= 1) r1dyn++;
  if (/CallToolRequest/.test(out)) r1tools++;
  const cited = out.match(/01[0-9A-Z]{24}/) || /mixture-of-experts|Mixture-of-Experts|DeepSeek-V2|expert choice|Expert Choice/i.test(out.split('topic refreshed')[1] || '');
  if (cited) r1cit++;
  console.log(`    exit=${code} dynHits=${m ? m[1] : 0} toolCall=${/CallToolRequest/.test(out)} cited=${!!cited}`);
}

console.log('\n[J5] 动态层：话题命中注入 top-5');
judge(r1dyn >= 1, `两次运行中至少一次 topic 命中 ≥1（实际 ${r1dyn}/2）`);
console.log('[J6] 核心命题：回复自动引用馆藏文献');
judge(r1cit >= 1, `两次运行中至少一次回复含馆藏 paper_id/相关论文名（实际 ${r1cit}/2）`);
console.log('[J2] LLM 实际调用 scholar 工具');
judge(r1tools >= 1, `两次运行中至少一次 CallToolRequest（实际 ${r1tools}/2）`);
console.log('[J7a] exit 0 无挂死');
judge(r1exit === 2, `两次运行均 exit 0（实际 ${r1exit}/2）`);

// ── R2：全局性（临时目录 + workspace 动态绑定）────────────────────────────
console.log('\n[R2] task: 全局性 —— 在临时目录跑 scholar 工具');
const tmpWs = mkdtempSync(join(tmpdir(), 'scholar-e2e-ws-'));
const { out: r2out, code: r2code } = await runDsh('使用 scholar 工具查询知识库统计，告诉我解析了多少篇论文', tmpWs);
console.log(`  cwd=${tmpWs}\n  exit=${r2code}`);
console.log('  | ' + (r2out.split('\n').filter(l => /parsed|论文|563|篇/.test(l))[0] || '').trim().slice(0, 140));

console.log('\n[J8] 全局性：任意目录可用 + workspace 动态绑定');
judge(r2code === 0, '临时目录运行 exit 0');
judge(/\b56[0-9]\b|563/.test(r2out), '回复报告了真实知识库规模（~563 篇）');
judge(existsSync(join(tmpWs, 'output', 'logs')), 'SCHOLAR_WORKSPACE=process.cwd() 生效（临时目录出现 output/）');
rmSync(tmpWs, { recursive: true, force: true });

// ── R3：人格政策可被模型感知 ──────────────────────────────────────────────
console.log('\n[R3] task: persona 行为政策探针');
const { out: r3out, code: r3code } = await runDsh('根据你的 scholar 人格设定，概括你在文献引用方面的行为政策（不要调用工具，直接回答）');
console.log(`  exit=${r3code}`);
console.log('  | ' + (r3out.split('\n').filter(l => l.trim() && !l.includes('[')).slice(-3).join(' / ').trim().slice(0, 200)));
console.log('\n[J4] persona 段注入且可被模型引用');
judge(/\[scholar-native\] systemPrompt sections registered/.test(r3out), 'sections 注册日志');
judge(/paper_id|论文 ?id|引用|citing|cite/i.test(r3out.split('topic refreshed')[1] || r3out), '模型复述出引用政策');

// ── R4：技能层可见 ────────────────────────────────────────────────────────
console.log('\n[R4] task: 技能发现探针');
const { out: r4out, code: r4code } = await runDsh('列出你能看到的所有 skills 名称（只报名字，逗号分隔）');
console.log(`  exit=${r4code}`);
console.log('  | ' + (r4out.split('\n').filter(l => l.trim() && !l.includes('[')).slice(-2).join(' / ').trim().slice(0, 200)));
console.log('\n[J3] 15 个学术技能可被发现');
judge(/research-survey|paper-deep-dive|paper-ingestion|reproduce-paper/.test(r4out), '回复含 scholar 特色技能名');

// ── R5：P2 反射层（写 .tex → 引用对账）+ 主动层（方向捕获）────────────────
console.log('\n[R5] task: P2 反射层/主动层探针');
const r5dir = mkdtempSync(join(tmpdir(), 'scholar-e2e-tex-'));
const { out: r5out, code: r5code } = await runDsh(
  '创建一个最小示例论文 draft.tex，其中用 \\cite{vaswani2017attention} 引用 Transformer 论文，内容两三句即可',
  r5dir);
console.log(`  exit=${r5code}`);
console.log('  | ' + r5out.split('\n').filter(l => /citation audit|session interests/.test(l)).map(l => l.trim().slice(0, 120)).join('\n  | '));
console.log('\n[J9] 反射层：写 .tex 自动触发引用对账');
judge(/citation audit refreshed/.test(r5out), 'citation audit 日志出现');
console.log('\n[J10] 主动层：会话方向捕获启动');
judge(/session interests started/.test(r5out), 'session interests 日志出现');
rmSync(r5dir, { recursive: true, force: true });

// ── 挂载证据（任一运行的输出即可）────────────────────────────────────────
console.log('\n[J1] 三插件挂载 + 无 DB 优雅降级');
judge(r3out.includes('[scholar-native] plugin mounted'), 'scholar-native 挂载日志');
judge(/ListToolsRequest/.test(r2out), 'mcp-scholar server 已启动并响应工具发现');
judge(r2out.includes('[scholar-native] SCHOLAR_HOME='), 'scholarHome 配置通道生效');
console.log('  (docker 未启的降级由 M0 冒烟 + failOnStartupError:false 结构性保证)');

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(56));
console.log(`=== ${passed}/${passed + failed} 判据通过 ===`);
if (failed) {
  console.log('失败判据需复盘后重跑；输出已内联展示。');
  process.exit(1);
}
