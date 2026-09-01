// Hash de contraseñas con scrypt (nativo de Node, sin dependencias nuevas).
// Mismo algoritmo aquí y en el sistema central: el central crea/edita las
// contraseñas y aquí solo las verificamos al hacer login — ambos leen y
// escriben la misma tabla "usuarios" en la base de datos compartida.
import crypto from 'crypto';

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  try {
    const hashBuffer = Buffer.from(hashHex, 'hex');
    const testHash = crypto.scryptSync(password, salt, 64);
    if (hashBuffer.length !== testHash.length) return false;
    return crypto.timingSafeEqual(hashBuffer, testHash);
  } catch {
    return false;
  }
}
