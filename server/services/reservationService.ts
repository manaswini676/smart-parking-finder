import crypto from 'crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/db.ts';
import { ParkingLot } from '../models/ParkingLot.ts';
import { ParkingSlot } from '../models/ParkingSlot.ts';
import { Reservation, type IReservation } from '../models/Reservation.ts';
import {
  computeAndEmitLotCounts,
  emitReservationUpdated,
  emitSlotUpdated,
} from '../socket/index.ts';

export const RESERVATION_EXPIRY_MINUTES = 15;
export const CANCELLATION_WINDOW_MINUTES = 5;
export const MAX_ACTIVE_RESERVATIONS = 2;

export class BusinessRuleError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function generateReservationCode(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RES-${datePart}-${randPart}`;
}

async function runInTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Expires any confirmed reservations whose 15-minute check-in deadline has passed.
 * Releases the corresponding parking slots back to "available" atomically and emits Socket.IO updates.
 */
export async function expireOverdueReservations(): Promise<number> {
  if (mongoose.connection.readyState !== 1) return 0;
  const now = new Date();
  const overdue = await Reservation.find({
    status: 'confirmed',
    expirationTime: { $lte: now },
  }).lean();

  if (overdue.length === 0) return 0;

  let expiredCount = 0;
  const affectedLots = new Set<string>();

  for (const res of overdue) {
    try {
      const updated = await runInTransaction(async (session) => {
        const resUpdate = await Reservation.findOneAndUpdate(
          {
            _id: res._id,
            status: 'confirmed',
            expirationTime: { $lte: now },
          },
          { $set: { status: 'expired' } },
          { new: true, session: session || undefined }
        );

        if (!resUpdate) return null;

        const slotUpdate = await ParkingSlot.findOneAndUpdate(
          {
            _id: res.slotId,
            currentReservationId: res._id,
            status: 'reserved',
          },
          {
            $set: {
              status: 'available',
              currentReservationId: null,
            },
          },
          { new: true, session: session || undefined }
        );

        return { resUpdate, slotUpdate };
      });

      if (updated) {
        expiredCount += 1;
        affectedLots.add(String(res.parkingLotId));
        if (updated.slotUpdate) {
          emitSlotUpdated(updated.slotUpdate);
        }
        emitReservationUpdated(
          String(res.userId),
          'reservation:updated',
          updated.resUpdate.toObject()
        );
      }
    } catch (err) {
      console.error('[ExpirationWorker] Failed to expire reservation:', res._id, err);
    }
  }

  for (const lotId of affectedLots) {
    await computeAndEmitLotCounts(lotId);
  }

  return expiredCount;
}

/**
 * Reserves an available parking slot inside an ACID MongoDB transaction.
 * Enforces:
 * 1. Maximum 2 active reservations per driver.
 * 2. Atomic slot status transition ("available" -> "reserved") preventing double booking.
 * 3. Database-level partial unique index on active Reservations for the slot.
 * 4. 15-minute expiration & 5-minute cancellation deadlines.
 */
export async function createReservation(userId: string, slotId: string): Promise<IReservation> {
  if (!mongoose.Types.ObjectId.isValid(slotId)) {
    throw new BusinessRuleError('Invalid parking slot ID.', 400);
  }

  // First ensure any overdue reservations are cleaned up before enforcing limits
  await expireOverdueReservations();

  const now = new Date();
  const expirationTime = new Date(now.getTime() + RESERVATION_EXPIRY_MINUTES * 60 * 1000);
  const cancelDeadline = new Date(now.getTime() + CANCELLATION_WINDOW_MINUTES * 60 * 1000);

  const outcome = await runInTransaction(async (session) => {
    const activeCount = await Reservation.countDocuments(
      {
        userId,
        status: { $in: ['confirmed', 'checked_in'] },
      },
      { session: session || undefined }
    );

    if (activeCount >= MAX_ACTIVE_RESERVATIONS) {
      throw new BusinessRuleError(
        `Maximum of ${MAX_ACTIVE_RESERVATIONS} active reservations reached. Please check out or cancel an existing reservation first.`,
        409
      );
    }

    const slot = await ParkingSlot.findOneAndUpdate(
      {
        _id: slotId,
        status: 'available',
      },
      {
        $set: { status: 'reserved' },
      },
      {
        new: true,
        session: session || undefined,
      }
    );

    if (!slot) {
      const existingSlot = await ParkingSlot.findById(slotId).session(session || null).lean();
      if (!existingSlot) {
        throw new BusinessRuleError('Parking slot not found.', 404);
      }
      throw new BusinessRuleError(
        `Slot ${existingSlot.slotNumber} is currently ${existingSlot.status} and cannot be reserved.`,
        409
      );
    }

    const lot = await ParkingLot.findById(slot.parkingLotId)
      .session(session || null)
      .lean();
    if (!lot || !lot.isActive) {
      throw new BusinessRuleError('Parking lot is unavailable.', 404);
    }

    const reservationDocs = await Reservation.create(
      [
        {
          reservationCode: generateReservationCode(),
          userId,
          parkingLotId: lot._id,
          slotId: slot._id,
          slotNumber: slot.slotNumber,
          parkingLotName: lot.name,
          hourlyRate: lot.hourlyRate,
          bookingTime: now,
          expirationTime,
          cancelDeadline,
          status: 'confirmed',
        },
      ],
      { session: session || undefined }
    );

    const reservation = reservationDocs[0];

    const updatedSlot = await ParkingSlot.findByIdAndUpdate(
      slot._id,
      { $set: { currentReservationId: reservation._id } },
      { new: true, session: session || undefined }
    );

    return { reservation, updatedSlot };
  });

  if (outcome.updatedSlot) {
    emitSlotUpdated(outcome.updatedSlot);
  }
  await computeAndEmitLotCounts(String(outcome.reservation.parkingLotId));
  emitReservationUpdated(
    userId,
    'reservation:created',
    outcome.reservation.toObject()
  );

  return outcome.reservation;
}

/**
 * Checks in a confirmed reservation within the 15-minute window, marking the slot "occupied".
 * Rejects expired reservations and releases their slot back to "available".
 */
export async function checkInReservation(
  reservationId: string,
  userId: string,
  isAdmin = false
): Promise<IReservation> {
  if (!mongoose.Types.ObjectId.isValid(reservationId)) {
    throw new BusinessRuleError('Invalid reservation ID.', 400);
  }

  const now = new Date();

  const existing = await Reservation.findById(reservationId);
  if (!existing) {
    throw new BusinessRuleError('Reservation not found.', 404);
  }

  if (!isAdmin && String(existing.userId) !== userId) {
    throw new BusinessRuleError('You are not authorized to check in to this reservation.', 403);
  }

  if (existing.status === 'expired' || (existing.status === 'confirmed' && existing.expirationTime <= now)) {
    // Ensure expired state & slot release are persisted immediately
    await expireOverdueReservations();
    throw new BusinessRuleError(
      'Check-in rejected: this reservation expired after the 15-minute arrival window.',
      400
    );
  }

  if (existing.status !== 'confirmed') {
    throw new BusinessRuleError(
      `Cannot check in: reservation is already ${existing.status.replace('_', ' ')}.`,
      400
    );
  }

  const outcome = await runInTransaction(async (session) => {
    const updatedRes = await Reservation.findOneAndUpdate(
      {
        _id: reservationId,
        status: 'confirmed',
        expirationTime: { $gt: now },
      },
      {
        $set: {
          status: 'checked_in',
          checkInTime: now,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedRes) {
      throw new BusinessRuleError('Reservation could not be checked in or just expired.', 409);
    }

    const updatedSlot = await ParkingSlot.findOneAndUpdate(
      {
        _id: updatedRes.slotId,
        currentReservationId: updatedRes._id,
      },
      {
        $set: { status: 'occupied' },
      },
      { new: true, session: session || undefined }
    );

    return { updatedRes, updatedSlot };
  });

  if (outcome.updatedSlot) {
    emitSlotUpdated(outcome.updatedSlot);
  }
  await computeAndEmitLotCounts(String(outcome.updatedRes.parkingLotId));
  emitReservationUpdated(
    String(outcome.updatedRes.userId),
    'reservation:updated',
    outcome.updatedRes.toObject()
  );

  return outcome.updatedRes;
}

/**
 * Cancels a confirmed reservation within 5 minutes of booking (for drivers).
 * Releases the slot immediately back to "available".
 */
export async function cancelReservation(
  reservationId: string,
  userId: string,
  isAdmin = false
): Promise<IReservation> {
  if (!mongoose.Types.ObjectId.isValid(reservationId)) {
    throw new BusinessRuleError('Invalid reservation ID.', 400);
  }

  await expireOverdueReservations();

  const now = new Date();
  const existing = await Reservation.findById(reservationId);
  if (!existing) {
    throw new BusinessRuleError('Reservation not found.', 404);
  }

  if (!isAdmin && String(existing.userId) !== userId) {
    throw new BusinessRuleError('You are not authorized to cancel this reservation.', 403);
  }

  if (existing.status === 'checked_in') {
    throw new BusinessRuleError(
      'Cannot cancel after check-in. Use "Complete & Exit" when vacating the bay.',
      400
    );
  }

  if (existing.status !== 'confirmed') {
    throw new BusinessRuleError(`Reservation is already ${existing.status}.`, 400);
  }

  if (!isAdmin && now > existing.cancelDeadline) {
    throw new BusinessRuleError(
      'Cancellation window closed. Reservations can only be cancelled within 5 minutes of booking.',
      400
    );
  }

  const outcome = await runInTransaction(async (session) => {
    const updatedRes = await Reservation.findOneAndUpdate(
      {
        _id: reservationId,
        status: 'confirmed',
      },
      { $set: { status: 'cancelled' } },
      { new: true, session: session || undefined }
    );

    if (!updatedRes) {
      throw new BusinessRuleError('Reservation could not be cancelled.', 409);
    }

    const updatedSlot = await ParkingSlot.findOneAndUpdate(
      {
        _id: updatedRes.slotId,
        currentReservationId: updatedRes._id,
      },
      {
        $set: {
          status: 'available',
          currentReservationId: null,
        },
      },
      { new: true, session: session || undefined }
    );

    return { updatedRes, updatedSlot };
  });

  if (outcome.updatedSlot) {
    emitSlotUpdated(outcome.updatedSlot);
  }
  await computeAndEmitLotCounts(String(outcome.updatedRes.parkingLotId));
  emitReservationUpdated(
    String(outcome.updatedRes.userId),
    'reservation:updated',
    outcome.updatedRes.toObject()
  );

  return outcome.updatedRes;
}

/**
 * Completes a checked-in reservation (driver exit or admin release), calculates parking fee,
 * and returns the slot back to "available".
 */
export async function completeReservation(
  reservationId: string,
  userId: string,
  isAdmin = false
): Promise<IReservation> {
  if (!mongoose.Types.ObjectId.isValid(reservationId)) {
    throw new BusinessRuleError('Invalid reservation ID.', 400);
  }

  const now = new Date();
  const existing = await Reservation.findById(reservationId);
  if (!existing) {
    throw new BusinessRuleError('Reservation not found.', 404);
  }

  if (!isAdmin && String(existing.userId) !== userId) {
    throw new BusinessRuleError('You are not authorized to complete this reservation.', 403);
  }

  if (existing.status !== 'checked_in' && !isAdmin) {
    throw new BusinessRuleError('Only checked-in reservations can be completed.', 400);
  }

  if (existing.status !== 'checked_in' && existing.status !== 'confirmed') {
    throw new BusinessRuleError(`Reservation is already ${existing.status}.`, 400);
  }

  const startTime = existing.checkInTime || existing.bookingTime;
  const durationHours = Math.max(0.25, (now.getTime() - startTime.getTime()) / (1000 * 60 * 60));
  const totalCharge = Number((durationHours * existing.hourlyRate).toFixed(2));

  const outcome = await runInTransaction(async (session) => {
    const nextStatus = existing.status === 'confirmed' ? 'cancelled' : 'completed';
    const updatedRes = await Reservation.findOneAndUpdate(
      {
        _id: reservationId,
        status: { $in: ['checked_in', 'confirmed'] },
      },
      {
        $set: {
          status: nextStatus,
          completedTime: nextStatus === 'completed' ? now : null,
          totalCharge: nextStatus === 'completed' ? totalCharge : 0,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedRes) {
      throw new BusinessRuleError('Reservation state changed concurrently.', 409);
    }

    const updatedSlot = await ParkingSlot.findOneAndUpdate(
      {
        _id: updatedRes.slotId,
        currentReservationId: updatedRes._id,
      },
      {
        $set: {
          status: 'available',
          currentReservationId: null,
        },
      },
      { new: true, session: session || undefined }
    );

    return { updatedRes, updatedSlot };
  });

  if (outcome.updatedSlot) {
    emitSlotUpdated(outcome.updatedSlot);
  }
  await computeAndEmitLotCounts(String(outcome.updatedRes.parkingLotId));
  emitReservationUpdated(
    String(outcome.updatedRes.userId),
    'reservation:updated',
    outcome.updatedRes.toObject()
  );

  return outcome.updatedRes;
}
