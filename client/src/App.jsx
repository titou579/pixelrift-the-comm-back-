import { useEffect, useState } from 'react';
import Login from './pages/Login.jsx';
import Lobby from './pages/Lobby.jsx';
import Game from './pages/Game.jsx';
import Profile from './pages/Profile.jsx';
import Loadout from './pages/Loadout.jsx';
import Icon from './components/Icon.jsx';
import { me, logout } from './api.js';
import { getSocket, disconnectSocket } from './socket.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('lobby');
  const [roomCode, setRoomCode] = useState(null);
  const [announce, setAnnounce] = useState(null);

  useEffect(() => {
    me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Annonces envoyées par un administrateur (affichées sur tous les écrans)
  useEffect(() => {
    if (!user) return undefined;
    const socket = getSocket();
    const onAnnounce = ({ text }) => {
      setAnnounce(text);
      setTimeout(() => setAnnounce((a) => (a === text ? null : a)), 9000);
    };
    socket.on('announce', onAnnounce);
    return () => socket.off('announce', onAnnounce);
  }, [user && user.username]);

  const handleLogin = (u) => {
    disconnectSocket();      // le socket doit se reconnecter avec la nouvelle session
    setRoomCode(null);
    setView('lobby');
    setUser(u);
  };
  const handleLogout = async () => {
    try { await logout(); } catch { /* déjà déconnecté */ }
    disconnectSocket();
    setRoomCode(null);
    setUser(null);
  };

  let page;
  if (loading) {
    page = <div className="screen center"><p className="muted">Chargement…</p></div>;
  } else if (!user) {
    page = <Login onLogin={handleLogin} />;
  } else if (view === 'game') {
    page = <Game user={user} roomCode={roomCode} onExit={() => setView('lobby')} />;
  } else if (view === 'arsenal') {
    page = <Loadout onClose={() => setView('lobby')} />;
  } else if (view === 'profile') {
    page = <Profile user={user} onBack={() => setView('lobby')} onUserChange={setUser} />;
  } else {
    page = (
      <Lobby
        user={user}
        roomCode={roomCode}
        onRoomChange={setRoomCode}
        onPlay={(code) => { setRoomCode(code); setView('game'); }}
        onProfile={() => setView('profile')}
        onArsenal={() => setView('arsenal')}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <>
      {page}
      {announce && <div className="announce-toast"><Icon name="megaphone" size={18} /> {announce}</div>}
    </>
  );
}
