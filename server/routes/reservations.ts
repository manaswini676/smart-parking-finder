import { Router } from 'express';
import { z } from 'zod';
import { Reservation } from '../models/Reservation.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  BusinessRuleError,
  MAX_ACTIVE_RESERVATIONS,
  cancelReservation,
  checkInReservation,
  completeReservation,
  createReservation,
  expireOverdueReservations,
} from '../services/reservationService.ts';

const router = Router();

const createReservationSchema = z.object({
  slotId: z.string().min(1, 'Slot ID is required'),
});

router.use(requireAuth);

router.get('/my', async (req: AuthenticatedRequest, res) => {
  try {
    await expireOverdueReservations();

    const reservations = await Reservation.find({ userId: req.user!.id })
      .sort({ bookingTime: -1 })
      .populate('parkingLotId', 'name address city hourlyRate')
      .lean();

    const activeCount = reservations.filter(
      (r) => r.status === 'confirmed' || r.status === 'checked_in'
    ).length;

    const formatted = reservations.map((r) => {
      const lotInfo =
        r.parkingLotId && typeof r.parkingLotId === 'object' && 'address' in r.parkingLotId
          ? (r.parkingLotId as unknown as {
              _id: unknown;
              name: string;
              address: string;
              city: string;
              hourlyRate: number;
            })
          : null;

      return {
        _id: String(r._id),
        reservationCode: r.reservationCode,
        userId: String(r.userId),
        parkingLotId: lotInfo ? String(lotInfo._id) : String(r.parkingLotId),
        parkingLotName: lotInfo?.name || r.parkingLotName,
        parkingLotAddress: lotInfo ? `${lotInfo.address}, ${lotInfo.city}` : '',
        slotId: String(r.slotId),
        slotNumber: r.slotNumber,
        hourlyRate: r.hourlyRate,
        bookingTime: r.bookingTime,
        expirationTime: r.expirationTime,
        cancelDeadline: r.cancelDeadline,
        checkInTime: r.checkInTime,
        completedTime: r.completedTime,
        totalCharge: r.totalCharge,
        status: r.status,
      };
    });

    res.json({
      reservations: formatted,
      activeCount,
      maxActiveReservations: MAX_ACTIVE_RESERVATIONS,
    });
  } catch (err) {
    console.error('[Reservations] My list error:', err);
    res.status(500).json({ error: 'Failed to load reservations.' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = createReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reservation request.' });
      return;
    }

    const reservation = await createReservation(req.user!.id, parsed.data.slotId);
    res.status(201).json({ reservation });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    // Handle MongoDB duplicate key error from partial unique index
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      res.status(409).json({
        error: 'This parking slot was just reserved by another driver. Please choose another available slot.',
      });
      return;
    }
    console.error('[Reservations] Create error:', err);
    res.status(500).json({ error: 'Unable to complete reservation.' });
  }
});

router.post('/:id/checkin', async (req: AuthenticatedRequest, res) => {
  try {
    const reservation = await checkInReservation(
      String(req.params.id),
      req.user!.id,
      req.user!.role === 'admin'
    );
    res.json({ reservation });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[Reservations] Check-in error:', err);
    res.status(500).json({ error: 'Check-in failed.' });
  }
});

router.post('/:id/cancel', async (req: AuthenticatedRequest, res) => {
  try {
    const reservation = await cancelReservation(
      String(req.params.id),
      req.user!.id,
      req.user!.role === 'admin'
    );
    res.json({ reservation });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[Reservations] Cancel error:', err);
    res.status(500).json({ error: 'Cancellation failed.' });
  }
});

router.post('/:id/checkout', async (req: AuthenticatedRequest, res) => {
  try {
    const reservation = await completeReservation(
      String(req.params.id),
      req.user!.id,
      req.user!.role === 'admin'
    );
    res.json({ reservation });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[Reservations] Checkout error:', err);
    res.status(500).json({ error: 'Check-out failed.' });
  }
});

export default router;
