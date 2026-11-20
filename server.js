const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { URL } = require('url');

const PORT = process.env.PORT || 10000;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
}

function handleProxy(req, res, targetUrl) {
  let activeReq = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (activeReq) {
      try { activeReq.destroy(); } catch (_) {}
      activeReq = null;
    }
  };

  const follow = (currentUrl, redirectsLeft = 5) => {
    if (closed) return;

    if (redirectsLeft <= 0) {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Çok fazla yönlendirme');
      }
      return cleanup();
    }

    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch (_) {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Geçersiz yayın adresi');
      }
      return cleanup();
    }

    const client = parsed.protocol === 'https:' ? https : http;

    activeReq = client.get(parsed, (upstreamRes) => {
      if (closed) {
        upstreamRes.resume();
        return;
      }

      const isRedirect =
        [301, 302, 303, 307, 308].includes(upstreamRes.statusCode) &&
        upstreamRes.headers.location;

      if (isRedirect) {
        upstreamRes.resume();
        const nextUrl = new URL(upstreamRes.headers.location, parsed).toString();
        return follow(nextUrl, redirectsLeft - 1);
      }

      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(upstreamRes.statusCode || 200, {
          'Content-Type': upstreamRes.headers['content-type'] || 'audio/mpeg',
          'Cache-Control': 'no-cache, no-store',
          'Connection': 'keep-alive'
        });
      }

      upstreamRes.on('error', cleanup);
      upstreamRes.pipe(res);
    });

    activeReq.on('error', () => {
      if (!closed && !res.headersSent && !res.writableEnded) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Yayın kaynağına bağlanılamadı');
      }
      cleanup();
    });
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);

  follow(targetUrl);
}

function handleTranscode(req, res, targetUrl, bitrate) {
  const allowedBitrates = ['12k', '24k', '32k', '48k'];
  const safeBitrate = allowedBitrates.includes(bitrate) ? bitrate : '32k';

  if (!res.headersSent && !res.writableEnded) {
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive'
    });
  }

  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-i', targetUrl,
    '-vn',
    '-ac', '1',
    '-ar', '22050',
    '-b:a', safeBitrate,
    '-f', 'mp3',
    'pipe:1'
  ]);

  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    try {
      ffmpeg.stdout.removeAllListeners();
      ffmpeg.stderr.removeAllListeners();
      ffmpeg.removeAllListeners();
      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) ffmpeg.stdin.destroy();
      if (ffmpeg.stdout && !ffmpeg.stdout.destroyed) ffmpeg.stdout.destroy();
      if (ffmpeg.stderr && !ffmpeg.stderr.destroyed) ffmpeg.stderr.destroy();
      ffmpeg.kill('SIGKILL');
    } catch (_) {}

    if (!res.writableEnded && !res.destroyed) {
      try { res.end(); } catch (_) {}
    }
  };

  ffmpeg.stderr.resume();

  ffmpeg.stdout.on('data', (chunk) => {
    if (cleaned || res.writableEnded || res.destroyed) return;
    const ok = res.write(chunk);
    if (!ok) {
      ffmpeg.stdout.pause();
      res.once('drain', () => {
        if (!cleaned && !ffmpeg.stdout.destroyed) {
          ffmpeg.stdout.resume();
        }
      });
    }
  });

  ffmpeg.stdout.on('end', cleanup);
  ffmpeg.on('error', cleanup);
  ffmpeg.on('close', cleanup);

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
}

http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Geçersiz istek');
  }

  const streamUrl = parsedUrl.searchParams.get('url');
  const bitrate = parsedUrl.searchParams.get('br');

  if (!streamUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Radyo Sunucusu Aktif');
  }

  if (bitrate) {
    return handleTranscode(req, res, streamUrl, bitrate);
  }

  return handleProxy(req, res, streamUrl);
}).listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
