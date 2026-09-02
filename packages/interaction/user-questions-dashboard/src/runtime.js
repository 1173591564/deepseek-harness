/**
 * Same-origin local answer provider for headless DSH sessions.
 *
 * The browser receives a random HttpOnly capability cookie from the dashboard
 * document. API and SSE requests require that cookie, the exact loopback Host,
 * and the exact same Origin. Plugin disposal rejects pending questions and
 * waits for the HTTP server to stop accepting work.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import z from '@deepseek-ai/schemastery';

export const name = 'dashboard-provider';
export const inject = ['userQuestions'];
export const Config = z.object({
  port: z.number(),
  timeoutMs: z.number(),
  autoOpen: z.boolean(),
});

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(HERE, '..', 'src', 'dashboard.html'), 'utf8');
const MAX_BODY_BYTES = 1024 * 1024;

function positiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`dashboard-provider: ${label} must be a positive integer`);
  }
  return resolved;
}

function portNumber(value) {
  const resolved = value === undefined ? 8790 : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 65535) {
    throw new Error('dashboard-provider: port must be an integer from 0 through 65535');
  }
  return resolved;
}

function hasCapability(req, origin, capability) {
  if (req.headers.host !== origin.slice('http://'.length)) return false;
  if (req.headers.origin !== origin) return false;
  const cookies = String(req.headers.cookie ?? '').split(';').map(item => item.trim());
  return cookies.includes(`dsh_dashboard=${capability}`);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('dashboard-provider: at least one question is required');
  }
  const ids = new Set();
  for (const question of questions) {
    if (typeof question?.id !== 'string' || question.id.length === 0) {
      throw new Error('dashboard-provider: every question requires a non-empty id');
    }
    if (ids.has(question.id)) {
      throw new Error('dashboard-provider: question ids must be unique');
    }
    ids.add(question.id);
  }
}

function validateAnswer(request, answer) {
  if (!Array.isArray(answer?.answers)) return 'answers must be an array';
  if (answer.answers.length !== request.questions.length) {
    return 'every question must be answered exactly once';
  }
  const answerIds = new Set();
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index];
    const item = answer.answers[index];
    if (item?.id !== question.id) return 'answers must preserve question order';
    if (answerIds.has(item.id)) return 'answer ids must be unique';
    answerIds.add(item.id);
    if (!Array.isArray(item.selected) || item.selected.some(value => typeof value !== 'string')) {
      return `answer ${question.id}: selected must be a string array`;
    }
    const custom = item.custom;
    if (custom !== undefined && (typeof custom !== 'string' || custom.trim().length === 0)) {
      return `answer ${question.id}: custom must be non-empty text`;
    }
    const hasCustom = typeof custom === 'string';
    if (item.selected.length === 0 && !hasCustom) {
      return `answer ${question.id}: an option or custom answer is required`;
    }
    if (Array.isArray(question.options) && question.options.length > 0) {
      const labels = new Set(question.options.map(option => option.label));
      if (item.selected.some(value => !labels.has(value))) {
        return `answer ${question.id}: selected option is not available`;
      }
    } else if (item.selected.length > 0) {
      return `answer ${question.id}: free-text questions use custom`;
    }
    const choiceCount = item.selected.length + (hasCustom ? 1 : 0);
    if (!question.multiSelect && choiceCount > 1) {
      return `answer ${question.id}: only one answer is allowed`;
    }
  }
  return null;
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function browserCommand(url) {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

function openBrowser(url) {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.once('error', () => {
    console.warn('[dashboard-provider] browser auto-open failed');
  });
  child.unref();
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

export async function apply(ctx, config = {}) {
  const port = portNumber(config.port ?? process.env.DASHBOARD_PORT);
  const timeoutMs = positiveInteger(
    config.timeoutMs ?? process.env.DASHBOARD_TIMEOUT_MS,
    600_000,
    'timeoutMs',
  );
  const autoOpen = config.autoOpen ?? process.env.DASHBOARD_AUTO_OPEN !== '0';
  const pending = new Map();
  const sseClients = new Set();
  const capability = randomBytes(32).toString('base64url');
  let origin;
  let disposed = false;

  function broadcast(event, data) {
    for (const client of [...sseClients]) {
      try {
        writeSse(client, event, data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function settle(entry, outcome, value) {
    if (!pending.delete(entry.id)) return;
    clearTimeout(entry.timer);
    entry.request.signal?.removeEventListener('abort', entry.onAbort);
    broadcast('resolved', { id: entry.id, [outcome]: true });
    if (outcome === 'answered') entry.resolve(value);
    else entry.reject(new Error(`dashboard question ${outcome}`));
  }

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', origin);
    if (req.method === 'GET' && requestUrl.pathname === '/') {
      if (req.headers.host !== origin.slice('http://'.length)) {
        sendJson(res, 421, { ok: false, error: 'invalid host' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(DASHBOARD_HTML),
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Set-Cookie': `dsh_dashboard=${capability}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end(DASHBOARD_HTML);
      return;
    }
    if (!hasCapability(req, origin, capability)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      for (const entry of pending.values()) {
        writeSse(res, 'question', {
          id: entry.id,
          questions: entry.request.questions,
        });
      }
      req.once('close', () => sseClients.delete(res));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/status') {
      sendJson(res, 200, { ok: true, pending: pending.size });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/answer') {
      try {
        const answer = await readJson(req);
        const entry = pending.get(answer?.id);
        if (entry === undefined) {
          sendJson(res, 404, { ok: false, error: 'question not found' });
          return;
        }
        const validationError = validateAnswer(entry.request, answer);
        if (validationError !== null) {
          sendJson(res, 422, { ok: false, error: validationError });
          return;
        }
        settle(entry, 'answered', { answers: answer.answers });
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid request' });
      }
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/cancel') {
      try {
        const body = await readJson(req);
        const entry = pending.get(body?.id);
        if (entry === undefined) {
          sendJson(res, 404, { ok: false, error: 'question not found' });
          return;
        }
        settle(entry, 'cancelled');
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid request' });
      }
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  await listen(server, port);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('dashboard-provider: failed to determine listening address');
  }
  origin = `http://127.0.0.1:${address.port}`;

  let disposeProvider;
  try {
    disposeProvider = ctx.userQuestions.registerProvider({
      ask(request) {
        if (disposed) return Promise.reject(new Error('dashboard provider is disposed'));
        validateQuestions(request.questions);
        if (request.signal?.aborted) {
          return Promise.reject(new Error('dashboard question aborted'));
        }
        return new Promise((resolve, reject) => {
          const id = randomUUID();
          const entry = {
            id,
            request,
            resolve,
            reject,
            timer: undefined,
            onAbort: undefined,
          };
          entry.onAbort = () => settle(entry, 'aborted');
          entry.timer = setTimeout(() => settle(entry, 'timeout'), timeoutMs);
          request.signal?.addEventListener('abort', entry.onAbort, { once: true });
          pending.set(id, entry);
          broadcast('question', { id, questions: request.questions });
        });
      },
    });
  } catch (error) {
    await closeServer(server);
    throw error;
  }

  ctx.effect(() => async () => {
    disposed = true;
    disposeProvider();
    for (const entry of [...pending.values()]) settle(entry, 'disposed');
    for (const client of [...sseClients]) client.end();
    sseClients.clear();
    await closeServer(server);
  }, 'dashboard-provider.lifecycle');

  console.log(`[dashboard-provider] listening at ${origin}`);
  if (autoOpen) openBrowser(origin);
}
