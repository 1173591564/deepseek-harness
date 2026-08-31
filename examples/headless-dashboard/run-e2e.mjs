/**
 * run-e2e.mjs — 端到端自动验证：起 headless dsh → 等仪表盘收到题 → 自动答题 → 收 stdout。
 * 用法：node examples/headless-dashboard/run-e2e.mjs
 * 可选 env：DSH_TASK（自定义任务）、E2E_VERBOSE=1（打印 dsh 实时输出）、DASHBOARD_PORT
 */
import { spawn } from 'node:child_process';

const PORT = Number(process.env.DASHBOARD_PORT) || 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const TASK = process.env.DSH_TASK || 'Ask the user which database they want to use. You MUST call the ask_user_question tool with three options: MySQL, PostgreSQL, Redis. After the user answers, reply in one sentence acknowledging their choice.';
const DSH_ROOT = 'C:\\Users\\11735\\Desktop\\deepseek-harness';
const BIN = 'C:\\Users\\11735\\Desktop\\deepseek-harness\\apps\\cli\\src\\bin.ts';
const VERBOSE = !!process.env.E2E_VERBOSE;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);

async function getStatus() {
  try { const r = await fetch(`${BASE}/status`); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}

async function waitForServer(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await getStatus();
    if (s) return s;
    await sleep(300);
  }
  throw new Error(`dashboard server not up at ${BASE} within ${maxMs}ms`);
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

log(`task: ${TASK.slice(0, 70)}…`);
log(`spawning dsh headless (node direct, no shell)`);

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

let checks = { serverUp: false, questionPopped: false, answerAccepted: false, exit0: false, stdoutHasChoice: false };
let chosen = '';

try {
  // 1. 等仪表盘服务起来
  log('waiting for dashboard server…');
  await waitForServer(60000);
  checks.serverUp = true;
  log('✓ dashboard server up');

  // 2. 等 LLM 调 ask_user_question → provider 收到题
  log('waiting for pending question (LLM should call ask_user_question)…');
  const pending = await waitForPending(120000);
  checks.questionPopped = true;
  const q0 = pending.questions[0];
  chosen = q0.options ? q0.options[0].label : 'ok';
  log(`✓ question received: id=${pending.id}, q="${q0.question.slice(0,60)}"`);
  log(`  options: ${(q0.options||[]).map(o=>o.label).join(' / ')}`);

  // 3. 选第一个选项答题
  log(`answering with: "${chosen}"`);
  const ans = await postAnswer(pending.id, [{ id: q0.id, selected: [chosen] }]);
  log(`answer POST → ${ans.status} ${JSON.stringify(ans.json)}`);
  checks.answerAccepted = (ans.status === 200);

  // 4. 等 dsh 退出（最多 90s）
  log('waiting for dsh to finish (up to 90s)…');
  const exitCode = await Promise.race([
    exitPromise,
    sleep(90000).then(() => new Promise((_, rej) => rej(new Error('dsh did not exit within 90s')))),
  ]);
  checks.exit0 = (exitCode === 0);
  log(`dsh exited with code ${exitCode}`);
} catch (e) {
  log(`✗ error: ${e.message}`);
  // 进程可能还在跑，强杀
  try { child.kill('SIGKILL'); } catch {}
  await sleep(1000);
}

// 收尾：确保进程没了
try { if (!child.killed) child.kill('SIGKILL'); } catch {}
try { await Promise.race([exitPromise, sleep(3000)]); } catch {}

log('--- stdout ---');
console.log(stdout);
log('--- end stdout ---');
if (stderr) { log('--- stderr (last 800) ---'); console.log(stderr.slice(-800)); }

checks.stdoutHasChoice = stdout.toLowerCase().includes(chosen.toLowerCase());

log('=== 判据 ===');
let allOk = true;
const labels = { serverUp:'dashboard server up', questionPopped:'question popped', answerAccepted:'answer accepted', exit0:'dsh exit code 0', stdoutHasChoice:`stdout contains "${chosen}"` };
for (const k of ['serverUp','questionPopped','answerAccepted','exit0','stdoutHasChoice']) {
  console.log(`${checks[k]?'✓':'✗'} ${labels[k]}`);
  if (!checks[k]) allOk = false;
}
process.exit(allOk ? 0 : 1);
