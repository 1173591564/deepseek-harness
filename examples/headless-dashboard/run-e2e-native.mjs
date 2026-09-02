/**
 * Run the headless Dashboard and Memory composition against live Memory
 * services, answer each browser question, and verify proxy persistence.
 */
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_ROOT = join(HERE, '../..');
const BIN = join(DSH_ROOT, 'apps/cli/src/bin.ts');
const SESSION_ROOT = join(DSH_ROOT, '.sessions');
const PORT = Number(process.env.DASHBOARD_PORT) || 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROXY_ENDPOINT = process.env.MEMORY_PROXY_ENDPOINT ?? 'http://127.0.0.1:8096';
const PROXY_BEARER = process.env.PROXY_USER_KEY;
const TASK = process.env.DSH_TASK
  ?? 'Reply in one sentence confirming the agent and task context from your system prompt.';
const VERBOSE = process.env.E2E_VERBOSE === '1';

if (PROXY_BEARER === undefined || PROXY_BEARER.length === 0) {
  console.log('SKIP e2e-native: PROXY_USER_KEY is not configured');
  process.exit(0);
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const log = (...values) => console.log('[e2e-native]', ...values);
let cookie;

async function dashboardFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Origin', ORIGIN);
  if (cookie !== undefined) headers.set('Cookie', cookie);
  return fetch(new URL(path, ORIGIN), { ...init, headers });
}

async function connectDashboard() {
  const page = await fetch(ORIGIN);
  if (!page.ok) return false;
  const issuedCookie = page.headers.get('set-cookie')?.split(';', 1)[0];
  if (issuedCookie === undefined) throw new Error('dashboard did not issue a capability cookie');
  cookie = issuedCookie;
  return true;
}

async function getStatus() {
  try {
    const response = await dashboardFetch('/status');
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function waitForServer(maxMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      if (await connectDashboard()) {
        const status = await getStatus();
        if (status !== null) return status;
      }
    } catch {
      // The child owns server startup; connection failures are expected while it boots.
    }
    await sleep(300);
  }
  throw new Error(`dashboard not available within ${maxMs}ms`);
}

async function waitForPending(maxMs) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const status = await getStatus();
    if (status?.pending?.length > 0) return status.pending[0];
    await sleep(400);
  }
  throw new Error(`no pending question within ${maxMs}ms`);
}

async function postAnswer(id, answers) {
  const response = await dashboardFetch('/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, answers }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function pickAnswer(question) {
  const header = (question.header ?? '').toLowerCase();
  const labels = (question.options ?? []).map(option => option.label);
  log(`question header="${question.header}", options=[${labels.join(', ')}]`);
  if (header.includes('asset')) {
    return labels.find(label => label.includes('是') || label.toLowerCase().includes('yes')) ?? labels[0];
  }
  if (['agent', 'task', 'team'].some(value => header.includes(value))) {
    return labels.find(label => !label.includes('跳过') && !label.toLowerCase().includes('skip')) ?? labels[0];
  }
  return labels[0];
}

async function sessionMetadataSince(startedAt) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.name === 'metadata.json' && (await stat(path)).mtimeMs >= startedAt) {
        const metadata = JSON.parse(await readFile(path, 'utf8'));
        if (typeof metadata.id === 'string') matches.push(metadata);
      }
    }
  }
  await visit(SESSION_ROOT);
  matches.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return matches[0];
}

async function readPersistedSession(sessionId) {
  const response = await fetch(new URL('/v3/session/native-get', PROXY_ENDPOINT), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PROXY_BEARER}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_key: sessionId }),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`proxy persistence query returned ${response.status}`);
  const payload = await response.json();
  return payload?.data;
}

const startedAt = Date.now();
const child = spawn(process.execPath, ['--import', 'tsx/esm', BIN, '--profile', 'headless', TASK], {
  cwd: DSH_ROOT,
  env: { ...process.env, DASHBOARD_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => {
  const text = chunk.toString();
  stdout += text;
  if (VERBOSE) process.stdout.write(`[dsh:out] ${text}`);
});
child.stderr.on('data', chunk => {
  const text = chunk.toString();
  stderr += text;
  if (VERBOSE) process.stderr.write(`[dsh:err] ${text}`);
});
const exitPromise = new Promise(resolve => child.on('exit', resolve));
const answersGiven = [];
const checks = {
  serverUp: false,
  formsPopped: 0,
  allAnswersAccepted: true,
  exit0: false,
  agentReplied: false,
  persistedToProxy: false,
};

try {
  await waitForServer();
  checks.serverUp = true;
  for (let round = 1; round <= 5; round += 1) {
    let pending;
    try {
      pending = await waitForPending(round === 1 ? 120_000 : 30_000);
    } catch {
      break;
    }
    const question = pending.questions[0];
    const choice = pickAnswer(question);
    const answer = await postAnswer(pending.id, [{ id: question.id, selected: [choice] }]);
    checks.formsPopped += 1;
    checks.allAnswersAccepted &&= answer.status === 200;
    answersGiven.push(choice);
    await sleep(1_500);
  }

  const exitCode = await Promise.race([
    exitPromise,
    sleep(120_000).then(() => { throw new Error('dsh did not exit within 120 seconds'); }),
  ]);
  checks.exit0 = exitCode === 0;
  checks.agentReplied = stdout.trim().length > 0;
  const metadata = await sessionMetadataSince(startedAt);
  if (metadata === undefined) throw new Error('headless run did not create session metadata');
  const persisted = await readPersistedSession(metadata.id);
  checks.persistedToProxy = persisted?.session_info?.session_id === metadata.id
    && persisted?.session_info?.user_key === undefined;
} catch (error) {
  log(`error: ${error instanceof Error ? error.message : String(error)}`);
  child.kill('SIGKILL');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await Promise.race([exitPromise, sleep(3_000)]);
}

if (VERBOSE) {
  log('stdout');
  console.log(stdout);
  if (stderr.length > 0) {
    log('stderr');
    console.log(stderr);
  }
}

log(`answers: ${answersGiven.join(' -> ') || 'none'}`);
for (const [label, passed] of Object.entries({
  'dashboard server available': checks.serverUp,
  'at least one form answered': checks.formsPopped >= 1,
  'all answers accepted': checks.allAnswersAccepted,
  'dsh exited successfully': checks.exit0,
  'agent returned output': checks.agentReplied,
  'proxy readback matched session': checks.persistedToProxy,
})) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
}

process.exit(Object.values({
  serverUp: checks.serverUp,
  formsPopped: checks.formsPopped >= 1,
  allAnswersAccepted: checks.allAnswersAccepted,
  exit0: checks.exit0,
  agentReplied: checks.agentReplied,
  persistedToProxy: checks.persistedToProxy,
}).every(Boolean) ? 0 : 1);
