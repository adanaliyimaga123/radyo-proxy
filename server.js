const http = require('http');
const { spawn } = require('child_process');
const url = require('url');

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = url.parse(req.url, true).query;
  const streamUrl = query.url;
  const bitrate = query.br || '32k';

  if (!streamUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Radyo Veri Sıkıştırma Sunucusu Aktif!');
  }

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
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
}).listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
