import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from './api';

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    const token = getStoredToken();
    socketInstance = io('/', {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      auth: token ? { token } : undefined,
    });
  }
  return socketInstance;
}

export function refreshSocketAuth(token: string | null): void {
  const socket = getSocket();
  socket.auth = token ? { token } : {};
  if (socket.connected) {
    if (token) {
      socket.emit('auth:refresh', token);
    } else {
      socket.disconnect().connect();
    }
  } else {
    socket.connect();
  }
}

export function joinLotRoom(lotId: string): void {
  const socket = getSocket();
  socket.emit('lot:join', lotId);
}

export function leaveLotRoom(lotId: string): void {
  const socket = getSocket();
  socket.emit('lot:leave', lotId);
}
