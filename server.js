import { createServer } from 'http';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';
const API_KEY = process.env.ADMIRALTY_API_KEY || 'baec423358314e4e8f527980f959295d';

const distPath = path.join(__dirname, 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const serveStatic = (filePath, res) => {
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
};

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const targetPath = req.url.replace('/api/', '');
    const url = new URL(`${API_BASE_URL}/${targetPath}`);
    if (!url.searchParams.has('subscription-key')) {
      url.searchParams.append('subscription-key', API_KEY);
    }
    try {
      const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.end(buffer);
    } catch (err) {
      console.error('Proxy error', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy request failed' }));
    }
    return;
  }

  let filePath = path.join(distPath, req.url.split('?')[0]);
  if (req.url === '/' || !path.extname(filePath)) {
    filePath = path.join(distPath, 'index.html');
  }

  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      serveStatic(filePath, res);
      return;
    }
  } catch {
    // fallthrough to index.html for SPA routes
  }

  const indexPath = path.join(distPath, 'index.html');
  if (existsSync(indexPath)) {
    serveStatic(indexPath, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
