import { clearSessionCookie } from '../../../lib/auth';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
}
