const express = require('express');
const app = express();
const PORT = 3003;

const UPSTREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
    'Referer': 'https://clouddrifter.rpmvip.com/',
    'Origin': 'https://clouddrifter.rpmvip.com',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
};

// ---------------- HELPERS ----------------

function resolveUrl(base, relative) {
    try { return new URL(relative, base).href; }
    catch { return relative; }
}

function proxyUrl(req, targetUrl) {
    const base = `${req.protocol}://${req.get('host')}`;
    return `${base}/segment?url=${encodeURIComponent(targetUrl)}`;
}

function rewriteM3u8(text, baseUrl, req) {
    const baseHost = `${req.protocol}://${req.get('host')}`;

    return text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
            return trimmed.replace(/URI="([^"]+)"/, (m, uri) => {
                const resolved = resolveUrl(baseUrl, uri);
                return `URI="${proxyUrl(req, resolved)}"`;
            });
        }

        const resolved = resolveUrl(baseUrl, trimmed);

        if (resolved.endsWith('.txt') || resolved.includes('cf-master')) {
            return `${baseHost}/playlist?url=${encodeURIComponent(resolved)}`;
        }

        return proxyUrl(req, resolved);
    }).join('\n');
}

// ---------------- CORS ----------------

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---------------- PLAYLIST ----------------

app.get('/playlist', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing ?url=');

    try {
        const r = await fetch(url, { headers: UPSTREAM_HEADERS });

        if (!r.ok) return res.status(r.status).send('Upstream error');

        const text = await r.text();
        const rewritten = rewriteM3u8(text, url, req);

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(rewritten);

    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ---------------- SEGMENT ----------------

app.get('/segment', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing ?url=');

    try {
        const r = await fetch(url, { headers: UPSTREAM_HEADERS });

        if (!r.ok) return res.status(r.status).send('Upstream error');

        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const buf = await r.arrayBuffer();
        res.send(Buffer.from(buf));

    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ---------------- START ----------------

app.listen(PORT, () => {
    console.log(`Proxy running on http://localhost:${PORT}`);
});
