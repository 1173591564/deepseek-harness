/**
 * dashboard-provider 自测 —— 不起 LLM，直接验证 provider 的 ask/SSE/answer/timeout/abort 五条路径。
 *
 * 跑法：node examples/headless-dashboard/self-test.mjs
 * 退出码 0 = 全过。
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

// 复用插件的 apply（设小超时便于测 timeout 分支）
process.env.DASHBOARD_PORT = String(PORT);
process.env.DASHBOARD_TIMEOUT_MS = '1500'; // 1.5s 便于测超时

const { apply } = await import('./dashboard-provider.mjs');

// ── 假 ctx + userQuestions ────────────────────────────────────────────────
let registeredProvider = null;
const ctx = {
  userQuestions: { registerProvider: (p) => { registeredProvider = p; return () => {}; } },
  effect: undefined,
};
apply(ctx);
if (!registeredProvider) { console.error('FAIL: provider not registered'); process.exit(1); }
console.log('✓ provider registered');

const ask = registeredProvider.ask;

// ── 工具：收 SSE 事件 ────────────────────────────────────────────────────
async function openSSE(onEvent) {
  const req = await fetch(`${BASE}/events`);
  const reader = req.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const pump = async () => {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const lines = chunk.split('\n');
      let event = 'message', data = '';
      for (const l of lines) {
        if (l.startsWith('event: ')) event = l.slice(7);
        else if (l.startsWith('data: ')) data += l.slice(6);
      }
      if (event !== 'message' && event !== '') {
        try { onEvent(event, JSON.parse(data)); } catch { onEvent(event, data); }
      }
    }
    pump();
  };
  pump();
  return { close: () => reader.cancel() };
}

// ── 工具：POST JSON ──────────────────────────────────────────────────────
async function postJSON(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// ── 工具：取仪表盘 HTML ──────────────────────────────────────────────────
async function getDashboard() {
  const r = await fetch(`${BASE}/`);
  return { status: r.status, html: await r.text() };
}

const results = [];
function check(name, cond) { results.push({ name, ok: !!cond }); console.log((cond ? '✓ ' : '✗ ') + name); }

// ── Test 1: 仪表盘 HTML 可取 ──────────────────────────────────────────────
{
  const { status, html } = await getDashboard();
  check('GET / returns dashboard HTML (200, contains <h1>)', status === 200 && html.includes('<h1>'));
}

// ── Test 2: /status 空态 ──────────────────────────────────────────────────
{
  const r = await fetch(`${BASE}/status`);
  const j = await r.json();
  check('GET /status empty (pending=0)', j.ok && j.pending.length === 0);
}

// ── Test 3: ask() → SSE 收题 → POST /answer → resolve ────────────────────
{
  const events = [];
  const sse = await openSSE((ev, d) => events.push({ ev, d }));
  const askP = ask({
    questions: [{ id: 'q1', question: '选哪个数据库?', options: [{ label: 'MySQL' }, { label: 'PostgreSQL' }] }],
    agent: undefined,
    signal: undefined,
  });
  // 等 SSE 收到 question
  let qid = null;
  await new Promise((res) => {
    const t = setInterval(() => {
      const q = events.find(e => e.ev === 'question');
      if (q) { qid = q.d.id; clearInterval(t); res(); }
    }, 20);
  });
  check('SSE received question event with id', !!qid);
  // 提交答案
  const ans = await postJSON('/answer', { id: qid, answers: [{ id: 'q1', selected: ['MySQL'] }] });
  check('POST /answer accepted (200)', ans.status === 200 && ans.json.ok);
  const answer = await askP;
  check('ask() resolved with submitted answer', answer.answers[0].selected[0] === 'MySQL');
  await sse.close();
}

// ── Test 4: 校验拦截 —— 错误的 question id / 非法 selected ────────────────
{
  const events = [];
  const sse = await openSSE((ev, d) => events.push({ ev, d }));
  const askP = ask({
    questions: [{ id: 'q2', question: '选?', options: [{ label: 'A' }, { label: 'B' }] }],
    agent: undefined, signal: undefined,
  });
  let qid = null;
  await new Promise((res) => { const t = setInterval(() => { const q = events.find(e => e.ev === 'question'); if (q) { qid = q.d.id; clearInterval(t); res(); } }, 20); });
  // 错 id
  const bad1 = await postJSON('/answer', { id: qid, answers: [{ id: 'wrong', selected: ['A'] }] });
  check('reject unknown question id (422)', bad1.status === 422);
  // 非法选项
  const bad2 = await postJSON('/answer', { id: qid, answers: [{ id: 'q2', selected: ['ZZZ'] }] });
  check('reject option not in list (422)', bad2.status === 422);
  // 单选给多个
  const bad3 = await postJSON('/answer', { id: qid, answers: [{ id: 'q2', selected: ['A', 'B'] }] });
  check('reject multi-selected on single-select (422)', bad3.status === 422);
  // 正确提交
  const ok = await postJSON('/answer', { id: qid, answers: [{ id: 'q2', selected: ['A'] }] });
  check('correct answer accepted after rejections', ok.status === 200);
  await askP;
  await sse.close();
}

// ── Test 5: 超时分支（不答题，等 1.5s 自动 reject）────────────────────────
{
  const t0 = Date.now();
  const askP = ask({ questions: [{ id: 'qto', question: '不会有人答' }], agent: undefined, signal: undefined });
  let timedOut = false;
  try { await askP; } catch (e) { timedOut = true; }
  const elapsed = Date.now() - t0;
  check('ask() rejects on timeout (~1.5s)', timedOut && elapsed > 1400 && elapsed < 3000);
}

// ── Test 6: abort signal 分支 ─────────────────────────────────────────────
{
  const ac = new AbortController();
  const askP = ask({ questions: [{ id: 'qab', question: '会被取消' }], agent: undefined, signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  let aborted = false;
  try { await askP; } catch (e) { aborted = true; }
  check('ask() rejects when signal aborts', aborted);
}

// ── Test 7: 已 abort 的 signal（进入即拒）─────────────────────────────────
{
  const ac = new AbortController();
  ac.abort();
  let rejectedImmediate = false;
  try { await ask({ questions: [{ id: 'qab2', question: 'x' }], agent: undefined, signal: ac.signal }); }
  catch (e) { rejectedImmediate = true; }
  check('ask() rejects immediately if signal already aborted', rejectedImmediate);
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const total = results.length;
console.log(`\n=== ${passed}/${total} passed ===`);
process.exit(passed === total ? 0 : 1);
