/**
 * Keyless MemoryCore client smoke with local protocol fixtures.
 */
import { createServer } from 'node:http';
import { createMemoryClient } from './memory-client.mjs';

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

let requests = 0;
const observedKeys = [];
const gateway = createServer(async (request, response) => {
  requests += 1;
  const body = await bodyOf(request);
  observedKeys.push({
    header: request.headers['x-tdai-user-key'],
    body: body.user_key,
  });
  const records = {
    '/v3/meta/auth/verify': { valid: true, user: { user_id: 'user-1' } },
    '/v3/meta/team/list': { items: [{ team_id: 'team-1', name: 'Team' }] },
    '/v3/meta/agent/list': { items: [{ agent_id: 'agent-1', name: 'Agent' }] },
    '/v3/meta/task/list': { items: [{ task_id: 'task-1', title: 'Task' }] },
    '/v3/meta/agent/get': { agent_id: 'agent-1', name: 'Agent' },
    '/v3/meta/task/get': { task_id: 'task-1', title: 'Task' },
    '/v3/meta/participation-log/append': { stored: true },
  };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ code: 0, data: records[request.url] }));
});

let redirectTargetRequests = 0;
const redirectTarget = createServer((_request, response) => {
  redirectTargetRequests += 1;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ code: 0, data: { valid: true } }));
});
const redirectTargetPort = await listen(redirectTarget);
const redirector = createServer((_request, response) => {
  response.writeHead(302, {
    Location: `http://127.0.0.1:${redirectTargetPort}/credential-target`,
  });
  response.end();
});

const gatewayPort = await listen(gateway);
const redirectPort = await listen(redirector);
let credential = 'first:special#credential';
const client = createMemoryClient({
  endpoint: `http://127.0.0.1:${gatewayPort}`,
  serviceId: 'fixture',
  resolveUserKey: async () => credential,
});

try {
  check('verifyAuth', (await client.verifyAuth()).valid === true);
  check('listTeams', (await client.listTeams())[0].team_id === 'team-1');
  check('listAgents', (await client.listAgents('team-1'))[0].agent_id === 'agent-1');
  check('listTasks', (await client.listTasks('team-1'))[0].task_id === 'task-1');
  check('getAgent', (await client.getAgent('agent-1')).agent_id === 'agent-1');
  check('getTask', (await client.getTask('task-1')).task_id === 'task-1');
  check('appendParticipationLog', (await client.appendParticipationLog({})).stored === true);
  check(
    'special credential stays intact',
    observedKeys.every(value => value.header === credential && value.body === credential),
  );

  credential = 'rotated-credential';
  await client.verifyAuth();
  check(
    'credential rotation affects next request',
    observedKeys.at(-1).header === credential && observedKeys.at(-1).body === credential,
  );

  const beforeMissing = requests;
  const missing = createMemoryClient({
    endpoint: `http://127.0.0.1:${gatewayPort}`,
    resolveUserKey: async () => undefined,
  });
  await missing.verifyAuth().then(
    () => check('missing credential rejects', false),
    error => check(
      'missing credential rejects before network access',
      error.message === 'memory credential is unavailable' && requests === beforeMissing,
    ),
  );

  const redirecting = createMemoryClient({
    endpoint: `http://127.0.0.1:${redirectPort}`,
    resolveUserKey: async () => 'redirect-credential',
  });
  await redirecting.verifyAuth().then(
    () => check('redirect rejects', false),
    () => check('redirect rejects without target contact', redirectTargetRequests === 0),
  );

  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  await client.verifyAuth({ signal: controller.signal }).then(
    () => check('caller cancellation rejects', false),
    error => check('caller cancellation is distinct', error.message === 'memory request was cancelled'),
  );
} finally {
  await Promise.all([close(gateway), close(redirector), close(redirectTarget)]);
}

const passed = checks.filter(result => result.ok).length;
console.log(`\n=== ${passed}/${checks.length} passed ===`);
process.exitCode = passed === checks.length ? 0 : 1;
