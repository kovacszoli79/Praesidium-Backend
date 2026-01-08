import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../src/index';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers for preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  return new Promise((resolve) => {
    app(req, res);
    res.on('finish', resolve);
  });
}
