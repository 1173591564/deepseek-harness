/**
 * Keyless dashboard-provider lifecycle and HTTP security smoke.
 *
 * Run with: node examples/headless-dashboard/self-test.mjs
 */
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const { apply } = await import('./dashboard-provider.mjs');

let provider;
let dispose;
const ctx = {
  userQuestions: {
    registerProvider(value) {
      provider = value;
      return () => {
        provider = undefined;
      };
    },
  },
  effect(setup) {
    dispose = setup();
    return dispose;
  },
};

await apply(ctx, { port: PORT, timeoutMs: 300, autoOpen: false });
if (provider === undefined || dispose === undefined) {
  throw new Error('dashboard provider did not register its lifecycle');
}

const results = [];
function check(name, condition) {
  results.push(Boolean(condition));
  console.log(`${condition ? '✓' : '✗'} ${name}`);
}

const page = await fetch(`${BASE}/`);
const cookie = page.headers.get('set-cookie')?.split(';', 1)[0];
check('dashboard document sets an HttpOnly same-site capability', (
  page.status === 200
  && page.headers.get('set-cookie')?.includes('HttpOnly')
  && page.headers.get('set-cookie')?.includes('SameSite=Strict')
  && typeof cookie === 'string'
));

function authorizedHeaders(extra = {}) {
  return {
    Origin: BASE,
    Cookie: cookie,
    ...extra,
  };
}

async function post(path, body, headers = authorizedHeaders()) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function openSse() {
  const response = await fetch(`${BASE}/events`, { headers: authorizedHeaders() });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let running = true;
  const pump = (async () => {
    while (running) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventLine = frame.split('\n').find(line => line.startsWith('event: '));
        const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
        if (eventLine !== undefined && dataLine !== undefined) {
          events.push({
            event: eventLine.slice(7),
            data: JSON.parse(dataLine.slice(6)),
          });
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  })();
  return {
    events,
    async close() {
      running = false;
      await reader.cancel();
      await pump;
    },
  };
}

async function waitFor(find, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for test event');
}

try {
  const forbidden = await fetch(`${BASE}/status`);
  check('API requests without same-origin capability are forbidden', forbidden.status === 403);

  const crossOrigin = await fetch(`${BASE}/status`, {
    headers: { Cookie: cookie, Origin: 'https://example.invalid' },
  });
  check('cross-origin requests are forbidden', crossOrigin.status === 403);

  const status = await fetch(`${BASE}/status`, { headers: authorizedHeaders() });
  const statusBody = await status.json();
  check('authorized status starts empty', status.status === 200 && statusBody.pending === 0);

  await Promise.resolve().then(() => provider.ask({
    questions: [
      { id: 'duplicate', question: 'First?' },
      { id: 'duplicate', question: 'Second?' },
    ],
  })).then(
    () => check('duplicate question ids are rejected', false),
    () => check('duplicate question ids are rejected', true),
  );

  const sse = await openSse();
  const answerPromise = provider.ask({
    questions: [
      {
        id: 'database',
        question: 'Choose a database',
        options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }],
      },
      { id: 'reason', question: 'Why?' },
    ],
  });
  const question = await waitFor(() => sse.events.find(item => item.event === 'question')?.data);
  check('SSE receives the complete question batch', question.questions.length === 2);

  const missing = await post('/answer', {
    id: question.id,
    answers: [{ id: 'database', selected: ['PostgreSQL'] }],
  });
  check('partial answer batches are rejected', missing.status === 422);

  const reordered = await post('/answer', {
    id: question.id,
    answers: [
      { id: 'reason', selected: [], custom: 'Local use' },
      { id: 'database', selected: ['PostgreSQL'] },
    ],
  });
  check('reordered answers are rejected', reordered.status === 422);

  const invalidCustom = await post('/answer', {
    id: question.id,
    answers: [
      { id: 'database', selected: ['PostgreSQL'], custom: 'also custom' },
      { id: 'reason', selected: [], custom: 'Local use' },
    ],
  });
  check('single-select custom ambiguity is rejected', invalidCustom.status === 422);

  const accepted = await post('/answer', {
    id: question.id,
    answers: [
      { id: 'database', selected: ['PostgreSQL'] },
      { id: 'reason', selected: [], custom: 'Local use' },
    ],
  });
  const answer = await answerPromise;
  check('valid ordered answers resolve the provider', (
    accepted.status === 200
    && answer.answers[0].selected[0] === 'PostgreSQL'
    && answer.answers[1].custom === 'Local use'
  ));
  await sse.close();

  const controller = new AbortController();
  const aborted = provider.ask({
    questions: [{ id: 'abort', question: 'Abort?' }],
    signal: controller.signal,
  });
  controller.abort();
  await aborted.then(
    () => check('caller abort rejects the pending question', false),
    () => check('caller abort rejects the pending question', true),
  );

  const timedOut = provider.ask({
    questions: [{ id: 'timeout', question: 'Timeout?' }],
  });
  await timedOut.then(
    () => check('question timeout rejects the pending question', false),
    () => check('question timeout rejects the pending question', true),
  );

  const pendingAtDispose = provider.ask({
    questions: [{ id: 'dispose', question: 'Dispose?' }],
  }).then(() => false, () => true);
  await dispose();
  check('plugin disposal rejects pending questions', await pendingAtDispose);
  check('plugin disposal unregisters the provider', provider === undefined);
} finally {
  if (provider !== undefined) await dispose();
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} passed ===`);
if (passed !== results.length) process.exitCode = 1;
