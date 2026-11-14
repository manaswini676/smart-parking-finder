import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { verifyAuthToken } from '../middleware/auth.ts';
import { ParkingSlot } from '../models/ParkingSlot.ts';

let io: SocketIOServer | null = null;

export interface LotCountsPayload {
  lotId: string;
  totalSlots: number;
  availableSlots: number;
  reservedSlots: number;
  occupiedSlots: number;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  io.on('connection', (socket) => {
    socket.join('lots:overview');

    const token =
      typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
    if (token) {
      const payload = verifyAuthToken(token);
      if (payload) {
        socket.data.user = payload;
        socket.join(`user:${payload.userId}`);
        if (payload.role === 'admin') {
          socket.join('admin:feed');
        }
      }
    }

    socket.on('auth:refresh', (newToken: string) => {
      if (typeof newToken !== 'string') return;
      const payload = verifyAuthToken(newToken);
      if (payload) {
        socket.data.user = payload;
        socket.join(`user:${payload.userId}`);
        if (payload.role === 'admin') {
          socket.join('admin:feed');
        }
      }
    });

    socket.on('lot:join', (lotId: string) => {
      if (typeof lotId === 'string' && lotId.length > 0) {
        socket.join(`lot:${lotId}`);
      }
    });

    socket.on('lot:leave', (lotId: string) => {
      if (typeof lotId === 'string' && lotId.length > 0) {
        socket.leave(`lot:${lotId}`);
      }
    });
  });

  return io;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export async function computeAndEmitLotCounts(lotId: string): Promise<LotCountsPayload | null> {
  const slots = await ParkingSlot.find({ parkingLotId: lotId }).select('status').lean();
  const counts: LotCountsPayload = {
    lotId,
    totalSlots: slots.length,
    availableSlots: slots.filter((s) => s.status === 'available').length,
    reservedSlots: slots.filter((s) => s.status === 'reserved').length,
    occupiedSlots: slots.filter((s) => s.status === 'occupied').length,
  };

  if (io) {
    io.to('lots:overview').emit('lot:counts', counts);
    io.to('admin:feed').emit('lot:counts', counts);
  }
  return counts;
}

export function emitSlotUpdated(slotDoc: {
  _id: unknown;
  parkingLotId: unknown;
  slotNumber: string;
  zone: string;
  vehicleType: string;
  status: string;
  currentReservationId: unknown;
}): void {
  if (!io) return;
  const lotId = String(slotDoc.parkingLotId);
  const payload = {
    _id: String(slotDoc._id),
    parkingLotId: lotId,
    slotNumber: slotDoc.slotNumber,
    zone: slotDoc.zone,
    vehicleType: slotDoc.vehicleType,
    status: slotDoc.status,
    currentReservationId: slotDoc.currentReservationId ? String(slotDoc.currentReservationId) : null,
  };
  io.to(`lot:${lotId}`).emit('slot:updated', payload);
  io.to('admin:feed').emit('slot:updated', payload);
}

export function emitReservationUpdated(
  userId: string,
  event: 'reservation:created' | 'reservation:updated',
  reservationPayload: unknown
): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, reservationPayload);
  io.to('admin:feed').emit(event, reservationPayload);
}

export function emitLotsChanged(): void {
  if (!io) return;
  io.to('lots:overview').emit('lots:changed', { timestamp: Date.now() });
  io.to('admin:feed').emit('lots:changed', { timestamp: Date.now() });
}
