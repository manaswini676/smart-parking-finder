import { Router } from 'express';
import mongoose from 'mongoose';
import { ParkingLot } from '../models/ParkingLot.ts';
import { ParkingSlot } from '../models/ParkingSlot.ts';
import { Reservation } from '../models/Reservation.ts';
import { optionalAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import { expireOverdueReservations } from '../services/reservationService.ts';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await expireOverdueReservations();

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter: Record<string, unknown> = { isActive: true };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ name: regex }, { address: regex }, { city: regex }];
    }

    const lots = await ParkingLot.find(filter).sort({ createdAt: 1 }).lean();
    const lotIds = lots.map((l) => l._id);

    const slotCountsAgg = await ParkingSlot.aggregate([
      { $match: { parkingLotId: { $in: lotIds } } },
      {
        $group: {
          _id: { lotId: '$parkingLotId', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    const countsMap = new Map<
      string,
      { totalSlots: number; availableSlots: number; reservedSlots: number; occupiedSlots: number }
    >();

    for (const id of lotIds) {
      countsMap.set(String(id), {
        totalSlots: 0,
        availableSlots: 0,
        reservedSlots: 0,
        occupiedSlots: 0,
      });
    }

    for (const row of slotCountsAgg) {
      const lotId = String(row._id.lotId);
      const entry = countsMap.get(lotId);
      if (!entry) continue;
      entry.totalSlots += row.count;
      if (row._id.status === 'available') entry.availableSlots += row.count;
      if (row._id.status === 'reserved') entry.reservedSlots += row.count;
      if (row._id.status === 'occupied') entry.occupiedSlots += row.count;
    }

    const enriched = lots.map((lot) => ({
      ...lot,
      _id: String(lot._id),
      ...(countsMap.get(String(lot._id)) || {
        totalSlots: 0,
        availableSlots: 0,
        reservedSlots: 0,
        occupiedSlots: 0,
      }),
    }));

    res.json({ lots: enriched });
  } catch (err) {
    console.error('[Lots] List error:', err);
    res.status(500).json({ error: 'Failed to load parking lots.' });
  }
});

router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const lotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(lotId)) {
      res.status(400).json({ error: 'Invalid parking lot ID.' });
      return;
    }

    await expireOverdueReservations();

    const lot = await ParkingLot.findById(lotId).lean();
    if (!lot || !lot.isActive) {
      res.status(404).json({ error: 'Parking lot not found.' });
      return;
    }

    const slots = await ParkingSlot.find({ parkingLotId: lot._id })
      .sort({ slotNumber: 1 })
      .lean();

    let userReservationBySlot = new Map<string, { _id: string; status: string; expirationTime: Date; cancelDeadline: Date }>();
    if (req.user) {
      const userActive = await Reservation.find({
        userId: req.user.id,
        parkingLotId: lot._id,
        status: { $in: ['confirmed', 'checked_in'] },
      }).lean();

      for (const r of userActive) {
        userReservationBySlot.set(String(r.slotId), {
          _id: String(r._id),
          status: r.status,
          expirationTime: r.expirationTime,
          cancelDeadline: r.cancelDeadline,
        });
      }
    }

    const formattedSlots = slots.map((s) => {
      const myRes = userReservationBySlot.get(String(s._id));
      return {
        _id: String(s._id),
        parkingLotId: String(s.parkingLotId),
        slotNumber: s.slotNumber,
        zone: s.zone,
        vehicleType: s.vehicleType,
        status: s.status,
        currentReservationId: s.currentReservationId ? String(s.currentReservationId) : null,
        ownedReservation: myRes || null,
      };
    });

    const counts = {
      totalSlots: formattedSlots.length,
      availableSlots: formattedSlots.filter((s) => s.status === 'available').length,
      reservedSlots: formattedSlots.filter((s) => s.status === 'reserved').length,
      occupiedSlots: formattedSlots.filter((s) => s.status === 'occupied').length,
    };

    res.json({
      lot: {
        ...lot,
        _id: String(lot._id),
        ...counts,
      },
      slots: formattedSlots,
    });
  } catch (err) {
    console.error('[Lots] Detail error:', err);
    res.status(500).json({ error: 'Failed to load parking lot slots.' });
  }
});

export default router;
