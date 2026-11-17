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

  // 1. DURUM: BR YOK -> PROXY MODU (.m3u8 ve .ts dosyaları için akıllı yönlendirme)
  if (!bitrate) {
    let activeProxyReq = null;

    function fetchWithRedirects(targetUrl, maxRedirects = 5) {
      if (maxRedirects <= 0) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Redirect loop');
        }
        return;
      }

      const lib = targetUrl.startsWith('https') ? https : http;

      activeProxyReq = lib.get(targetUrl, (proxyRes) => {
        // Yönlendirmeleri takip et
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
          proxyRes.resume();
          let redirectUrl = proxyRes.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsedBase = new URL(targetUrl);
            redirectUrl = `${parsedBase.protocol}//${parsedBase.host}${redirectUrl}`;
          }
          return fetchWithRedirects(redirectUrl, maxRedirects - 1);
        }

        if (!res.headersSent) {
          // HLS uzantıları için doğru içerik türlerini (Content-Type) koru
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
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Proxy bağlantı hatası');
        }
      });
    }

    fetchWithRedirects(streamUrl);

    req.on('close', () => {
      if (activeProxyReq) activeProxyReq.destroy();
    });

    return;
  }

  // 2. DURUM: BR VAR -> FFMPEG İLE SIKIŞTIRMA
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

  ffmpeg.stdout.pipe(res);

  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });

  ffmpeg.on('error', () => {});

}).listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
