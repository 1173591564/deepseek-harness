/**
 * Keyless Memory plugin smoke with local Gateway and persistence fixtures.
 */
import { createServer } from 'node:http';
import { apply } from './memory-native.mjs';

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}`);
  }
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        endpoint: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error));
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 0, data }));
}

const order = [];
const gateway = await listen(async (req, res) => {
  const body = await readJson(req);
  if (req.headers['x-tdai-user-key'] !== 'memory-key' || body.user_key !== 'memory-key') {
    res.writeHead(401).end();
    return;
  }
  if (req.url === '/v3/meta/auth/verify') {
    send(res, { valid: true, user: { user_id: 'user-1' } });
  }
  else if (req.url === '/v3/meta/team/list') {
    send(res, { items: [{ team_id: 'team-1', name: 'Research Team' }] });
  } else if (req.url === '/v3/meta/agent/list') {
    send(res, { items: [{ agent_id: 'agent-1', name: 'Research Agent' }] });
  } else if (req.url === '/v3/meta/task/list') {
    send(res, { items: [{ task_id: 'task-1', title: 'Review citations' }] });
  } else if (req.url === '/v3/meta/agent/get') {
    send(res, { agent_id: 'agent-1', name: 'Research Agent' });
  } else if (req.url === '/v3/meta/task/get') {
    send(res, { task_id: 'task-1', title: 'Review citations' });
  } else if (req.url === '/v3/meta/participation-log/append') {
    order.push('participation');
    send(res, { stored: true });
  } else {
    res.writeHead(404).end();
  }
});

let persisted;
let readbacks = 0;
const proxy = await listen(async (req, res) => {
  if (req.headers.authorization !== 'Bearer proxy-token') {
    res.writeHead(401).end();
    return;
  }
  const body = await readJson(req);
  if (req.url === '/v3/session/native-init') {
    order.push('persist');
    persisted = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/v3/session/native-get') {
    order.push('readback');
    readbacks += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: persisted }));
    return;
  }
  res.writeHead(404).end();
});

function fixture() {
  const listeners = new Map();
  const effects = [];
  const appended = [];
  let questionSignal;
  const ctx = {
    credentials: {
      async resolve(reference) {
        if (reference === 'MEMORY_KEY') return { value: 'memory-key' };
        if (reference === 'PROXY_TOKEN') return { value: 'proxy-token' };
        return undefined;
      },
    },
    userQuestions: {
      async ask(request) {
        questionSignal = request.signal;
        return {
          answers: [{
            id: request.questions[0].id,
            selected: [request.questions[0].options[0].label],
          }],
        };
      },
    },
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  const agent = {
    id: 'agent-owner',
    session: {
      events: [],
      append(type, data) {
        appended.push({ type, data });
        this.events.push({ type, data });
      },
    },
  };
  return {
    ctx,
    agent,
    appended,
    listeners,
    questionSignal: () => questionSignal,
    async dispose() {
      for (const dispose of effects.reverse()) await dispose();
    },
  };
}

try {
  const target = fixture();
  apply(target.ctx, {
    enabled: true,
    memoryEndpoint: gateway.endpoint,
    proxyEndpoint: proxy.endpoint,
    serviceId: 'service-1',
    userKeyEnv: 'MEMORY_KEY',
    proxyBearerTokenEnv: 'PROXY_TOKEN',
  });
  const caller = new AbortController();
  await target.listeners.get('system-prompt/assemble')(
    {},
    { agent: target.agent, signal: caller.signal },
    async () => ({}),
  );
  check('forwards the caller signal to user questions', target.questionSignal() === caller.signal);
  check('persists participation before session state', order.join(',') === 'participation,persist,readback');
  check('performs authoritative persistence readback', readbacks === 1);
  check('does not persist Memory credentials', (
    persisted.session_info.user_key === undefined
    && !JSON.stringify(persisted).includes('memory-key')
    && !JSON.stringify(persisted).includes('proxy-token')
  ));
  check('appends bounded model context only after readback', (
    target.appended.length === 1
    && target.appended[0].data.source.kind === 'plugin'
    && target.appended[0].data.content[0].text.includes('<session_context>')
  ));
  await target.listeners.get('system-prompt/assemble')(
    {},
    { agent: target.agent, signal: caller.signal },
    async () => ({}),
  );
  check('reconstructs initialized state from the durable session log', readbacks === 1);
  await target.dispose();
  check('disposal removes the assembly listener', target.listeners.size === 0);

  const disabled = fixture();
  apply(disabled.ctx, { enabled: false });
  check('disabled plugin registers no runtime work', disabled.listeners.size === 0);

  const unavailable = fixture();
  unavailable.ctx.credentials.resolve = async () => undefined;
  apply(unavailable.ctx, {
    memoryEndpoint: gateway.endpoint,
    proxyEndpoint: proxy.endpoint,
    serviceId: 'service-1',
    userKeyEnv: 'MEMORY_KEY',
    proxyBearerTokenEnv: 'PROXY_TOKEN',
  });
  try {
    await unavailable.listeners.get('system-prompt/assemble')(
      {},
      { agent: unavailable.agent, signal: caller.signal },
      async () => ({}),
    );
    check('missing credential blocks initialization', false);
  } catch (error) {
    check('missing credential blocks initialization', error.message.includes('credential is unavailable'));
  }
  await unavailable.dispose();
} finally {
  await Promise.all([close(gateway.server), close(proxy.server)]);
}

console.log(`\n=== ${passed}/${passed + failed} passed ===`);
process.exitCode = failed === 0 ? 0 : 1;
