/**
 * clouddrifter-proxy-nocors.js
 * 
 * Lightweight proxy — only rewrites playlists, segments go DIRECT.
 * Works perfectly in VLC (no CORS enforcement).
 * Zero bandwidth used for segments.
 * 
 * Usage:
 *   node clouddrifter-proxy-nocors.js
 *   
 * Then in VLC:
 *   http://localhost:3003/playlist?url=https://sxd.novaqueststudio.cyou/v4/xy/kyx9ax/cf-master.1778959912.txt
 */

const express = require('express');
const app = express();
const PORT = 80;

const UPSTREAM_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Referer':         'https://clouddrifter.rpmvip.com/',
  'Origin':          'https://clouddrifter.rpmvip.com',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function resolveUrl(base, relative) {
  try { return new URL(relative, base).href; }
  catch { return relative; }
}

function isPlaylist(url) {
  return url.endsWith('.txt') || url.endsWith('.m3u8') || /cf-master|index-f|\.m3u/.test(url);
}

function rewrite(text, base, proxyOrigin) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;

    if (t.startsWith('#')) {
      // URI tags — playlists go through proxy, segments go direct
      return t.replace(/URI="([^"]+)"/g, (_, u) => {
        const resolved = resolveUrl(base, u);
        if (isPlaylist(resolved)) {
          return `URI="${proxyOrigin}/playlist?url=${encodeURIComponent(resolved)}"`;
        }
        // Segment direct — no proxy
        return `URI="${resolved}"`;
      });
    }

    const resolved = resolveUrl(base, t);

    if (isPlaylist(resolved)) {
      return `${proxyOrigin}/playlist?url=${encodeURIComponent(resolved)}`;
    }

    // Segment goes DIRECT to upstream — VLC handles it fine
    return resolved;
  }).join('\n');
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/playlist', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing ?url=');

  try {
    const r = await fetch(url, { headers: UPSTREAM_HEADERS });
    if (!r.ok) return res.status(r.status).send(`Upstream ${r.status}`);

    const proxyOrigin = `${req.protocol}://${req.get('host')}`;
    const text = rewrite(await r.text(), url, proxyOrigin);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(text);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`\nClouddrifter Proxy (no-cors mode) — port ${PORT}`);
  console.log(`Playlists proxied, segments go DIRECT`);
  console.log(`http://localhost:${PORT}/playlist?url=<cf-master-url>\n`);
});
