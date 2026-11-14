import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.ts';
import { Reservation } from '../models/Reservation.ts';
import {
  requireAuth,
  signAuthToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { MAX_ACTIVE_RESERVATIONS } from '../services/reservationService.ts';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Please provide a valid email address').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  vehicleNumber: z.string().trim().max(24).optional().default(''),
  phone: z.string().trim().max(24).optional().default(''),
});

const loginSchema = z.object({
  email: z.string().trim().email('Please provide a valid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  vehicleNumber: z.string().trim().max(24).optional().default(''),
  phone: z.string().trim().max(24).optional().default(''),
});

router.post('/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
      return;
    }

    const { name, email, password, vehicleNumber, phone } = parsed.data;
    const existing = await User.findOne({ email }).lean();
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role: 'driver',
      vehicleNumber: vehicleNumber.toUpperCase(),
      phone,
    });

    const token = signAuthToken({
      userId: String(user._id),
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        vehicleNumber: user.vehicleNumber,
        phone: user.phone,
        activeReservationsCount: 0,
        maxActiveReservations: MAX_ACTIVE_RESERVATIONS,
      },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid login credentials.' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const activeCount = await Reservation.countDocuments({
      userId: user._id,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    const token = signAuthToken({
      userId: String(user._id),
      email: user.email,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        vehicleNumber: user.vehicleNumber,
        phone: user.phone,
        activeReservationsCount: activeCount,
        maxActiveReservations: MAX_ACTIVE_RESERVATIONS,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Failed to sign in.' });
  }
});

router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const activeCount = await Reservation.countDocuments({
      userId: user.id,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    res.json({
      user: {
        ...user,
        activeReservationsCount: activeCount,
        maxActiveReservations: MAX_ACTIVE_RESERVATIONS,
      },
    });
  } catch (err) {
    console.error('[Auth] Me error:', err);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

router.put('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile update.' });
      return;
    }

    const updated = await User.findByIdAndUpdate(
      req.user!.id,
      {
        $set: {
          name: parsed.data.name,
          vehicleNumber: parsed.data.vehicleNumber.toUpperCase(),
          phone: parsed.data.phone,
        },
      },
      { new: true }
    )
      .select('-passwordHash')
      .lean();

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const activeCount = await Reservation.countDocuments({
      userId: updated._id,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    res.json({
      user: {
        id: String(updated._id),
        name: updated.name,
        email: updated.email,
        role: updated.role,
        vehicleNumber: updated.vehicleNumber,
        phone: updated.phone,
        activeReservationsCount: activeCount,
        maxActiveReservations: MAX_ACTIVE_RESERVATIONS,
      },
    });
  } catch (err) {
    console.error('[Auth] Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

export default router;
