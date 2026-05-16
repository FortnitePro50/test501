/**
 * clouddrifter-proxy.js
 *
 * Proxies HLS streams from syd.halcyoninnovation.cfd (clouddrifter.rpmvip.com)
 * The site disguises:
 *   - M3U8 playlists as  .txt  files
 *   - MPEG-TS segments  as  .woff2  files
 *
 * Usage:
 *   node clouddrifter-proxy.js
 *
 * VLC / any player:
 *   http://YOUR_VPS_IP:3003/playlist?url=<master_txt_url>
 */

const express = require('express');
const app     = express();
const PORT    = 80;

// ─── Upstream request headers ─────────────────────────────────────────────────
const UPSTREAM_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://clouddrifter.rpmvip.com/',
    'Origin':          'https://clouddrifter.rpmvip.com',
    'Accept':          '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',  // raw bytes, not gzip — critical for TS segments
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveUrl(base, relative) {
    try { return new URL(relative, base).href; }
    catch { return relative; }
}

function buildBase(req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    return `${proto}://${host}`;
}

function segmentProxyUrl(base, targetUrl) {
    return `${base}/segment?url=${encodeURIComponent(targetUrl)}`;
}

function playlistProxyUrl(base, targetUrl) {
    return `${base}/playlist?url=${encodeURIComponent(targetUrl)}`;
}

function isSubPlaylist(url) {
    const u = url.toLowerCase().split('?')[0];
    return (
        u.endsWith('.m3u8') ||
        u.endsWith('.txt')  ||
        u.includes('cf-master') ||
        u.includes('index-f') ||
        /\/playlist\b/.test(u)
    );
}

function rewriteM3u8(text, baseUrl, base) {
    return text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Tag lines — rewrite any URI="..." values
        if (trimmed.startsWith('#')) {
            return trimmed.replace(/URI="([^"]+)"/gi, (_, uri) => {
                const resolved = resolveUrl(baseUrl, uri);
                const proxied  = isSubPlaylist(resolved)
                    ? playlistProxyUrl(base, resolved)
                    : segmentProxyUrl(base, resolved);
                return `URI="${proxied}"`;
            });
        }

        if (trimmed.startsWith('data:') || trimmed.startsWith('//')) return line;

        // URI lines (segments / sub-playlists)
        const resolved = resolveUrl(baseUrl, trimmed);
        return isSubPlaylist(resolved)
            ? playlistProxyUrl(base, resolved)
            : segmentProxyUrl(base, resolved);
    }).join('\n');
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin',   '*');
    res.setHeader('Access-Control-Allow-Headers',  '*');
    res.setHeader('Access-Control-Allow-Methods',  'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET|HEAD /playlist?url=<m3u8_url>
// ─────────────────────────────────────────────────────────────────────────────
app.all('/playlist', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing ?url=');

    // VLC probes with HEAD first
    if (req.method === 'HEAD') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendStatus(200);
    }

    try {
        console.log(`[Playlist] ${url}`);
        const r = await fetch(url, { headers: UPSTREAM_HEADERS });

        if (!r.ok) {
            console.error(`[Playlist] upstream ${r.status}`);
            return res.status(r.status).send(`Upstream error ${r.status}`);
        }

        const text      = await r.text();
        const base      = buildBase(req);
        const rewritten = rewriteM3u8(text, url, base);
        const buf       = Buffer.from(rewritten, 'utf8');

        res.setHeader('Content-Type',   'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control',  'no-cache, no-store');
        res.setHeader('Content-Length', buf.length);
        res.send(buf);
    } catch (err) {
        console.error('[Playlist]', err.message);
        res.status(500).send(err.message);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET|HEAD /segment?url=<ts_url>
// ─────────────────────────────────────────────────────────────────────────────
app.all('/segment', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing ?url=');

    if (req.method === 'HEAD') {
        res.setHeader('Content-Type',  'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendStatus(200);
    }

    try {
        const fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        console.log(`[Segment ] ${fileName}`);

        const upstreamHeaders = { ...UPSTREAM_HEADERS };
        if (req.headers.range) {
            upstreamHeaders['Range'] = req.headers.range;  // forward Range for VLC seeking
        }

        const r = await fetch(url, { headers: upstreamHeaders });

        if (!r.ok && r.status !== 206) {
            console.error(`[Segment ] upstream ${r.status}`);
            return res.status(r.status).send(`Upstream error ${r.status}`);
        }

        res.setHeader('Content-Type',  'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const cl = r.headers.get('content-length');
        const cr = r.headers.get('content-range');
        if (cl) res.setHeader('Content-Length', cl);
        if (cr) res.setHeader('Content-Range',  cr);

        const statusCode = cr ? 206 : 200;

        // Stream directly to avoid buffering large segments in memory
        if (r.body && typeof r.body.pipe === 'function') {
            res.status(statusCode);
            r.body.pipe(res);
        } else {
            const buf = Buffer.from(await r.arrayBuffer());
            if (!cl) res.setHeader('Content-Length', buf.length);
            res.status(statusCode).send(buf);
        }
    } catch (err) {
        console.error('[Segment ]', err.message);
        res.status(500).send(err.message);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n${'═'.repeat(56)}`);
    console.log(` CloudDrifter HLS Proxy  —  port ${PORT}`);
    console.log(`${'═'.repeat(56)}`);
    console.log(`  Playlist  →  http://localhost:${PORT}/playlist?url=<m3u8_url>`);
    console.log(`  Segment   →  http://localhost:${PORT}/segment?url=<seg_url>`);
    console.log(`${'═'.repeat(56)}\n`);
});
