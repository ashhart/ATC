import { exact, isKey, requireValue } from './values.js';
import { helpView } from './collaborationView.js';
import { readWebJson, jsonResponse } from './webIo.js';

export function agentCard(origin) {
  return { protocolVersion: '0.3.0', name: 'Agent Traffic Control', description: 'Inspect existing cooperative help tasks and commit-specific receipts.',
    url: `${origin}/api/exchange/v1/a2a`, preferredTransport: 'JSONRPC', version: '0.9.5',
    capabilities: { streaming: false, pushNotifications: false,
      extensions: [{ uri: 'https://github.com/ashhart/ATC/blob/main/docs/collaboration.md#a2a', required: true,
        description: 'Read-only inspection of existing ATC requests. Does not execute tasks or transfer claims.' }] },
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, security: [{ bearer: [] }],
    defaultInputModes: ['application/json'], defaultOutputModes: ['application/json'],
    skills: [{ id: 'inspect', name: 'Inspect help task', description: 'Send a data part with a request identifier to inspect its state.', tags: ['review', 'test', 'collaboration'] }] };
}

export async function a2aTask(request, { session, store, github, now }) {
  const input = await readWebJson(request);
  const validId = value => Number.isSafeInteger(value) || typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
  const id = validId(input?.id) ? input.id : null;
  const error = (code, message) => jsonResponse({ jsonrpc: '2.0', id, error: { code, message } });
  if (!exact(input, { jsonrpc: x => x === '2.0', id: validId,
    method: x => typeof x === 'string' && x.length <= 64 && /^[A-Za-z]+\/[A-Za-z]+$/.test(x), params: x => x && typeof x === 'object' && !Array.isArray(x) })) {
    return error(-32600, 'Invalid request.');
  }
  if (!['tasks/get', 'tasks/cancel', 'message/send'].includes(input.method)) return error(-32601, 'Method not found.');
  let task;
  if (input.method === 'message/send') {
    const message = input.params.message;
    const valid = exact(input.params, { message: x => exact(x, { kind: y => y === 'message', role: y => y === 'user',
      messageId: y => typeof y === 'string' && y.length > 0 && y.length <= 128 && /^[A-Za-z0-9_-]+$/.test(y), parts: y => Array.isArray(y) && y.length === 1
        && exact(y[0], { kind: z => z === 'data', data: z => exact(z, { request: isKey }) }) }) });
    if (!valid) return error(-32602, 'Invalid params.');
    task = message.parts[0].data.request;
  } else {
    if (!exact(input.params, { id: isKey }) && !exact(input.params, { id: isKey, historyLength: x => x === 0 })) return error(-32602, 'Invalid params.');
    task = input.params.id;
  }
  const found = store.inbox(session.pull).find(x => x.id === task);
  if (!found) return error(-32001, 'Task not found.');
  if (input.method === 'tasks/cancel') return error(-32002, 'Task cannot be canceled.');
  const current = await github.pull(session.pull), view = helpView(store, found, current, now());
  const state = { available: 'submitted', running: 'working', passed: 'completed', failed: 'failed',
    closed: 'canceled', stale: 'input-required', expired: 'input-required', selfReview: 'input-required',
    blocked: 'input-required', inconclusive: 'input-required', reported: 'input-required' }[view.state];
  requireValue(state, 'storage', 503);
  return jsonResponse({ jsonrpc: '2.0', id, result: { id: task, contextId: String(session.pull), kind: 'task',
    status: { state, timestamp: new Date(now()).toISOString() },
    artifacts: [{ artifactId: task, parts: [{ kind: 'data', data: view }] }] } });
}
