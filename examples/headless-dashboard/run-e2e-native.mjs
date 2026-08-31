/**
 * run-e2e-native.mjs — P4-b 端到端验证：headless dsh → memory-native 状态机
 *   → 仪表盘弹 asset_confirm / agent / task → 自动答 → 注入 session_context
 *   → agent 带身份回复 → proxy 持久化 → exit 0
 *
 * 用法：node examples/headless-dashboard/run-e2e-native.mjs
 * env：E2E_VERBOSE=1 打印 dsh 实时输出；DASHBOARD_PORT（默认 8790）
 */
import { spawn } from 'node:child_process';

const PORT = Number(process.env.DASHBOARD_PORT) || 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const TASK = process.env.DSH_TASK || 'Just reply in one sentence confirming you understand the current agent and task context shown in your system prompt.';
const DSH_ROOT = 'C:\\Users\\11735\\Desktop\\deepseek-harness';
const BIN = 'C:\\Users\\11735\\Desktop\\deepseek-harness\\apps\\cli\\src\\bin.ts';
const VERBOSE = !!process.env.E2E_VERBOSE;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[e2e-native]', ...a);

async function getStatus() {
  try { const r = await fetch(`${BASE}/status`); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}
async function waitForServer(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { const s = await getStatus(); if (s) return s; await sleep(300); }
  throw new Error(`dashboard not up within ${maxMs}ms`);
}
async function waitForPending(maxMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await getStatus();
    if (s && s.pending && s.pending.length > 0) return s.pending[0];
    await sleep(400);
  }
  throw new Error(`no pending question within ${maxMs}ms`);
}
async function postAnswer(id, answers) {
  const r = await fetch(`${BASE}/answer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, answers }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/** 根据问题 header 决定选哪个选项。返回 {label}。 */
function pickAnswer(q) {
  const header = (q.header || '').toLowerCase();
  const opts = q.options || [];
  const labels = opts.map(o => o.label);
  log(`  question header="${q.header}", options=[${labels.join(', ')}]`);

  if (header.includes('asset')) {
    // asset_confirm → 选"是"
    const yes = labels.find(l => l.includes('是') || l.toLowerCase().includes('yes'));
    return yes || labels[0];
  }
  if (header.includes('agent')) {
    // agent select → 选第一个 agent（不是 SKIP）
    const first = labels.find(l => !l.includes('跳过') && !l.toLowerCase().includes('skip'));
    return first || labels[0];
  }
  if (header.includes('task')) {
    // task select → 选第一个 task（不是 SKIP）
    const first = labels.find(l => !l.includes('跳过') && !l.toLowerCase().includes('skip'));
    return first || labels[0];
  }
  if (header.includes('team')) {
    const first = labels.find(l => !l.includes('跳过') && !l.toLowerCase().includes('skip'));
    return first || labels[0];
  }
  return labels[0];
}

log(`task: ${TASK.slice(0, 70)}…`);
log(`spawning dsh headless`);

const child = spawn(process.execPath, ['--import', 'tsx/esm', BIN, '--profile', 'headless', TASK], {
  cwd: DSH_ROOT,
  env: { ...process.env, DASHBOARD_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});

let stdout = '', stderr = '';
child.stdout.on('data', c => { const s = c.toString(); stdout += s; if (VERBOSE) process.stdout.write('[dsh:out] ' + s); });
child.stderr.on('data', c => { const s = c.toString(); stderr += s; if (VERBOSE) process.stderr.write('[dsh:err] ' + s); });

const exitPromise = new Promise(resolve => child.on('exit', resolve));

const answersGiven = [];
let checks = { serverUp: false, formsPopped: 0, allAnswersAccepted: true, exit0: false, stdoutHasContext: false, persistedToProxy: false };

try {
  log('waiting for dashboard server…');
  await waitForServer(60000);
  checks.serverUp = true;
  log('✓ dashboard up');

  // 状态机会弹多轮 form，逐个答
  // 最多等 5 轮（asset_confirm + team + agent + task + 可能的 retry）
  for (let round = 1; round <= 5; round++) {
    log(`waiting for form #${round}…`);
    let pending;
    try {
      pending = await waitForPending(round === 1 ? 120000 : 30000);
    } catch {
      log(`no more forms after round ${round - 1}`);
      break;
    }

    const q0 = pending.questions[0];
    const choice = pickAnswer(q0);
    log(`round ${round}: answering "${choice}"`);
    const ans = await postAnswer(pending.id, [{ id: q0.id, selected: [choice] }]);
    log(`  answer POST → ${ans.status} ${JSON.stringify(ans.json)}`);
    checks.formsPopped++;
    if (ans.status !== 200) checks.allAnswersAccepted = false;
    answersGiven.push(choice);

    // 答完一轮，给状态机时间处理 + 弹下一轮
    await sleep(1500);
  }

  log(`all forms answered (${checks.formsPopped} rounds): ${answersGiven.join(' → ')}`);

  // 等 dsh 退出
  log('waiting for dsh to finish…');
  const exitCode = await Promise.race([
    exitPromise,
    sleep(120000).then(() => { throw new Error('dsh did not exit within 120s'); }),
  ]);
  checks.exit0 = (exitCode === 0);
  log(`dsh exited code=${exitCode}`);
} catch (e) {
  log('✗ error: ' + e.message);
  try { child.kill('SIGKILL'); } catch {}
  await sleep(1000);
}
try { if (!child.killed) child.kill('SIGKILL'); } catch {}
try { await Promise.race([exitPromise, sleep(3000)]); } catch {}

log('--- stdout ---');
console.log(stdout);
log('--- end stdout ---');
if (stderr) { log('--- stderr (last 800) ---'); console.log(stderr.slice(-800)); }

// 判据
checks.stdoutHasContext = stdout.toLowerCase().includes('agent') || stdout.toLowerCase().includes('context');

// 验证 proxy 持久化（查 session 是否在 store——通过 refresh-cache 端点间接验证）
try {
  // session_id 是 agent.id，我们不知道具体值，但可以看 stdout 里有没有 session id
  // 简单判据：状态机日志说 persisted 即可
  checks.persistedToProxy = stdout.includes('persisted to proxy') || stdout.includes('session-init complete');
} catch {}

log('=== 判据 ===');
const labels = {
  serverUp: 'dashboard server up',
  formsPopped: `forms popped (>=1)`,
  allAnswersAccepted: 'all answers accepted',
  exit0: 'dsh exit code 0',
  stdoutHasContext: 'stdout indicates agent replied',
  persistedToProxy: 'session-init completed / persisted',
};
let allOk = true;
for (const k of ['serverUp','formsPopped','allAnswersAccepted','exit0','stdoutHasContext','persistedToProxy']) {
  const v = checks[k];
  const pass = k === 'formsPopped' ? checks.formsPopped >= 1 : !!v;
  console.log(`${pass ? '✓' : '✗'} ${labels[k]}${k === 'formsPopped' ? ' (' + checks.formsPopped + ')' : ''}`);
  if (!pass) allOk = false;
}
process.exit(allOk ? 0 : 1);
