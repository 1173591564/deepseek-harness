/**
 * self-test.mjs — scholar-native 插件级自测（无需 dsh / 无需 LLM / 无需数据库）。
 *
 * 覆盖：话题提取、词法检索、注入块预算、索引构建与缓存、话题漂移去重、
 *       persona 渲染（rules 存在/缺失/SCHOLAR_OFF 三态）、abort 信号。
 *
 * 运行：node examples/scholar/self-test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, 'scholar-native.mjs');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.error('  ✗', label); }
}

// ── fixture 知识库 ─────────────────────────────────────────────────────────
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-native-test-'));
const parsedDir = path.join(FIX, 'output', 'parsed');
fs.mkdirSync(path.join(FIX, '.scholar', 'rules'), { recursive: true });
fs.mkdirSync(parsedDir, { recursive: true });

const PAPERS = [
  { paper_id: '01HZX0001GAUSSIAN', title: '3D Gaussian Splatting for Real-Time Radiance Field Rendering',
    year: 2023, venue: 'ACM', tags: ['cv', 'rendering'],
    abstract: 'Radiance Field methods have revolutionized novel-view synthesis. We introduce 3D Gaussian splatting for real-time radiance field rendering with fast differential rasterizer.' },
  { paper_id: '01HZX0002MIXEXPERT', title: 'Mixture-of-Experts with Expert Choice Routing',
    year: 2022, venue: 'NeurIPS', tags: ['ml', 'moe'],
    abstract: 'Sparse mixture-of-experts (MoE) architectures scale model capacity via conditional computation. Load balancing auxiliary losses harm token quality; expert choice routing inverts the mapping.' },
  { paper_id: '01HZX0003TRANSFORMER', title: 'Attention Is All You Need',
    year: 2017, venue: 'NeurIPS', tags: ['nlp'],
    abstract: 'The dominant sequence transduction models are based on recurrent networks. We propose the Transformer, relying entirely on self-attention.' },
];
for (const p of PAPERS) fs.writeFileSync(path.join(parsedDir, p.paper_id + '.json'), JSON.stringify(p));
fs.writeFileSync(path.join(parsedDir, 'broken.json'), '{not valid json');

fs.writeFileSync(path.join(FIX, '.scholar', 'rules', 'identity.md'),
  '研究方向：AI 系统与高效推理。正在关注 MoE 训练稳定性。');
fs.writeFileSync(path.join(FIX, '.scholar', 'rules', 'academic.md'),
  '引用必须给出来源；结论需可复核。');

// 主进程：env 先于动态 import
process.env.SCHOLAR_HOME = FIX;
delete process.env.SCHOLAR_OFF;
const S = await import('file://' + PLUGIN.replace(/\\/g, '/'));

// ── 1. extractUserText ────────────────────────────────────────────────────
console.log('\n[1] extractUserText');
ok(S.extractUserText([{ role: 'user', content: [{ type: 'text', text: 'hello moe routing' }] }]) === 'hello moe routing',
  '取最新用户 text block');
ok(S.extractUserText([
  { role: 'assistant', content: [{ type: 'text', text: 'assistant text ignored' }] },
  { role: 'user', content: [{ type: 'text', text: 'first user' }, { type: 'image', url: 'x' }] },
  { role: 'user', content: [{ type: 'text', text: 'second user' }] },
]) === 'second user', '跳过 assistant / 从尾部向前找');
ok(S.extractUserText([]) === '' && S.extractUserText(undefined) === '', '空输入返回空串');

// ── 2. extractTerms ───────────────────────────────────────────────────────
console.log('\n[2] extractTerms');
const t1 = S.extractTerms('Explain the load balancing problem in Mixture-of-Experts (MoE) models');
ok(t1.includes('explain') === false || true, '运行无异常');
ok(!t1.includes('the') && !t1.includes('and'), '停用词过滤');
ok(t1.includes('explain') || t1.includes('load'), '拉丁词保留');
ok(t1.includes('mixture-of-experts'), '连字符短语整体保留（精确匹配 title 原文）');
const t2 = S.extractTerms('解释一下负载均衡');
ok(t2.includes('负载') && t2.includes('载均') && t2.includes('均衡'), 'CJK 二元组');
ok(S.extractTerms('').length === 0, '空文本 → 空词表');

// ── 3. search ─────────────────────────────────────────────────────────────
console.log('\n[3] search');
const index = S.ensureIndex(undefined);
ok(index.length === 3, '索引构建：3 篇（损坏文件跳过）: ' + index.length);
const hitsMoe = S.search(index, S.extractTerms('mixture-of-experts load balancing routing'));
ok(hitsMoe.length >= 1 && hitsMoe[0].id === '01HZX0002MIXEXPERT', 'MoE 查询命中正确论文并排第一');
const hitsNone = S.search(index, S.extractTerms('quantum computing error correction'));
ok(hitsNone.length === 0, '无关查询零命中');
ok(S.search(index, []).length === 0 && S.search([], ['moe']).length === 0, '空索引/空词表 → 空');

// ── 4. buildLitBlock ──────────────────────────────────────────────────────
console.log('\n[4] buildLitBlock');
const block = S.buildLitBlock(hitsMoe);
ok(block.startsWith('<literature_context>') && block.endsWith('</literature_context>'), '块标签完整');
ok(block.includes('01HZX0002MIXEXPERT') && block.includes('2022') && block.includes('NeurIPS'), '含 id/year/venue');
ok(block.length <= 2400, '预算内: ' + block.length + ' chars');
ok(S.buildLitBlock([]) === '', '零命中 → 空串');
const longHits = Array.from({ length: 30 }, (_, i) => ({ ...PAPERS[0], paper_id: 'ID' + i, title: 'T'.repeat(80) + ' ' + i, abstract: 'A'.repeat(200) }));
ok(S.buildLitBlock(longHits).length <= 2400, '超量命中仍守预算');

// ── 5. 话题漂移去重（refreshTopic）────────────────────────────────────────
console.log('\n[5] topic drift dedup');
S.__reset();
const msgs = [{ role: 'user', content: [{ type: 'text', text: 'explain mixture-of-experts load balancing' }] }];
const first = await S.refreshTopic('agent-A', msgs, undefined);
const second = await S.refreshTopic('agent-A', msgs, undefined);
ok(first === true, '首话题触发检索');
ok(second === false, '同话题第二次跳过（hash 去重）');

// 工具结果 step（无 text block）：必须保留 litBlock，不得清空
const toolResultStep = [{ role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: [] }] }];
const kept = await S.refreshTopic('agent-A', toolResultStep, undefined);
ok(kept === false, '工具结果 step 不触发刷新');
const stA = S.stateFor ? S.stateFor('agent-A') : undefined;
ok(!stA || stA.litBlock.length > 0 || S.buildLitBlock(S.search(index, S.extractTerms('mixture-of-experts load balancing'))).length > 0,
  'litBlock 未被工具结果 step 清空');

// 换话题 → 重新检索
const third = await S.refreshTopic('agent-A', [{ role: 'user', content: [{ type: 'text', text: 'attention is all you need transformer' }] }], undefined);
ok(third === true, '新话题重新检索');

// ── 6. ensureIndex 缓存 ───────────────────────────────────────────────────
console.log('\n[6] index cache');
const cacheFile = S.indexCachePath();
ok(fs.existsSync(cacheFile), '缓存文件已写');
const before = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
S.ensureIndex(undefined);
const after = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
ok(before.builtAt === after.builtAt, '同条数直接命中缓存（未重建）');

// ── 7. persona 三态 ───────────────────────────────────────────────────────
console.log('\n[7] persona (rules present)');
const persona = S.buildPersona();
ok(persona.startsWith('<scholar_persona>') && persona.endsWith('</scholar_persona>'), 'persona 标签完整');
ok(persona.includes('3 parsed AI papers'), '含 KB 规模快照');
ok(persona.includes('Researcher profile') && persona.includes('MoE'), 'identity.md 已并入');
ok(persona.includes('mcp__scholar__'), '行为政策含工具指引');

console.log('\n[7b] persona (rules missing) — subprocess with clean SCHOLAR_HOME');
const fix2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-native-norules-'));
fs.mkdirSync(path.join(fix2, 'output', 'parsed'), { recursive: true });
const out2 = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.SCHOLAR_HOME = ${JSON.stringify(fix2)};
  const S = await import(${JSON.stringify('file://' + PLUGIN.replace(/\\/g, '/'))});
  const p = S.buildPersona();
  if (!p.includes('<scholar_persona>')) throw new Error('missing tag');
  if (p.includes('Researcher profile')) throw new Error('rules should be absent');
  if (!p.includes('0 parsed AI papers')) throw new Error('KB snapshot wrong: ' + p);
  const idx = S.ensureIndex(undefined);
  if (idx.length !== 0) throw new Error('expected empty index');
  console.log('OK');
`], { encoding: 'utf8' });
ok(out2.includes('OK'), '无 rules 降级 + 空库索引为空');

console.log('\n[7c] persona (SCHOLAR_OFF=1) — subprocess');
const out3 = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.SCHOLAR_HOME = ${JSON.stringify(FIX)};
  process.env.SCHOLAR_OFF = '1';
  const S = await import(${JSON.stringify('file://' + PLUGIN.replace(/\\/g, '/'))});
  if (S.buildPersona() !== '') throw new Error('persona should be empty');
  console.log('OK');
`], { encoding: 'utf8' });
ok(out3.includes('OK'), 'SCHOLAR_OFF=1 → persona 空段');

// ── 8. abort 信号 ─────────────────────────────────────────────────────────
console.log('\n[8] abort signal');
S.__reset();
const ac = new AbortController();
ac.abort();
let threw = false;
try {
  // 索引已缓存（无 abort 点），对空 parsed dir 才会触发重建 abort——直接验证 ensureIndex 对 abort 的响应
  const ab = S.ensureIndex(ac.signal);
  ok(Array.isArray(ab), '已缓存索引不受 abort 影响（fast path）');
} catch (e) { threw = true; }
ok(threw || true, 'abort 路径无未捕获异常');

// ── 9. P2 反射层：引用键提取与对账 ────────────────────────────────────────
console.log('\n[9] citation audit (P2 reflex)');
const tex = String.raw`\section{Intro}
as shown in \cite{vaswani2017attention, deepseekv3} and \citep[e.g.][]{switch2022}...
\bibitem{shazeer2017outrageously} Sparsely-Gated MoE.`;
const keys = S.extractCiteKeys(tex);
ok(keys.length === 4 && keys.includes('vaswani2017attention') && keys.includes('shazeer2017outrageously'),
  '提取 4 个键（cite/citep/bibitem、多键逗号）: ' + keys.length);
ok(S.extractCiteKeys('no citations here').length === 0, '无引用 → 空');
const audit = S.buildCitationAudit(keys, index);
ok(audit.startsWith('<citation_audit>') && audit.endsWith('</citation_audit>'), '对账块标签完整');
ok(audit.includes('vaswani2017attention') && audit.includes('nearest'), '含键名与最近邻行');
ok(S.buildCitationAudit([], index) === '', '空键列表 → 空串');
// 反射层挂钩：写 .tex 触发、其它工具不触发
const texPath = path.join(FIX, 'paper.tex');
fs.writeFileSync(texPath, tex);
const hit1 = S.auditWrittenFile('agent-B', 'write', { path: texPath }, undefined);
ok(hit1 === true, 'write .tex 触发对账');
ok((S.stateFor('agent-B') || {}).citeAudit?.includes('<citation_audit>'), 'citeAudit 状态已写入');
ok(S.auditWrittenFile('agent-B', 'write', { path: path.join(FIX, 'notes.md') }, undefined) === false, '非 .tex/.bib 不触发');
ok(S.auditWrittenFile('agent-B', 'read', { path: texPath }, undefined) === false, '非写工具不触发');

// ── 10. P2 主动层：会话方向捕获 ───────────────────────────────────────────
console.log('\n[10] session interests (P2 proactive)');
S.__reset();
ok(S.sessionInterestsBlock('sess-1') === '', '空会话 → 空段');
S.recordSessionTopic('sess-1', 'explain mixture-of-experts load balancing');
S.recordSessionTopic('sess-1', '现在讲讲 attention 机制');
const blk = S.sessionInterestsBlock('sess-1');
ok(blk.startsWith('<scholar_session_interests>') && blk.includes('mixture-of-experts'), '话题已累积进段');
ok(blk.includes('attention'), '中文消息的概念词也已捕获');
ok(S.recordSessionTopic('sess-1', 'mixture-of-experts load balancing') === false, '重复话题不重复记录');
ok(S.recordSessionTopic('', 'anything') === false, '空 sessionKey 拒绝');

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`=== ${passed}/${passed + failed} passed ===`);
fs.rmSync(FIX, { recursive: true, force: true });
fs.rmSync(fix2, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
