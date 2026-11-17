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
  const bitrate = query.br; // Eğer br parametresi yoksa undefined dönecek

  if (!streamUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Radyo Proxy ve Sıkıştırma Sunucusu Aktif!');
  }

  // 1. DURUM: BR (Bitrate) belirtilmediyse -> YÖNLENDİRME DESTEKLİ DİREKT PROXY (ORİJİNAL KALİTE)
  if (!bitrate) {
    let activeProxyReq = null;

    function fetchWithRedirects(targetUrl, maxRedirects = 5) {
      if (maxRedirects <= 0) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Çok fazla yönlendirme (Redirect loop)');
        }
        return;
      }

      const lib = targetUrl.startsWith('https') ? https : http;

      activeProxyReq = lib.get(targetUrl, (proxyRes) => {
        // HTTP Yönlendirmelerini (301, 302, 307, 308) otomatik takip et
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
          proxyRes.resume(); // Belleği boşalt
          let redirectUrl = proxyRes.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsedBase = new URL(targetUrl);
            redirectUrl = `${parsedBase.protocol}//${parsedBase.host}${redirectUrl}`;
          }
          return fetchWithRedirects(redirectUrl, maxRedirects - 1);
        }

        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        proxyRes.pipe(res);
      });

      activeProxyReq.on('error', (err) => {
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

  // 2. DURUM: BR (Bitrate) belirtildiyse -> VERİ TASARRUFU İÇİN FFMPEG İLE SIKIŞTIR
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '1', // Hızlı başlama için süre düşürüldü
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

  ffmpeg.on('error', (err) => {
    // FFmpeg süreç hatalarını güvenli şekilde yakala ve yut
  });

}).listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
