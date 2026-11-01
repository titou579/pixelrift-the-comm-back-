import { io } from 'socket.io-client';

// Par défaut, le temps réel passe par la MÊME adresse que la page (le proxy de Vite le renvoie
// vers le serveur, voir vite.config.js) : ça marche en local, sur le Wi-Fi et via un tunnel.
// En ligne (Render), on définit VITE_API_URL pour pointer vers le serveur.
const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_URL, {
      withCredentials: true,
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
