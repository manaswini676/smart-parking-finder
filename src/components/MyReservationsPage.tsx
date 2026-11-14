import { Calendar, Car, CheckCircle2, Clock, MapPin, User } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError, api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Reservation, ReservationStatus } from '../types/parking';

interface MyReservationsPageProps {
  onBackToLots: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
}

function formatCountdown(targetIso: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STATUS_BADGES: Record<ReservationStatus, { label: string; className: string }> = {
  confirmed: {
    label: 'Reserved · Awaiting Check-In',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  checked_in: {
    label: 'Checked In · Occupied',
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  completed: {
    label: 'Completed',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
  },
  expired: {
    label: 'Expired (15m Timeout)',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
};

export function MyReservationsPage({ onBackToLots, onNotify }: MyReservationsPageProps) {
  const { user, refreshProfile, updateProfile } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxActive, setMaxActive] = useState(2);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileVehicle, setProfileVehicle] = useState(user?.vehicleNumber || '');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfileVehicle(user.vehicleNumber || '');
      setProfilePhone(user.phone || '');
    }
  }, [user]);

  const loadReservations = useCallback(async () => {
    try {
      const data = await api.reservations.my();
      setReservations(data.reservations);
      setActiveCount(data.activeCount);
      setMaxActive(data.maxActiveReservations);
    } catch (err) {
      console.error('Failed to load reservations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const handleReservationEvent = () => {
      loadReservations();
      refreshProfile();
    };
    socket.on('reservation:created', handleReservationEvent);
    socket.on('reservation:updated', handleReservationEvent);
    return () => {
      socket.off('reservation:created', handleReservationEvent);
      socket.off('reservation:updated', handleReservationEvent);
    };
  }, [loadReservations, refreshProfile]);

  const handleCheckIn = async (id: string) => {
    setActionId(id);
    try {
      const { reservation } = await api.reservations.checkIn(id);
      await Promise.all([loadReservations(), refreshProfile()]);
      onNotify(
        'success',
        'Check-In Confirmed',
        `Slot ${reservation.slotNumber} at ${reservation.parkingLotName} is now occupied.`
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Check-in failed.';
      onNotify('error', 'Check-In Rejected', msg);
      loadReservations();
    } finally {
      setActionId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionId(id);
    try {
      const { reservation } = await api.reservations.cancel(id);
      await Promise.all([loadReservations(), refreshProfile()]);
      onNotify(
        'info',
        'Reservation Cancelled',
        `Slot ${reservation.slotNumber} has been released.`
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Cancellation failed.';
      onNotify('error', 'Cancellation Not Allowed', msg);
      loadReservations();
    } finally {
      setActionId(null);
    }
  };

  const handleCheckout = async (id: string) => {
    setActionId(id);
    try {
      const { reservation } = await api.reservations.checkout(id);
      await Promise.all([loadReservations(), refreshProfile()]);
      onNotify(
        'success',
        'Parking Completed',
        `Slot ${reservation.slotNumber} vacated. Total charge: $${(reservation.totalCharge ?? 0).toFixed(2)}.`
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Checkout failed.';
      onNotify('error', 'Checkout Error', msg);
    } finally {
      setActionId(null);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({
        name: profileName,
        vehicleNumber: profileVehicle,
        phone: profilePhone,
      });
      onNotify('success', 'Profile Updated', 'Your driver details have been saved.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save profile.';
      onNotify('error', 'Update Failed', msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const activeReservations = reservations.filter(
    (r) => r.status === 'confirmed' || r.status === 'checked_in'
  );
  const historyReservations = reservations.filter(
    (r) => r.status !== 'confirmed' && r.status !== 'checked_in'
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            My Reservations & Driver Profile
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Check in within 15 minutes of booking, manage active bays, and review past sessions.
          </p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-900 tabular-nums shrink-0">
          Active Quota: <strong>{activeCount}</strong> / {maxActive} reservations
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Main Column: Active & History */}
        <div className="lg:col-span-2 space-y-8">
          <section aria-labelledby="active-res-heading" className="space-y-4">
            <h2 id="active-res-heading" className="font-display text-lg font-bold text-slate-900">
              Active Reservations
            </h2>

            {loading ? (
              <div className="h-40 rounded-xl border border-slate-200 bg-white animate-pulse" />
            ) : activeReservations.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <Calendar className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
                <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
                  No active reservations
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Browse live parking lots to reserve an available bay (up to 2 active at once).
                </p>
                <button
                  type="button"
                  onClick={onBackToLots}
                  className="mt-4 min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Find Parking Slots
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {activeReservations.map((res) => {
                  const isConfirmed = res.status === 'confirmed';
                  const expMs = new Date(res.expirationTime).getTime();
                  const cancelMs = new Date(res.cancelDeadline).getTime();
                  const canCheckIn = isConfirmed && expMs > nowMs;
                  const canCancel = isConfirmed && cancelMs > nowMs;
                  const badge = STATUS_BADGES[res.status];

                  return (
                    <article
                      key={res._id}
                      className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-slate-500 tabular-nums">
                            {res.reservationCode}
                          </p>
                          <h3 className="mt-0.5 font-display text-lg font-bold text-slate-900">
                            {res.parkingLotName} — Slot {res.slotNumber}
                          </h3>
                          {res.parkingLotAddress ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                              <span>{res.parkingLotAddress}</span>
                            </p>
                          ) : null}
                        </div>

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${badge.className}`}
                        >
                          {res.status === 'confirmed' ? (
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>{badge.label}</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
                        <div>
                          <p className="text-slate-500">Booked At</p>
                          <p className="mt-0.5 font-medium text-slate-900 tabular-nums">
                            {new Date(res.bookingTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Rate</p>
                          <p className="mt-0.5 font-mono font-medium text-slate-900 tabular-nums">
                            ${res.hourlyRate.toFixed(2)}/hr
                          </p>
                        </div>
                        {isConfirmed ? (
                          <>
                            <div>
                              <p className="text-slate-500">Check-In Deadline</p>
                              <p className="mt-0.5 font-mono font-semibold text-amber-800 tabular-nums">
                                {formatCountdown(res.expirationTime, nowMs)}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-500">Cancel Window</p>
                              <p className="mt-0.5 font-mono font-medium text-slate-800 tabular-nums">
                                {canCancel
                                  ? formatCountdown(res.cancelDeadline, nowMs)
                                  : 'Closed (5m elapsed)'}
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <p className="text-slate-500">Checked In At</p>
                              <p className="mt-0.5 font-medium text-slate-900 tabular-nums">
                                {res.checkInTime
                                  ? new Date(res.checkInTime).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-500">Slot Status</p>
                              <p className="mt-0.5 font-semibold text-blue-700">Occupied</p>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {isConfirmed ? (
                          <>
                            <button
                              type="button"
                              disabled={!canCheckIn || actionId === res._id}
                              onClick={() => handleCheckIn(res._id)}
                              className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              {actionId === res._id ? 'Processing...' : 'Check In'}
                            </button>

                            <button
                              type="button"
                              disabled={!canCancel || actionId === res._id}
                              onClick={() => handleCancel(res._id)}
                              title={
                                canCancel
                                  ? 'Cancel within 5 minutes of booking'
                                  : 'Cancellation only allowed within 5 minutes of booking'
                              }
                              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              {canCancel ? 'Cancel Reservation' : 'Cancel Window Expired'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={actionId === res._id}
                            onClick={() => handleCheckout(res._id)}
                            className="min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          >
                            {actionId === res._id ? 'Completing...' : 'Complete & Exit Slot'}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Past Reservation History */}
          <section aria-labelledby="history-res-heading" className="space-y-4">
            <h2 id="history-res-heading" className="font-display text-lg font-bold text-slate-900">
              Reservation History
            </h2>

            {historyReservations.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                No completed, cancelled, or expired reservations yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Reservation ID</th>
                      <th className="px-4 py-3">Parking Lot & Slot</th>
                      <th className="px-4 py-3">Booked</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Charge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyReservations.map((res) => {
                      const badge = STATUS_BADGES[res.status];
                      return (
                        <tr key={res._id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {res.reservationCode}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-slate-900">{res.parkingLotName}</span>
                            <span className="text-slate-500"> · Slot {res.slotNumber}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {new Date(res.bookingTime).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-900 tabular-nums">
                            {res.totalCharge !== null ? `$${res.totalCharge.toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Driver Profile Sidebar */}
        <aside className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <User className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-slate-900">Driver Profile</h2>
          </div>

          <form onSubmit={handleProfileSave} className="space-y-3.5">
            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium text-slate-500 mb-1">
                Account Email
              </label>
              <input
                id="prof-email"
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="prof-vehicle" className="block text-xs font-medium text-slate-700 mb-1">
                Vehicle License Plate
              </label>
              <div className="relative">
                <Car className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  id="prof-vehicle"
                  type="text"
                  value={profileVehicle}
                  onChange={(e) => setProfileVehicle(e.target.value)}
                  placeholder="CA-8EV-402"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                id="prof-phone"
                type="tel"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                placeholder="(415) 555-0148"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
