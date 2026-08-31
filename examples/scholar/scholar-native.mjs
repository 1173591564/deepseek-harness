/**
 * scholar-native.mjs — dsh 原生"学术工作者"人格 + 文献环境感知插件（P1）。
 *
 * 静态层：systemPrompt.section("scholar-persona", order 110)
 *   注入学术人格 + 行为政策（何时主动检索、引用规范、先查已有工作），
 *   内容源自 SCHOLAR_HOME/.scholar/rules/{identity,academic}.md + KB 规模快照。
 *
 * 动态层：systemPrompt.section("scholar-literature-context", order 150)
 *   在 agent/pre-step（waterfall，阻塞 LLM 请求）对最新用户消息做话题提取，
 *   话题漂移时用纯词法匹配本地论文库（parsed JSON 元数据，零外部依赖），
 *   注入 top-5 相关论文（<literature_context>，预算 ≤2200 chars）。
 *
 * 反射层（P2）：tools/post-execute（observation-only，不改写结果）
 *   write / str_replace_editor 写 .tex/.bib 后，提取 \cite/\bibitem 键，
 *   与本地论文库词法对账，注入 <citation_audit>（order 160）供下一步自我修正。
 *
 * 主动层（P2）：session/event（只读）
 *   捕获 user/message 话题词，累积会话研究方向线程，
 *   注入 <scholar_session_interests>（order 120）保持长会话方向连贯。
 *
 * 时序事实（agent.ts:230）：systemPrompt.assemble 发生在 pre-step waterfall 之前，
 * 因此检索结果自下一 step 生效；首个请求依赖 persona 政策驱动模型主动调用
 * mcp__scholar__* 工具检索（两者互补）。
 *
 * env：
 *   SCHOLAR_HOME   — 知识库根目录（默认 ~/.scholar-studio；dsh patch 中由 setup.mjs 写入）
 *   SCHOLAR_OFF    — 置 1 时人格与注入全部退化为空段（单项目退出开关）
 *   SCHOLAR_NATIVE_DEBUG — 置 1 输出检索调试日志
 *
 * 挂载：cordis.patch.yml >>> scholar <<< 段 name: file:///.../scholar-native.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const name = 'scholar-native';
export const inject = ['systemPrompt'];

// SCHOLAR_HOME 解析优先级：apply(ctx, config).scholarHome > SCHOLAR_HOME env > ~/.scholar-studio
// patch 的 config.env 只作用于 mcp-client 子进程；插件本体在 dsh 进程内，
// 必须经由 Cordis config（setup.mjs 写入 config.scholarHome）拿到知识库根。
let SCHOLAR_HOME = process.env.SCHOLAR_HOME || path.join(os.homedir(), '.scholar-studio');
const SCHOLAR_OFF = process.env.SCHOLAR_OFF === '1';
const DEBUG = process.env.SCHOLAR_NATIVE_DEBUG === '1';

const PERSONA_ORDER = 110;   // system-prompt README 建议扩展区间 100–199
const SESSION_ORDER = 120;   // P2 主动层：会话研究方向线程
const LIT_ORDER = 150;       // 动态段排在静态段之后，漂移时只失效后缀前缀
const AUDIT_ORDER = 160;     // P2 反射层：引用对账段
const LIT_BUDGET_CHARS = 2200;   // ≈500 token
const RULE_MAX_CHARS = 900;      // 每条 rules 文件截断
const ABSTRACT_SNIPPET = 160;    // 注入行摘要截断
const INDEX_ABSTRACT = 400;      // 索引内摘要截断（匹配用）
const TOP_K = 5;
const MIN_SCORE = 5;
const MAX_CITE_KEYS = 15;        // 引用对账键上限
const MAX_SESSION_TOPICS = 30;   // 会话方向线程上限

// 每个 agent 的动态层状态：agentId → { topicHash, litBlock, citeAudit }
const agentState = new Map();
// 会话研究方向线程：sessionKey（session.id 或 agentId）→ terms[]
const sessionTopics = new Map();
// 最近活跃 agent（assemble 时刻 text() 读取——headless 单 agent 场景精确，多 agent 并发时近似）
let lastActiveAgent = null;

function log(...a) { console.log('[scholar-native]', ...a); }
function warn(...a) { console.warn('[scholar-native]', ...a); }
function dbg(...a) { if (DEBUG) console.log('[scholar-native:debug]', ...a); }

// ── 纯函数：话题提取 ────────────────────────────────────────────────────────

const STOPWORDS = new Set(('the a an and or of for to in on with by from as at is are was were be been this that these those ' +
  'it its their his her our your my not no do does did done can could should would will shall may might must ' +
  'how what why when where which who whom whose about into over under between within without during through ' +
  'using use used based paper papers method methods model models approach approaches result results new novel ' +
  'please explain describe tell say make give show help like also more most some any all both each other than then ' +
  'you i we they he she them us him me here there when what have has had having let get got').split(' '));

/** 从消息数组取最新一段用户可见文本（只认 text block，从尾部向前找）。 */
export function extractUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/** 中英混合分词：拉丁词（≥3 字符、去停用词）+ CJK 二元组。 */
export function extractTerms(text) {
  if (!text) return [];
  const terms = [];
  const latin = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [];
  for (const raw of latin) {
    const w = raw.replace(/[.+-]+$/, '');
    if (w.length >= 3 && !STOPWORDS.has(w)) terms.push(w);
  }
  const cjk = text.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i + 1 < cjk.length; i++) terms.push(cjk[i] + cjk[i + 1]);
  // 去重保序
  return [...new Set(terms)];
}

function topicHash(terms) {
  return terms.length ? crypto.createHash('sha1').update(terms.join('|')).digest('hex').slice(0, 12) : '';
}

// ── 纯函数：词法检索与注入块 ───────────────────────────────────────────────

/** 词法打分：title ×4 / tags ×2 / abstract 命中 ×1（计 3 次封顶）；连续双词短语 +3。 */
export function search(index, terms) {
  if (!Array.isArray(index) || !terms.length) return [];
  const hits = [];
  for (const p of index) {
    const t = (p.title || '').toLowerCase();
    const a = (p.abstract || '').toLowerCase();
    const g = (p.tags || []).join(' ').toLowerCase();
    if (!t && !a) continue;
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      if (t.includes(term)) { score += 4; matched++; }
      if (g && g.includes(term)) { score += 2; matched++; }
      let c = 0, from = 0;
      while ((from = a.indexOf(term, from)) !== -1 && c < 3) { score += 1; c++; from += term.length; }
      if (c > 0) matched++;
    }
    // 连续双词短语奖励（前两个 term 视作短语）
    if (terms.length >= 2) {
      const phrase = terms[0] + ' ' + terms[1];
      if (t.includes(phrase) || a.includes(phrase)) score += 3;
    }
    if (score >= MIN_SCORE && matched >= 2) {
      hits.push({ ...p, _score: score });
    }
  }
  hits.sort((x, y) => y._score - x._score);
  return hits.slice(0, TOP_K);
}

/** 构建 <literature_context> 块；空命中返回 ''。 */
export function buildLitBlock(hits) {
  if (!hits || !hits.length) return '';
  const lines = ['<literature_context>',
    'Papers from the local research library that appear relevant to the current topic:'];
  let used = lines.join('\n').length + '</literature_context>'.length;
  for (const h of hits) {
    const snippet = (h.abstract || '').replace(/\s+/g, ' ').slice(0, ABSTRACT_SNIPPET);
    let line = `- [${h.id || h.paper_id || '?'}] ${h.title || 'untitled'} (${h.year || 'n.y.'}${h.venue ? ', ' + h.venue : ''})`;
    if (snippet) line += ` — ${snippet}${(h.abstract || '').length > ABSTRACT_SNIPPET ? '…' : ''}`;
    if (used + line.length + 1 > LIT_BUDGET_CHARS) { dbg('budget reached, dropped', h.title); break; }
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length <= 2) return '';
  lines.push('Cite these as paper_id when relevant; verify claims against the library via scholar tools.');
  lines.push('</literature_context>');
  return lines.join('\n');
}

// ── 索引：parsed JSON 元数据 + 文件缓存 ────────────────────────────────────

export function parsedDir() { return path.join(SCHOLAR_HOME, 'output', 'parsed'); }
export function indexCachePath() { return path.join(SCHOLAR_HOME, 'output', 'index', 'scholar-native-index.json'); }

function buildIndexFromParsed(dir) {
  const entries = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      entries.push({
        id: j.paper_id || f.replace(/\.json$/, ''),
        title: j.title || '',
        year: j.year || null,
        venue: j.venue || '',
        abstract: (j.abstract || '').slice(0, INDEX_ABSTRACT),
        tags: Array.isArray(j.tags) ? j.tags : [],
      });
    } catch { /* 跳过损坏文件 */ }
  }
  return entries;
}

/** 惰性构建/加载索引；源文件数一致即视为新鲜，否则全量重建并写缓存。 */
export function ensureIndex(signal) {
  const dir = parsedDir();
  if (!fs.existsSync(dir)) { warn('parsed dir missing: ' + dir); return []; }
  const cache = indexCachePath();
  const n = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
  if (fs.existsSync(cache)) {
    try {
      const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (Array.isArray(j.entries) && j.sourceCount === n) {
        dbg('index cache hit:', n, 'files');
        return j.entries;
      }
    } catch { /* 缓存损坏则重建 */ }
  }
  signal?.throwIfAborted();
  const t0 = Date.now();
  const entries = buildIndexFromParsed(dir);
  signal?.throwIfAborted();
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ builtAt: new Date().toISOString(), count: entries.length, sourceCount: n, entries }));
  } catch (e) { warn('index cache write failed: ' + e.message); }
  log('index built:', entries.length, 'entries from', n, 'files in', Date.now() - t0, 'ms');
  return entries;
}

// ── 静态层：persona ───────────────────────────────────────────────────────

function readRule(name) {
  try {
    const p = path.join(SCHOLAR_HOME, '.scholar', 'rules', name);
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8').replace(/\s+/g, ' ').trim().slice(0, RULE_MAX_CHARS);
  } catch { return ''; }
}

export function buildPersona() {
  if (SCHOLAR_OFF) return '';
  const identity = readRule('identity.md');
  const academic = readRule('academic.md');
  let n = 0;
  try {
    const cache = indexCachePath();
    if (fs.existsSync(cache)) {
      const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (Array.isArray(j.entries)) n = j.entries.length;
    }
    if (!n) n = fs.readdirSync(parsedDir()).filter(f => f.endsWith('.json')).length;
  } catch { /* ignore */ }
  const lines = [
    '<scholar_persona>',
    'You are a scholarly research agent with permanent access to a local paper library' +
    ` ("SCHOLAR_HOME", currently ${n} parsed AI papers, searchable via mcp__scholar__* tools).`,
    'Standing policy — follow it without being asked:',
    '1. Literature first. When any technical topic arises, relate it to the library.' +
    ' If no <literature_context> block covers the current topic yet, actively search the library' +
    ' (mcp__scholar__search / rag tools) before giving a substantive answer.',
    '2. Cite precisely. When drawing on library papers, cite as paper_id + title + year;' +
    ' never fabricate ids or titles. If unsure a paper exists, search first.',
    '3. Prior art check. Before proposing a new method, experiment or writing a claim,' +
    ' check the library for related work and position your statement against it.',
    '4. Honest boundaries. Distinguish what the library supports from general knowledge;' +
    ' mark uncertain claims explicitly.',
    '5. Workspace artifacts. Reading notes and drafts belong under the current workspace output/ directory.',
  ];
  if (identity) lines.push('Researcher profile: ' + identity);
  if (academic) lines.push('Academic norms: ' + academic);
  lines.push('</scholar_persona>');
  return lines.join('\n');
}

// ── 动态层状态机 ──────────────────────────────────────────────────────────

function stateFor(agentId) {
  if (!agentState.has(agentId)) agentState.set(agentId, { topicHash: '', litBlock: '' });
  return agentState.get(agentId);
}
export { stateFor };

/** pre-step 话题刷新（阻塞检索 <300ms 目标；索引首次构建例外并打日志）。 */
export async function refreshTopic(agentId, messages, signal) {
  const text = extractUserText(messages);
  const terms = extractTerms(text);
  const hash = topicHash(terms);
  const st = stateFor(agentId);
  // 无用户文本（工具结果 step 等）：保留现有上下文，绝不清空
  if (!hash) return false;
  if (hash === st.topicHash) { dbg('topic unchanged, skip'); return false; }
  st.topicHash = hash;
  const idx = ensureIndex(signal);
  const hits = search(idx, terms);
  st.litBlock = buildLitBlock(hits);
  log('topic refreshed:', terms.slice(0, 8).join(','), '→', hits.length, 'hits');
  return true;
}

// ── P2 反射层：引用对账 ───────────────────────────────────────────────────

/** 从 LaTeX/BibTeX 文本提取引用键（\cite/\citep/\citet/\bibitem），去重、截断。 */
export function extractCiteKeys(text) {
  if (!text) return [];
  const keys = [];
  const re = /\\(?:cite|citep|citet|bibitem)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const k of m[1].split(',')) {
      const key = k.trim();
      if (key && !keys.includes(key)) keys.push(key);
      if (keys.length >= MAX_CITE_KEYS) return keys;
    }
  }
  return keys;
}

/** 引用对账块：每个键给出库内最近邻（或 none），驱动模型自我修正。 */
export function buildCitationAudit(keys, index) {
  if (!keys || !keys.length) return '';
  const lines = ['<citation_audit>',
    'Citation keys detected in the latest LaTeX/BibTeX write. Verify each against the local library:'];
  let used = lines.join('\n').length + '</citation_audit>'.length;
  for (const key of keys) {
    const terms = extractTerms(key.replace(/\d+/g, ' '));
    let line = `- ${key} → nearest: none — verify this reference exists in the library or correct the key`;
    if (terms.length) {
      const hits = search(index, terms);
      if (hits.length) {
        const h = hits[0];
        line = `- ${key} → nearest: [${h.id}] ${h.title} (${h.year || 'n.y.'}${h.venue ? ', ' + h.venue : ''}) — confirm this is the intended source`;
      }
    }
    if (used + line.length + 1 > LIT_BUDGET_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  lines.push('Cite as paper_id where possible; correct any key without a library counterpart before finishing.');
  lines.push('</citation_audit>');
  return lines.join('\n');
}

/** 反射层挂钩体：write/str_replace_editor 写 .tex/.bib 后触发（observation-only）。 */
export function auditWrittenFile(agentId, toolName, args, signal) {
  if (toolName !== 'write' && toolName !== 'str_replace_editor') return false;
  const p = String(args?.path || args?.file_path || '');
  if (!/\.(tex|bib)$/i.test(p)) return false;
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch { text = String(args?.content || args?.new_string || ''); }
  const keys = extractCiteKeys(text);
  if (!keys.length) return false;
  const idx = ensureIndex(signal);
  const st = stateFor(agentId);
  st.citeAudit = buildCitationAudit(keys, idx);
  log('citation audit refreshed:', keys.length, 'keys @', path.basename(p));
  return true;
}

// ── P2 主动层：会话方向捕获 ───────────────────────────────────────────────

/** 记录一条用户消息的话题词（去重、封顶）。 */
export function recordSessionTopic(sessionKey, text) {
  if (!sessionKey) return false;
  const terms = extractTerms(text).filter(t => t.length >= 3);
  if (!terms.length) return false;
  const list = sessionTopics.get(sessionKey) || [];
  let added = 0;
  for (const t of terms) {
    if (!list.includes(t)) { list.push(t); added++; }
    if (list.length >= MAX_SESSION_TOPICS) break;
  }
  if (!added) return false;
  sessionTopics.set(sessionKey, list);
  return true;
}

/** 会话方向线程段（order 120）——空会话返回空串。 */
export function sessionInterestsBlock(sessionKey) {
  if (!sessionKey) return '';
  const list = sessionTopics.get(sessionKey);
  if (!list || !list.length) return '';
  return ['<scholar_session_interests>',
    'Research threads touched in this session (keep direction coherent; surface them when suggesting next steps):',
    list.slice(-MAX_SESSION_TOPICS).join(', '),
    '</scholar_session_interests>'].join('\n');
}

// ── apply ─────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  if (config?.scholarHome) SCHOLAR_HOME = String(config.scholarHome);
  if (SCHOLAR_OFF) log('SCHOLAR_OFF=1 — persona & enrichment disabled (sections return empty)');
  log('SCHOLAR_HOME=' + SCHOLAR_HOME);

  if (ctx.systemPrompt) {
    ctx.systemPrompt.section({
      name: 'scholar-persona',
      order: PERSONA_ORDER,
      text: () => buildPersona(),
    });
    ctx.systemPrompt.section({
      name: 'scholar-literature-context',
      order: LIT_ORDER,
      text: () => {
        if (!lastActiveAgent) return '';
        const st = agentState.get(lastActiveAgent);
        return st ? st.litBlock : '';
      },
    });
    ctx.systemPrompt.section({
      name: 'scholar-session-interests',
      order: SESSION_ORDER,
      text: () => sessionInterestsBlock(lastActiveAgent),
    });
    ctx.systemPrompt.section({
      name: 'scholar-citation-audit',
      order: AUDIT_ORDER,
      text: () => {
        if (!lastActiveAgent) return '';
        const st = agentState.get(lastActiveAgent);
        return st ? (st.citeAudit || '') : '';
      },
    });
    log('systemPrompt sections registered: persona(' + PERSONA_ORDER + '), interests(' + SESSION_ORDER + '), lit(' + LIT_ORDER + '), audit(' + AUDIT_ORDER + ')');
  } else {
    warn('ctx.systemPrompt unavailable — plugin inert');
    return;
  }

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    if (SCHOLAR_OFF) return decision;
    try {
      lastActiveAgent = agent.id;
      await refreshTopic(agent.id, messages, signal);
    } catch (e) {
      warn('pre-step enrichment failed: ' + (e?.message || e));
    }
    return decision;
  });

  // P2 反射层：写 .tex/.bib 后引用对账（observation-only，绝不改写工具结果）
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (SCHOLAR_OFF || !exec) return decision;
    try {
      const agentId = exec.agent?.id || lastActiveAgent;
      if (agentId) {
        lastActiveAgent = agentId;
        auditWrittenFile(agentId, exec.name, exec.arguments, exec.signal);
      }
    } catch (e) {
      warn('post-execute audit failed: ' + (e?.message || e));
    }
    return decision;
  });

  // P2 主动层：只读捕获用户消息话题词
  ctx.on('session/event', (session, event) => {
    if (SCHOLAR_OFF) return;
    try {
      if (event?.type !== 'user/message') return;
      const key = session?.id || lastActiveAgent;
      const text = extractUserText([{ role: 'user', content: event?.data?.content }]);
      if (key && text) {
        const had = (sessionTopics.get(key) || []).length > 0;
        if (recordSessionTopic(key, text) && !had) log('session interests started:', key);
      }
    } catch (e) {
      warn('session capture failed: ' + (e?.message || e));
    }
  });

  log('plugin mounted (persona order=' + PERSONA_ORDER + ', interests order=' + SESSION_ORDER + ', lit order=' + LIT_ORDER + ', audit order=' + AUDIT_ORDER + ', SCHOLAR_HOME=' + SCHOLAR_HOME + ')');
}

// 供 self-test / e2e 复位（多进程下无影响）
export function __reset() {
  agentState.clear();
  sessionTopics.clear();
  lastActiveAgent = null;
}
