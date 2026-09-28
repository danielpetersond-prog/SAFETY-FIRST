// Servidor estático mínimo para os testes (serve a raiz do repositório)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.xml': 'application/xml', '.svg': 'image/svg+xml' };

export function serve(port = 0) {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x');
        let p = join(root, decodeURIComponent(url.pathname));
        if (p !== root && !p.startsWith(root + sep)) throw new Error('fora da raiz');
        if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
        const body = await readFile(p);
        res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
        res.end(body);
      } catch (e) {
        res.writeHead(404);
        res.end('not found');
      }
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// Uso direto (demonstração): node tests/serve.mjs [porta]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await serve(+process.argv[2] || 8080);
  console.log(`Demonstração: ${url}/demo/  (Ctrl+C para encerrar)`);
}
