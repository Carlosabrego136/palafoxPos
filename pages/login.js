import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Login() {
  const router = useRouter();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || 'No se pudo entrar');
      return;
    }
    router.push('/pos');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={enviar}>
        <div className="brand" style={{ marginBottom: 6 }}>PALA<span>FOX</span></div>
        <p className="page-sub" style={{ marginBottom: 24 }}>Punto de venta — inicia sesión de tu tienda</p>
        <label>Usuario</label>
        <input
          type="text"
          placeholder="tienda1"
          autoFocus
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          style={{ marginBottom: 14, width: '100%' }}
        />
        <label>Contraseña</label>
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%' }}
        />
        {error && <p className="inline-msg err">{error}</p>}
        <button className="btn full" type="submit" disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
