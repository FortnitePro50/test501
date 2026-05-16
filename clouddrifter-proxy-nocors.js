const express = require('express');
const app = express();
const PORT = 80;

const UPSTREAM = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Referer':         'https://clouddrifter.rpmvip.com/',
  'Origin':          'https://clouddrifter.rpmvip.com',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/playlist', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing ?url=');

  try {
    const r = await fetch(target, { headers: UPSTREAM });
    if (!r.ok) return res.status(r.status).send(`Upstream ${r.status}`);

    const origin = `${req.protocol}://${req.get('host')}`;
    const text = rewrite(await r.text(), target, origin);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(text);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.head('/segment', (req, res) => {
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendStatus(200);
});

app.get('/segment', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing ?url=');

  try {
    const r = await fetch(target, { headers: UPSTREAM });
    if (!r.ok) return res.status(r.status).send(`Upstream ${r.status}`);

    const buf = await r.arrayBuffer();
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', buf.byteLength);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

function isPlaylist(url) {
  return url.endsWith('.txt') || url.endsWith('.m3u8') || /cf-master|index-f|\.m3u/.test(url);
}

function rewrite(text, base, origin) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;

    if (t.startsWith('#')) {
      return t.replace(/URI="([^"]+)"/g, (_, u) => {
        const resolved = resolve(base, u);
        const route = isPlaylist(resolved) ? 'playlist' : 'segment';
        return `URI="${origin}/${route}?url=${encodeURIComponent(resolved)}"`;
      });
    }

    const url = resolve(base, t);
    const route = isPlaylist(url) ? 'playlist' : 'segment';
    return `${origin}/${route}?url=${encodeURIComponent(url)}`;
  }).join('\n');
}

function resolve(base, rel) {
  try { return new URL(rel, base).href; }
  catch { return rel; }
}

app.listen(PORT, () => {
  console.log(`\nClouddrifter Express Proxy — port ${PORT}`);
  console.log(`http://localhost:${PORT}/playlist?url=<cf-master-url>\n`);
});
