import GameCanvas from '../game/GameCanvas.jsx';

export default function Game({ user, roomCode, onExit }) {
  return <GameCanvas user={user} roomCode={roomCode} onExit={onExit} />;
}
