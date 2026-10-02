// Local HTTPS X fixture. See README.md in this directory for browser isolation.
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const certificateDirectory = process.argv[2];
if (!certificateDirectory) throw new Error('Pass the temporary certificate directory.');
const empty = () => ({ documents: 0, media: 0, drafts: 0, titles: [], covers: [], blocked: 0, unexpected: [] });
// What X's firewall returns for a create request whose body it refuses.
const FIREWALL_PAGE = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><p>Cloudflare Ray ID: fixture</p></body></html>';
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
    const raw = Buffer.concat(chunks).toString();
    // The one body pattern observed to trigger the firewall: a command piped into a shell.
    if (/\|\s*sh\b/.test(raw)) {
      state.blocked++;
      response.writeHead(403, { 'content-type': 'text/html' });
      return response.end(FIREWALL_PAGE);
    }
    const body = JSON.parse(raw);
    state.drafts++;
    state.titles.push(body.variables?.title);
    return json({ data: { articleentity_create_draft: { article_entity_results: { result: { rest_id: `fixture-draft-${state.drafts}` } } } } });
  }
  if (request.method === 'POST' && /^\/i\/api\/graphql\/[^/]+\/ArticleEntityUpdateCoverMedia$/.test(url.pathname)) {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    state.covers.push([body.variables?.articleEntityId, body.variables?.coverMedia?.media_id]);
    return json({ data: { articleentity_update_cover_media: { article_entity_results: { result: { rest_id: body.variables?.articleEntityId } } } } });
  }
  state.unexpected.push(`${request.method} ${url.pathname}`);
  return json({ error: 'Unexpected fixture request' }, 404);
});
server.listen(18443, '127.0.0.1', () => console.log('Local X fixture listening on 127.0.0.1:18443'));
