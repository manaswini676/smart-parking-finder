import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User, type UserRole } from '../models/User.ts';

export interface AuthUserPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    vehicleNumber: string;
    phone: string;
  };
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || 'smartpark-dev-secret-change-in-production';
}

export function signAuthToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): AuthUserPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUserPayload;
    if (!decoded || !decoded.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token. Please sign in again.' });
    return;
  }

  const user = await User.findById(payload.userId).select('-passwordHash').lean();
  if (!user) {
    res.status(401).json({ error: 'Account no longer exists.' });
    return;
  }

  req.user = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    vehicleNumber: user.vehicleNumber || '',
    phone: user.phone || '',
  };
  next();
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next();
    return;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    next();
    return;
  }

  const user = await User.findById(payload.userId).select('-passwordHash').lean();
  if (user) {
    req.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      vehicleNumber: user.vehicleNumber || '',
      phone: user.phone || '',
    };
  }
  next();
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin privileges required for this action.' });
    return;
  }
  next();
}
