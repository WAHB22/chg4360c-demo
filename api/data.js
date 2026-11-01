import { put, list, del } from '@vercel/blob';

const PREFIX = 'finance/data-';

async function newest() {
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return blobs;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const blobs = await newest();
      if (!blobs.length) return res.status(200).json({ empty: true });
      const r = await fetch(blobs[0].url, { cache: 'no-store' });
      const data = await r.json();
      return res.status(200).json(data);
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body !== 'object' || !body.bills) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      body.savedAt = new Date().toISOString();
      const blob = await put(PREFIX + Date.now() + '.json', JSON.stringify(body), {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'application/json',
      });
      const blobs = await newest();
      const old = blobs.filter(b => b.url !== blob.url).slice(9).map(b => b.url);
      if (old.length) await del(old);
      return res.status(200).json({ ok: true, savedAt: body.savedAt });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
