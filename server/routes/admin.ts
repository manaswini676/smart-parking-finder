import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ParkingLot } from '../models/ParkingLot.ts';
import { ParkingSlot } from '../models/ParkingSlot.ts';
import { Reservation } from '../models/Reservation.ts';
import { requireAdmin, requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  BusinessRuleError,
  completeReservation,
  expireOverdueReservations,
} from '../services/reservationService.ts';
import {
  computeAndEmitLotCounts,
  emitLotsChanged,
  emitSlotUpdated,
} from '../socket/index.ts';

const router = Router();

router.use(requireAuth, requireAdmin);

const lotBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  hourlyRate: z.coerce.number().min(0.5).max(500),
  description: z.string().trim().max(500).optional().default(''),
  operatingHours: z.string().trim().max(80).optional().default('24/7 Open Access'),
  imageUrl: z.string().trim().optional().default(''),
  amenities: z.array(z.string().trim()).optional().default(['Covered Bays', '24/7 Security']),
  initialSlotLabels: z
    .array(z.string().trim().toUpperCase().min(1).max(12))
    .optional(),
});

const addSlotSchema = z.object({
  slotNumber: z.string().trim().toUpperCase().min(1).max(12),
  zone: z.string().trim().max(40).optional().default('Level 1'),
  vehicleType: z.enum(['standard', 'ev', 'accessible']).optional().default('standard'),
});

const patchSlotSchema = z.object({
  status: z.enum(['available', 'occupied']).optional(),
  zone: z.string().trim().max(40).optional(),
  vehicleType: z.enum(['standard', 'ev', 'accessible']).optional(),
});

router.get('/overview', async (_req, res) => {
  try {
    await expireOverdueReservations();

    const [lots, slots, reservations] = await Promise.all([
      ParkingLot.find().sort({ createdAt: 1 }).lean(),
      ParkingSlot.find().sort({ slotNumber: 1 }).lean(),
      Reservation.find()
        .sort({ bookingTime: -1 })
        .limit(100)
        .populate('userId', 'name email vehicleNumber phone')
        .lean(),
    ]);

    const lotsWithStats = lots.map((lot) => {
      const lotSlots = slots.filter((s) => String(s.parkingLotId) === String(lot._id));
      return {
        ...lot,
        _id: String(lot._id),
        totalSlots: lotSlots.length,
        availableSlots: lotSlots.filter((s) => s.status === 'available').length,
        reservedSlots: lotSlots.filter((s) => s.status === 'reserved').length,
        occupiedSlots: lotSlots.filter((s) => s.status === 'occupied').length,
        slots: lotSlots.map((s) => ({
          _id: String(s._id),
          parkingLotId: String(s.parkingLotId),
          slotNumber: s.slotNumber,
          zone: s.zone,
          vehicleType: s.vehicleType,
          status: s.status,
          currentReservationId: s.currentReservationId ? String(s.currentReservationId) : null,
        })),
      };
    });

    const formattedReservations = reservations.map((r) => {
      const userObj =
        r.userId && typeof r.userId === 'object' && 'email' in r.userId
          ? (r.userId as unknown as {
              _id: unknown;
              name: string;
              email: string;
              vehicleNumber: string;
              phone: string;
            })
          : null;

      return {
        _id: String(r._id),
        reservationCode: r.reservationCode,
        userId: userObj ? String(userObj._id) : String(r.userId),
        driverName: userObj?.name || 'Driver',
        driverEmail: userObj?.email || '',
        driverVehicle: userObj?.vehicleNumber || '',
        driverPhone: userObj?.phone || '',
        parkingLotId: String(r.parkingLotId),
        parkingLotName: r.parkingLotName,
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

    const summary = {
      totalLots: lots.length,
      totalSlots: slots.length,
      availableSlots: slots.filter((s) => s.status === 'available').length,
      reservedSlots: slots.filter((s) => s.status === 'reserved').length,
      occupiedSlots: slots.filter((s) => s.status === 'occupied').length,
      activeReservations: reservations.filter(
        (r) => r.status === 'confirmed' || r.status === 'checked_in'
      ).length,
    };

    res.json({ summary, lots: lotsWithStats, reservations: formattedReservations });
  } catch (err) {
    console.error('[Admin] Overview error:', err);
    res.status(500).json({ error: 'Failed to load admin overview.' });
  }
});

router.post('/lots', async (req, res) => {
  try {
    const parsed = lotBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid parking lot payload.' });
      return;
    }

    const { initialSlotLabels, ...lotFields } = parsed.data;
    const lot = await ParkingLot.create({
      ...lotFields,
      isActive: true,
    });

    const labels =
      initialSlotLabels && initialSlotLabels.length > 0
        ? Array.from(new Set(initialSlotLabels))
        : ['A', 'B', 'C', 'D', 'E', 'F'];

    const slotDocs = labels.map((label, idx) => ({
      parkingLotId: lot._id,
      slotNumber: label,
      zone: 'Level 1',
      vehicleType: idx === 1 ? 'ev' : idx === labels.length - 1 ? 'accessible' : 'standard',
      status: 'available' as const,
      currentReservationId: null,
    }));

    await ParkingSlot.insertMany(slotDocs);

    emitLotsChanged();
    await computeAndEmitLotCounts(String(lot._id));

    res.status(201).json({ lot: { ...lot.toObject(), _id: String(lot._id) } });
  } catch (err) {
    console.error('[Admin] Create lot error:', err);
    res.status(500).json({ error: 'Failed to create parking lot.' });
  }
});

router.put('/lots/:id', async (req, res) => {
  try {
    const lotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(lotId)) {
      res.status(400).json({ error: 'Invalid parking lot ID.' });
      return;
    }

    const parsed = lotBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update data.' });
      return;
    }

    const { initialSlotLabels: _ignored, ...updates } = parsed.data;
    const updated = await ParkingLot.findByIdAndUpdate(
      lotId,
      { $set: updates },
      { new: true }
    ).lean();

    if (!updated) {
      res.status(404).json({ error: 'Parking lot not found.' });
      return;
    }

    emitLotsChanged();
    res.json({ lot: { ...updated, _id: String(updated._id) } });
  } catch (err) {
    console.error('[Admin] Update lot error:', err);
    res.status(500).json({ error: 'Failed to update parking lot.' });
  }
});

router.delete('/lots/:id', async (req, res) => {
  try {
    const lotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(lotId)) {
      res.status(400).json({ error: 'Invalid parking lot ID.' });
      return;
    }

    const activeResCount = await Reservation.countDocuments({
      parkingLotId: lotId,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    if (activeResCount > 0) {
      res.status(409).json({
        error: `Cannot delete parking lot while ${activeResCount} active reservation(s) exist. Release active reservations first.`,
      });
      return;
    }

    const deleted = await ParkingLot.findByIdAndDelete(lotId);
    if (!deleted) {
      res.status(404).json({ error: 'Parking lot not found.' });
      return;
    }

    await ParkingSlot.deleteMany({ parkingLotId: lotId });
    emitLotsChanged();

    res.json({ deleted: true });
  } catch (err) {
    console.error('[Admin] Delete lot error:', err);
    res.status(500).json({ error: 'Failed to delete parking lot.' });
  }
});

router.post('/lots/:id/slots', async (req, res) => {
  try {
    const lotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(lotId)) {
      res.status(400).json({ error: 'Invalid parking lot ID.' });
      return;
    }

    const lot = await ParkingLot.findById(lotId).lean();
    if (!lot) {
      res.status(404).json({ error: 'Parking lot not found.' });
      return;
    }

    const parsed = addSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid slot details.' });
      return;
    }

    const existing = await ParkingSlot.findOne({
      parkingLotId: lotId,
      slotNumber: parsed.data.slotNumber,
    }).lean();

    if (existing) {
      res.status(409).json({ error: `Slot ${parsed.data.slotNumber} already exists in ${lot.name}.` });
      return;
    }

    const slot = await ParkingSlot.create({
      parkingLotId: lotId,
      slotNumber: parsed.data.slotNumber,
      zone: parsed.data.zone,
      vehicleType: parsed.data.vehicleType,
      status: 'available',
      currentReservationId: null,
    });

    emitSlotUpdated(slot);
    emitLotsChanged();
    await computeAndEmitLotCounts(lotId);

    res.status(201).json({ slot });
  } catch (err) {
    console.error('[Admin] Add slot error:', err);
    res.status(500).json({ error: 'Failed to add slot.' });
  }
});

router.patch('/slots/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const slotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(slotId)) {
      res.status(400).json({ error: 'Invalid slot ID.' });
      return;
    }

    const parsed = patchSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid slot update.' });
      return;
    }

    const slot = await ParkingSlot.findById(slotId);
    if (!slot) {
      res.status(404).json({ error: 'Parking slot not found.' });
      return;
    }

    if (parsed.data.status === 'available' && slot.currentReservationId) {
      await completeReservation(String(slot.currentReservationId), req.user!.id, true);
    }

    const updateFields: Record<string, unknown> = {};
    if (parsed.data.zone) updateFields.zone = parsed.data.zone;
    if (parsed.data.vehicleType) updateFields.vehicleType = parsed.data.vehicleType;
    if (parsed.data.status) {
      if (parsed.data.status === 'occupied' && slot.status === 'reserved' && slot.currentReservationId) {
        res.status(409).json({
          error: 'Slot currently holds an active reservation. Check in or release the reservation first.',
        });
        return;
      }
      updateFields.status = parsed.data.status;
      if (parsed.data.status === 'available') {
        updateFields.currentReservationId = null;
      }
    }

    const updated = await ParkingSlot.findByIdAndUpdate(
      slotId,
      { $set: updateFields },
      { new: true }
    );

    if (updated) {
      emitSlotUpdated(updated);
      await computeAndEmitLotCounts(String(updated.parkingLotId));
    }

    res.json({ slot: updated });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[Admin] Patch slot error:', err);
    res.status(500).json({ error: 'Failed to update slot.' });
  }
});

router.delete('/slots/:id', async (req, res) => {
  try {
    const slotId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(slotId)) {
      res.status(400).json({ error: 'Invalid slot ID.' });
      return;
    }

    const slot = await ParkingSlot.findById(slotId).lean();
    if (!slot) {
      res.status(404).json({ error: 'Parking slot not found.' });
      return;
    }

    if (slot.status !== 'available') {
      res.status(409).json({
        error: `Cannot delete Slot ${slot.slotNumber} while it is ${slot.status}. Release it first.`,
      });
      return;
    }

    await ParkingSlot.findByIdAndDelete(slotId);
    emitLotsChanged();
    await computeAndEmitLotCounts(String(slot.parkingLotId));

    res.json({ deleted: true });
  } catch (err) {
    console.error('[Admin] Delete slot error:', err);
    res.status(500).json({ error: 'Failed to delete slot.' });
  }
});

router.post('/reservations/:id/force-release', async (req: AuthenticatedRequest, res) => {
  try {
    const reservation = await completeReservation(
      String(req.params.id),
      req.user!.id,
      true
    );
    res.json({ reservation });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[Admin] Force release error:', err);
    res.status(500).json({ error: 'Failed to release reservation.' });
  }
});

export default router;
