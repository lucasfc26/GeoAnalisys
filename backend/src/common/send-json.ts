import type { Request, Response } from 'express';
import { promisify } from 'util';
import { gzip } from 'zlib';

const gzipAsync = promisify(gzip);

/** Envia JSON comprimido com gzip quando o cliente aceita (respostas grandes, como camadas inteiras). */
export async function sendJson(req: Request, res: Response, body: unknown) {
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'no-store');
  if (json.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const gz = await gzipAsync(json, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', gz.length);
    res.end(gz);
    return;
  }
  res.setHeader('Content-Length', json.length);
  res.end(json);
}
