/**
 * dashboard-provider — headless dsh 的外部仪表盘答题 provider。
 *
 * 把 dsh 的 userQuestions.ask() 外包给一个独立浏览器仪表盘：
 *   ask() → SSE 推送问题到浏览器 → 人点选项 → POST /answer → ask() resolve
 *
 * 零依赖（仅 node:http + node:crypto + node:url）。挂载方式：在 headless
 * profile 的 cordis.patch.yml 加一行 `name: file:///<abs path to this .mjs>`。
 *
 * 端口/超时由 env 可调：DASHBOARD_PORT (默认 8790)、DASHBOARD_TIMEOUT_MS (默认 600000)。
 *
 * 详见 examples/headless-dashboard/README.md。
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL as NodeURL } from 'node:url';

export const name = 'dashboard-provider';
export const inject = ['userQuestions'];

const PORT = Number(process.env.DASHBOARD_PORT) || 8790;
const TIMEOUT_MS = Number(process.env.DASHBOARD_TIMEOUT_MS) || 600_000;
const CORS = { 'Access-Control-Allow-Origin': '*' };
/** 有 pending 问题自动打开浏览器（0 关闭）。默认开。 */
const AUTO_OPEN = (process.env.DASHBOARD_AUTO_OPEN ?? '1') !== '0';
const AUTO_OPENED = Symbol('auto-open-fired');

const __dirname = fileURLToPath(new NodeURL('.', import.meta.url));
const DASHBOARD_HTML = readFileSync(new NodeURL('dashboard.html', import.meta.url), 'utf8');

// ── pending questions & SSE clients ────────────────────────────────────────
// Map<rpcId, { request, resolve, reject, timer, createdAt }>
const pending = new Map();
// Set<ServerResponse> — open SSE streams
const sseClients = new Set();

// ── helpers ────────────────────────────────────────────────────────────────

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* client gone, ignore */ }
  }
}

/** 校验答案对齐 questions（对齐 api-proxy.ts matchesQuestions 语义）。 */
function validateAnswer(request, answer) {
  const qById = new Map((request.questions ?? []).map(q => [q.id, q]));
  if (!Array.isArray(answer?.answers)) return 'answers must be an array';
  for (const a of answer.answers) {
    const q = qById.get(a.id);
    if (!q) return `unknown question id: ${a.id}`;
    if (!Array.isArray(a.selected)) return `answer ${a.id}: selected must be an array`;
    if (q.options && q.options.length > 0) {
      const labels = new Set(q.options.map(o => o.label));
      for (const s of a.selected) {
        if (!labels.has(s)) return `answer ${a.id}: "${s}" is not among question options`;
      }
    }
    if (!q.multiSelect && a.selected.length > 1) {
      return `answer ${a.id}: single-select question but ${a.selected.length} selected`;
    }
  }
  return null;
}

// ── HTTP routes ────────────────────────────────────────────────────────────

function serveDashboard(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
  res.end(DASHBOARD_HTML);
}

function serveEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...CORS,
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  // 重连时重放当前 pending（断线不丢题）
  for (const [id, p] of pending) {
    sseSend(res, 'question', { id, questions: p.request.questions, agent: agentLabel(p.request) });
  }
  req.on('close', () => { sseClients.delete(res); try { res.end(); } catch {} });
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

async function serveAnswer(req, res) {
  const body = await readBody(req);
  if (!body || !body.id) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: 'missing id' }));
    return;
  }
  const p = pending.get(body.id);
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: 'no pending question with that id' }));
    return;
  }
  const err = validateAnswer(p.request, body);
  if (err) {
    res.writeHead(422, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: err }));
    return;
  }
  clearTimeout(p.timer);
  pending.delete(body.id);
  broadcast('resolved', { id: body.id, answers: body.answers });
  res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ ok: true }));
  p.resolve({ answers: body.answers });
}

async function serveCancel(req, res) {
  const body = await readBody(req);
  const p = body?.id ? pending.get(body.id) : null;
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: 'no pending question with that id' }));
    return;
  }
  clearTimeout(p.timer);
  pending.delete(body.id);
  broadcast('resolved', { id: body.id, cancelled: true });
  res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ ok: true }));
  p.reject(new Error('ask_user_question cancelled from dashboard'));
}

function serveStatus(res) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({
    ok: true,
    pending: [...pending.values()].map(p => ({
      id: p.rpcId,
      questions: p.request.questions,
      agent: agentLabel(p.request),
      ageMs: Date.now() - p.createdAt,
    })),
    sseClients: sseClients.size,
  }));
}

// ── provider ask() ─────────────────────────────────────────────────────────

function agentLabel(request) {
  const a = request.agent;
  return a ? `${a.id ?? '?'}` : null;
}

/** 首次收到 pending 问题时自动打开浏览器（仅一次）。 */
function maybeAutoOpen() {
  if (!AUTO_OPEN) return;
  if (globalThis[AUTO_OPENED]) return;
  globalThis[AUTO_OPENED] = true;
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`[dashboard-provider] auto-opening browser at ${url}`);
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.warn(`[dashboard-provider] auto-open failed: ${e.message}`);
  }
}

function ask(request) {
  return new Promise((resolve, reject) => {
    const rpcId = randomUUID();
    const timer = setTimeout(() => {
      if (!pending.has(rpcId)) return;
      pending.delete(rpcId);
      broadcast('resolved', { id: rpcId, timeout: true });
      reject(new Error(`ask_user_question timed out after ${TIMEOUT_MS}ms (no dashboard answer)`));
    }, TIMEOUT_MS);

    pending.set(rpcId, { rpcId, request, resolve, reject, timer, createdAt: Date.now() });
    broadcast('question', { id: rpcId, questions: request.questions, agent: agentLabel(request) });
    maybeAutoOpen();

    // 监听 abort signal（turn 取消 / agent.dispose）
    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timer);
        pending.delete(rpcId);
        broadcast('resolved', { id: rpcId, aborted: true });
        reject(new Error('ask_user_question aborted before user answered'));
        return;
      }
      request.signal.addEventListener('abort', () => {
        if (!pending.has(rpcId)) return;
        clearTimeout(timer);
        pending.delete(rpcId);
        broadcast('resolved', { id: rpcId, aborted: true });
        reject(new Error('ask_user_question was aborted while waiting for dashboard answer'));
      }, { once: true });
    }
  });
}

// ── apply ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  if (!ctx.userQuestions) {
    console.warn('[dashboard-provider] ctx.userQuestions unavailable — plugin inert');
    return;
  }
  ctx.userQuestions.registerProvider({ ask });

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      res.end(); return;
    }
    if (url.pathname === '/' && req.method === 'GET') return serveDashboard(res);
    if (url.pathname === '/events' && req.method === 'GET') return serveEvents(req, res);
    if (url.pathname === '/answer' && req.method === 'POST') return serveAnswer(req, res);
    if (url.pathname === '/cancel' && req.method === 'POST') return serveCancel(req, res);
    if (url.pathname === '/status' && req.method === 'GET') return serveStatus(res);
    res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch {} });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[dashboard-provider] listening on http://127.0.0.1:${PORT} (timeout=${TIMEOUT_MS}ms)`);
  });

  const close = () => {
    try {
      // closeAllConnections 强制断开 keep-alive/SSE 长连接，否则 server.close()
      // 会等所有连接自然关闭 → cordis dispose 挂起 → headless 进程不退出
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    } catch {}
  };
  process.on('exit', close);
  process.on('SIGINT', () => { close(); process.exit(130); });
  process.on('SIGTERM', () => { close(); process.exit(143); });
  // cordis disposal（如果 ctx 暴露了 effect）
  try { ctx.effect && ctx.effect(function* () { yield close; }); } catch {}
}
