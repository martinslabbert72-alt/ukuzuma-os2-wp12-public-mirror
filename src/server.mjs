import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const SITE_ID = process.env.SITE_ID || 'UNSET';
const LAB_TOKEN = process.env.LAB_TOKEN || 'UNSET';
const PORT = Number(process.env.PORT || 3000);
const RELEASE = process.env.RELEASE_ID || 'wp12-site-0.1.0';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const RELEASE_DIGEST = digest(`${RELEASE}|${process.env.SOURCE_DIGEST || 'source'}`);

function send(res, status, body) {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {'content-type':'application/json','content-length':Buffer.byteLength(text)});
  res.end(text);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function authorized(req) {
  return req.headers['x-wp12-token'] === LAB_TOKEN && LAB_TOKEN !== 'UNSET';
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, {status:'PASS', siteId:SITE_ID, release:RELEASE, releaseDigest:RELEASE_DIGEST, instanceId:INSTANCE_ID, bootedAt:BOOTED_AT});
  }
  if (!authorized(req)) return send(res, 401, {status:'DENY', code:'AUTH_REQUIRED'});

  if (req.method === 'POST' && req.url === '/crash') {
    send(res, 202, {status:'CRASHING', siteId:SITE_ID});
    setTimeout(() => process.exit(77), 100);
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    try {
      const work = await readJson(req);
      if (!work.workId || !work.effectKey || !Number.isInteger(work.epoch) || !work.leaderSite) {
        return send(res, 400, {status:'DENY', code:'WORK_ENVELOPE_INVALID'});
      }
      if (work.leaderSite !== SITE_ID) return send(res, 409, {status:'DENY', code:'NOT_CURRENT_LEADER', siteId:SITE_ID});
      const resultDigest = digest(JSON.stringify({workId:work.workId,payload:work.payload || null,epoch:work.epoch}));
      return send(res, 200, {status:'COMPLETE', siteId:SITE_ID, workId:work.workId, effectKey:work.effectKey, epoch:work.epoch, resultDigest});
    } catch (error) {
      return send(res, 400, {status:'DENY', code:error.code || 'REQUEST_INVALID'});
    }
  }
  return send(res, 404, {status:'NOT_FOUND'});
});

server.listen(PORT, '0.0.0.0', () => console.log(JSON.stringify({event:'WP12_SITE_READY',siteId:SITE_ID,port:PORT,releaseDigest:RELEASE_DIGEST})));
