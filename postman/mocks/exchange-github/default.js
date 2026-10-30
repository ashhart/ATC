const http = require('node:http');
const crypto = require('node:crypto');

const repository = 'example/project';
const origin = 'https://exchange.example.org';
const secret = '1'.padStart(64, '0');
const proof = crypto.createHash('sha256').update(`atc-exchange-v1\n${origin}\n${repository}\n42\n${secret}`).digest('hex');
function file(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') };
}
http.createServer((request, response) => {
  const base = `/repos/${repository}`;
  let value;
  if (request.method === 'GET' && request.url === `${base}/contents/.github/atc.json`) value = file({});
  if (request.method === 'GET' && request.url === `${base}/contents/.github/atc-exchange.json`) {
    value = file({ version: 1, origin, retentionHours: 1 });
  }
  if (request.method === 'GET' && request.url === base) value = { private: false };
  if (request.method === 'GET' && request.url === `${base}/pulls/42`) {
    value = { number: 42, head: { sha: 'a'.repeat(40) }, state: 'open', base: { repo: { full_name: repository } } };
  }
  if (request.method === 'GET' && request.url === `${base}/issues/comments/101`) {
    value = { id: 101, issue_url: `https://api.github.com${base}/issues/42`, body: `/atc exchange ${proof}`,
      user: { id: 1, login: 'example-user', type: 'User' }, created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' };
  }
  response.writeHead(value === undefined ? 501 : 200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value ?? { message: 'Not implemented in this simulation' }));
}).listen(process.env.PORT);
