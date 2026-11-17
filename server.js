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

  // 1. DURUM: BR (Bitrate) belirtilmediyse -> SIKIŞTIRMADAN, DİREKT PROXY (ORİJİNAL KALİTE)
  if (!bitrate) {
    const lib = streamUrl.startsWith('https') ? https : http;
    
    const proxyReq = lib.get(streamUrl, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Proxy bağlantı hatası');
    });

    req.on('close', () => {
      proxyReq.destroy();
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
    '-reconnect_delay_max', '5',
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
    // FFmpeg hatalarını yut
  });

}).listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
