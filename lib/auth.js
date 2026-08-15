// Sesiones firmadas con HMAC — independiente del sistema de Cristian
// (aunque comparten base de datos, cada proyecto maneja su propio login).
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'cambia-esto-en-produccion';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 días

function sign(payload) {
  const json = JSON.stringify(payload);
  const base = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(base).digest('base64url');
  return `${base}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [base, sig] = token.split('.');
  if (!base || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(base).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionCookie(payload) {
  const token = sign({ ...payload, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `palafox_pos_session=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  return 'palafox_pos_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies.palafox_pos_session);
}

export function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }
  return session;
}
