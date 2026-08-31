/**
 * memory-client 自测 —— 调真实 Gateway 验证 7 个方法。
 * 跑法：node examples/headless-dashboard/test-memory-client.mjs
 */
import { createMemoryClient, loadUserKey } from './memory-client.mjs';

const userKey = loadUserKey();
console.log('user_key loaded: prefix=' + userKey.slice(0, 15) + '... len=' + userKey.length);

const client = createMemoryClient({ userKey });
const checks = [];
const check = (name, cond) => { checks.push({ name, ok: !!cond }); console.log((cond ? '✓ ' : '✗ ') + name); };

// 1. verifyAuth
const auth = await client.verifyAuth();
check('verifyAuth returns valid=true with user_id', auth.valid === true && !!auth.user?.user_id);
console.log('  user_id=' + auth.user?.user_id + ' type=' + auth.user?.user_type);

// 2. listTeams
const teams = await client.listTeams();
check('listTeams returns array with >=1 team', Array.isArray(teams) && teams.length >= 1);
console.log('  teams=' + teams.map(t => t.team_id + ':' + t.name).join(', '));

// 3. listAgents (用第一个 team)
const teamId = teams[0].team_id;
const agents = await client.listAgents(teamId);
check('listAgents returns array with >=1 agent', Array.isArray(agents) && agents.length >= 1);
console.log('  agents=' + agents.map(a => a.agent_id + ':' + a.name).join(', '));

// 4. listTasks
const tasks = await client.listTasks(teamId);
check('listTasks returns array', Array.isArray(tasks));
console.log('  tasks=' + tasks.map(t => t.task_id + ':' + t.title).join(', '));

// 5. getAgent (第一个 agent)
const agent = await client.getAgent(agents[0].agent_id);
check('getAgent returns entity with agent_id', !!agent?.agent_id);
console.log('  agent.prompt=' + (agent.prompt ? agent.prompt.slice(0, 50) + '...' : '(none)'));

// 6. getTask (如果有 task)
if (tasks.length > 0) {
  const task = await client.getTask(tasks[0].task_id);
  check('getTask returns entity with task_id', !!task?.task_id);
  console.log('  task.description=' + (task.description ? task.description.slice(0, 50) + '...' : '(none)'));
} else {
  check('getTask skipped (no tasks)', true);
}

// 7. appendParticipationLog（不实际写入，只验证签名/连接——用假 id 期望 Gateway 报错而非网络错误）
try {
  await client.appendParticipationLog({
    team_id: 'fake-team',
    task_id: 'fake-task',
    agent_id: 'fake-agent',
    user_id: auth.user.user_id,
    source: 'native-plugin:test',
  });
  check('appendParticipationLog reached Gateway (no throw)', true);
} catch (e) {
  // 预期 Gateway 会因 fake id 报错，但能拿到 Gateway 的错误响应说明连接 OK
  const reachable = /Gateway.*error/i.test(e.message) || /code=/.test(e.message);
  check('appendParticipationLog reached Gateway (got structured error)', reachable);
  console.log('  expected error: ' + e.message.slice(0, 100));
}

const passed = checks.filter(c => c.ok).length;
console.log(`\n=== ${passed}/${checks.length} passed ===`);
process.exit(passed === checks.length ? 0 : 1);
