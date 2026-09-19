// Local HTTPS X fixture. See README.md in this directory for browser isolation.
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const certificateDirectory = process.argv[2];
if (!certificateDirectory) throw new Error('Pass the temporary certificate directory.');
const empty = () => ({ documents: 0, media: 0, drafts: 0, titles: [], unexpected: [] });
let state = empty();
const server = https.createServer({
  key: readFileSync(join(certificateDirectory, 'key.pem')),
  cert: readFileSync(join(certificateDirectory, 'cert.pem')),
}, async (request, response) => {
  const url = new URL(request.url, 'https://x.com');
  const json = (value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === '/__fixture_reset__') { state = empty(); return json(state); }
  if (url.pathname === '/__fixture_state__') return json(state);
  response.setHeader('access-control-allow-origin', 'https://x.com');
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-headers', 'authorization,content-type,x-csrf-token,x-twitter-active-user,x-twitter-auth-type,x-twitter-client-language');
  response.setHeader('access-control-allow-methods', 'POST');
  if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
  if (request.method === 'GET' && url.pathname === '/compose/articles') {
    state.documents++;
    response.writeHead(200, { 'content-type': 'text/html' });
    return response.end('<!doctype html><title>Isolated X fixture</title><link rel="icon" href="data:,"><h1>X Articles fixture</h1>');
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (request.method === 'POST' && url.pathname === '/i/media/upload.json') {
    if (url.searchParams.get('command') === 'INIT') {
      state.media++;
      return json({ media_id_string: `fixture-media-${state.media}` });
    }
    return json({});
  }
  if (request.method === 'POST' && /^\/i\/api\/graphql\/[^/]+\/ArticleEntityDraftCreate$/.test(url.pathname)) {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    state.drafts++;
    state.titles.push(body.variables?.title);
    return json({ data: { articleentity_create_draft: { article_entity_results: { result: { rest_id: `fixture-draft-${state.drafts}` } } } } });
  }
  state.unexpected.push(`${request.method} ${url.pathname}`);
  return json({ error: 'Unexpected fixture request' }, 404);
});
server.listen(18443, '127.0.0.1', () => console.log('Local X fixture listening on 127.0.0.1:18443'));
