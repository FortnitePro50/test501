/**
 * clean-hls-proxy.js
 * VLC + browser compatible HLS proxy
 */

const express = require("express");
const app = express();
const PORT = 80;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://clouddrifter.rpmvip.com/",
  Origin: "https://clouddrifter.rpmvip.com",
};

// -----------------------------
// UTIL
// -----------------------------
function resolve(base, url) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// -----------------------------
// PLAYLIST PROXY (NO OVER-REWRITE)
// -----------------------------
app.get("/playlist", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");

  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return res.status(500).send("Upstream error");

    let text = await r.text();

    const base = url;

    // ONLY fix segment URLs, keep VLC happy
    text = text
      .split("\n")
      .map((line) => {
        const l = line.trim();

        // ignore tags
        if (!l || l.startsWith("#")) return line;

        const abs = resolve(base, l);

        // proxy EVERYTHING through segment endpoint
        return `${req.protocol}://${req.get("host")}/segment?url=${encodeURIComponent(
          abs
        )}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache");
    res.send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// -----------------------------
// SEGMENT PROXY (VLC FRIENDLY)
// -----------------------------
app.get("/segment", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");

  try {
    const range = req.headers.range;

    const r = await fetch(url, {
      headers: {
        ...HEADERS,
        Range: range || "",
      },
    });

    if (!r.ok && r.status !== 206) {
      return res.status(r.status).send("Segment error");
    }

    res.status(r.status);

    // IMPORTANT: VLC expects TS
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (r.headers.get("content-range")) {
      res.setHeader("Content-Range", r.headers.get("content-range"));
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// -----------------------------
// SIMPLE VLC TEST PAGE
// -----------------------------
app.get("/", (req, res) => {
  res.send(`
<!doctype html>
<html>
<body style="background:#111;color:#fff;font-family:Arial;padding:20px">
<h2>HLS Proxy (VLC Ready)</h2>

<input id="u" style="width:80%" placeholder="paste m3u8 (.txt) url"/>
<button onclick="go()">Play</button>

<p>Use in VLC:</p>
<code>http://localhost:${PORT}/playlist?url=YOUR_URL</code>

<script>
function go(){
  const u = document.getElementById('u').value;
  window.location.href = '/playlist?url=' + encodeURIComponent(u);
}
</script>

</body>
</html>
  `);
});

// -----------------------------
app.listen(PORT, () => {
  console.log("HLS Proxy running on", PORT);
});
