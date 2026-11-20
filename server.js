const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const url = require('url');

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query;
  const streamUrl = query.url;
  const bitrate = query.br;

  if (!streamUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Radyo Proxy ve Sıkıştırma Sunucusu Aktif!');
  }

  // 1. DURUM: BR YOK -> YÖNLENDİRME DESTEKLİ DİREKT PROXY (ORİJİNAL KALİTE)
  if (!bitrate) {
    let activeProxyReq = null;
    let closed = false;

    function cleanupProxy() {
      if (closed) return;
      closed = true;
      if (activeProxyReq) {
        try { activeProxyReq.destroy(); } catch (e) {}
        activeProxyReq = null;
      }
    }

    function fetchWithRedirects(targetUrl, maxRedirects = 5) {
      if (closed) return;
      if (maxRedirects <= 0) {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Çok fazla yönlendirme (Redirect loop)');
        }
        return;
      }

      const lib = targetUrl.startsWith('https') ? https : http;

      activeProxyReq = lib.get(targetUrl, (proxyRes) => {
        if (closed) {
          proxyRes.resume();
          return;
        }

        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
          proxyRes.resume();
          let redirectUrl = proxyRes.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsedBase = new URL(targetUrl);
            redirectUrl = `${parsedBase.protocol}//${parsedBase.host}${redirectUrl}`;
          }
          return fetchWithRedirects(redirectUrl, maxRedirects - 1);
        }

        if (!res.headersSent && !res.writableEnded) {
          let contentType = proxyRes.headers['content-type'] || 'audio/mpeg';
          if (targetUrl.includes('.m3u8')) contentType = 'application/vnd.apple.mpegurl';
          else if (targetUrl.includes('.ts')) contentType = 'video/mp2t';

          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        proxyRes.pipe(res);
      });

      activeProxyReq.on('error', () => {
        if (!closed && !res.headersSent && !res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Proxy bağlantı hatası');
        }
      });
    }

    fetchWithRedirects(streamUrl);

    req.on('close', cleanupProxy);
    res.on('close', cleanupProxy);

    return;
  }

  // 2. DURUM: BR VAR -> VERİ TASARRUFU İÇİN FFMPEG İLE SIKIŞTIRMA
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '1',
    '-i', streamUrl,
    '-vn',
    '-ac', '1',
    '-ar', '22050',
    '-b:a', bitrate,
    '-f', 'mp3',
    'pipe:1'
  ]);

  let cleanedUp = false;
  let lastDataTime = Date.now();

  const stallWatchdog = setInterval(() => {
    if (Date.now() - lastDataTime > 20000) {
      cleanup('FFmpeg veri akışı durdu');
    }
  }, 5000);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(stallWatchdog);

    try {
      ffmpeg.stdout.removeAllListeners();
      ffmpeg.stderr.removeAllListeners();
      ffmpeg.removeAllListeners();
      if (ffmpeg.stdout && !ffmpeg.stdout.destroyed) ffmpeg.stdout.destroy();
      if (ffmpeg.stderr && !ffmpeg.stderr.destroyed) ffmpeg.stderr.destroy();
      ffmpeg.kill('SIGKILL');
    } catch (e) {}

    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch (e) {}
    }
  }

  ffmpeg.stdout.on('data', (chunk) => {
    lastDataTime = Date.now();
    if (!cleanedUp && !res.writableEnded && !res.destroyed) {
      const canWrite = res.write(chunk);
      if (!canWrite) {
        ffmpeg.stdout.pause();
        res.once('drain', () => {
          if (!cleanedUp && !ffmpeg.stdout.destroyed) ffmpeg.stdout.resume();
        });
      }
    }
  });

  ffmpeg.stdout.on('end', cleanup);
  ffmpeg.stderr.resume();

  ffmpeg.on('error', cleanup);
  ffmpeg.on('close', cleanup);

  req.on('close', cleanup);
  res.on('close', cleanup);

}).listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
