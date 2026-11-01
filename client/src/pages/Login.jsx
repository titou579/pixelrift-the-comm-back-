import { useState } from 'react';
import { login } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = await login(username, password);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen center">
      <div className="watermark">RIFT</div>
      <form className="card" onSubmit={handleSubmit}>
        <div className="stamp">Accès restreint</div>
        <h1 className="logo">PIXEL<span>RIFT</span></h1>
        <p className="tagline">Authentification requise</p>

        <label>
          Indicatif
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label>
          Code d'accès
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="error">⚠ {error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Vérification…' : "S'authentifier"}
        </button>
      </form>

      <p className="footer-note">PixelRift // v0.3 // Opération Rift</p>
    </div>
  );
}
