import {
  Building2,
  Car,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError, api } from '../lib/api';
import { getSocket, joinLotRoom, leaveLotRoom } from '../lib/socket';
import type { ParkingLot, ParkingSlot, Reservation } from '../types/parking';
import { SlotCard } from './SlotCard';

interface ParkingDashboardProps {
  onRequireAuth: () => void;
  onReservationCreated: (reservation: Reservation) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
}

export function ParkingDashboard({
  onRequireAuth,
  onReservationCreated,
  onNotify,
}: ParkingDashboardProps) {
  const { user, refreshProfile } = useAuth();
  const [lots, setLots] = useState<ParkingLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'open'>('all');

  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedLotDetail, setSelectedLotDetail] = useState<ParkingLot | null>(null);
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [reservingSlotId, setReservingSlotId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const fetchLots = useCallback(async (query = '') => {
    try {
      const { lots: fetchedLots } = await api.lots.list(query);
      setLots(fetchedLots);
      setSelectedLotId((prev) => {
        if (prev && fetchedLots.some((l) => l._id === prev)) return prev;
        return fetchedLots[0]?._id || null;
      });
    } catch (err) {
      console.error('Failed to load lots:', err);
    } finally {
      setLoadingLots(false);
    }
  }, []);

  const fetchLotDetail = useCallback(async (lotId: string) => {
    setLoadingSlots(true);
    try {
      const { lot, slots: lotSlots } = await api.lots.detail(lotId);
      setSelectedLotDetail(lot);
      setSlots(lotSlots);
    } catch (err) {
      console.error('Failed to load lot slots:', err);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  // Debounced search fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLots(searchQuery);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchLots]);

  // Load slots & join Socket.IO room for selected lot
  useEffect(() => {
    if (!selectedLotId) {
      setSelectedLotDetail(null);
      setSlots([]);
      return;
    }

    fetchLotDetail(selectedLotId);
    joinLotRoom(selectedLotId);

    return () => {
      leaveLotRoom(selectedLotId);
    };
  }, [selectedLotId, fetchLotDetail, user?.id]);

  // Real-time Socket.IO listeners
  useEffect(() => {
    const socket = getSocket();

    const handleSlotUpdated = (updatedSlot: ParkingSlot) => {
      setSlots((prev) => {
        const exists = prev.some((s) => s._id === updatedSlot._id);
        if (!exists) return prev;
        return prev.map((s) => {
          if (s._id !== updatedSlot._id) return s;
          const keepOwned =
            updatedSlot.status === 'available'
              ? null
              : s.ownedReservation
                ? { ...s.ownedReservation, status: updatedSlot.status === 'occupied' ? 'checked_in' as const : s.ownedReservation.status }
                : null;
          return {
            ...updatedSlot,
            ownedReservation: keepOwned,
          };
        });
      });

      // Refresh slot ownership metadata if signed in
      if (selectedLotId && updatedSlot.parkingLotId === selectedLotId && user) {
        api.lots.detail(selectedLotId).then(({ lot, slots: freshSlots }) => {
          setSelectedLotDetail(lot);
          setSlots(freshSlots);
        }).catch(() => {});
      }
    };

    const handleLotCounts = (counts: {
      lotId: string;
      totalSlots: number;
      availableSlots: number;
      reservedSlots: number;
      occupiedSlots: number;
    }) => {
      setLots((prev) =>
        prev.map((lot) =>
          lot._id === counts.lotId
            ? {
                ...lot,
                totalSlots: counts.totalSlots,
                availableSlots: counts.availableSlots,
                reservedSlots: counts.reservedSlots,
                occupiedSlots: counts.occupiedSlots,
              }
            : lot
        )
      );
      setSelectedLotDetail((prev) =>
        prev && prev._id === counts.lotId
          ? {
              ...prev,
              totalSlots: counts.totalSlots,
              availableSlots: counts.availableSlots,
              reservedSlots: counts.reservedSlots,
              occupiedSlots: counts.occupiedSlots,
            }
          : prev
      );
    };

    const handleLotsChanged = () => {
      fetchLots(searchQuery);
      if (selectedLotId) {
        fetchLotDetail(selectedLotId);
      }
    };

    const handleReconnect = () => {
      fetchLots(searchQuery);
      if (selectedLotId) {
        joinLotRoom(selectedLotId);
        fetchLotDetail(selectedLotId);
      }
    };

    socket.on('slot:updated', handleSlotUpdated);
    socket.on('lot:counts', handleLotCounts);
    socket.on('lots:changed', handleLotsChanged);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('slot:updated', handleSlotUpdated);
      socket.off('lot:counts', handleLotCounts);
      socket.off('lots:changed', handleLotsChanged);
      socket.off('connect', handleReconnect);
    };
  }, [selectedLotId, searchQuery, user, fetchLots, fetchLotDetail]);

  const filteredLots = useMemo(() => {
    if (availabilityFilter === 'open') {
      return lots.filter((l) => l.availableSlots > 0);
    }
    return lots;
  }, [lots, availabilityFilter]);

  const aggregateStats = useMemo(() => {
    return lots.reduce(
      (acc, lot) => {
        acc.total += lot.totalSlots;
        acc.available += lot.availableSlots;
        acc.reserved += lot.reservedSlots;
        acc.occupied += lot.occupiedSlots;
        return acc;
      },
      { total: 0, available: 0, reserved: 0, occupied: 0 }
    );
  }, [lots]);

  const handleReserve = async (slot: ParkingSlot) => {
    if (!user) {
      onNotify('info', 'Sign In Required', 'Please sign in or create a driver account to reserve a parking slot.');
      onRequireAuth();
      return;
    }

    setReservingSlotId(slot._id);
    try {
      const { reservation } = await api.reservations.create(slot._id);
      await refreshProfile();
      if (selectedLotId) {
        await fetchLotDetail(selectedLotId);
      }
      onReservationCreated(reservation);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not complete reservation.';
      onNotify('error', 'Reservation Unavailable', message);
      if (selectedLotId) {
        fetchLotDetail(selectedLotId);
      }
    } finally {
      setReservingSlotId(null);
    }
  };

  const handleCheckIn = async (reservationId: string) => {
    setActionLoadingId(reservationId);
    try {
      const { reservation } = await api.reservations.checkIn(reservationId);
      await refreshProfile();
      if (selectedLotId) await fetchLotDetail(selectedLotId);
      onNotify(
        'success',
        'Checked In Successfully',
        `Slot ${reservation.slotNumber} is now marked Occupied for your vehicle.`
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Check-in failed.';
      onNotify('error', 'Check-In Rejected', message);
      if (selectedLotId) fetchLotDetail(selectedLotId);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (reservationId: string) => {
    setActionLoadingId(reservationId);
    try {
      const { reservation } = await api.reservations.cancel(reservationId);
      await refreshProfile();
      if (selectedLotId) await fetchLotDetail(selectedLotId);
      onNotify(
        'info',
        'Reservation Cancelled',
        `Slot ${reservation.slotNumber} has been released back to Available.`
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Cancellation failed.';
      onNotify('error', 'Cancellation Not Allowed', message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCheckout = async (reservationId: string) => {
    setActionLoadingId(reservationId);
    try {
      const { reservation } = await api.reservations.checkout(reservationId);
      await refreshProfile();
      if (selectedLotId) await fetchLotDetail(selectedLotId);
      onNotify(
        'success',
        'Session Completed',
        `Slot ${reservation.slotNumber} is now Available. Final charge: $${(reservation.totalCharge ?? 0).toFixed(2)}.`
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not complete checkout.';
      onNotify('error', 'Checkout Failed', message);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Search Controls */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 p-6 sm:p-8 text-white shadow-sm">
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-balance">
            Find & Reserve Real-Time Urban Parking
          </h1>
          <p className="mt-2 text-sm sm:text-base text-blue-100 leading-relaxed max-w-2xl">
            Live slot availability synchronized across all drivers. Reserve an open bay in seconds,
            check in within 15 minutes, and avoid double-booked garages.
          </p>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="parking-search" className="sr-only">
              Search parking by location or lot name
            </label>
            <input
              id="parking-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by parking lot name, street address, or city..."
              className="w-full min-h-[44px] rounded-xl border border-blue-400/30 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs focus:outline-none focus:ring-2 focus:ring-white"
            />
          </div>

          <div
            role="group"
            aria-label="Filter lots by availability"
            className="inline-flex rounded-xl bg-blue-900/40 p-1 border border-blue-400/25 shrink-0"
          >
            <button
              type="button"
              onClick={() => setAvailabilityFilter('all')}
              className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                availabilityFilter === 'all'
                  ? 'bg-white text-blue-800 shadow-xs'
                  : 'text-blue-100 hover:text-white'
              }`}
            >
              All Lots ({lots.length})
            </button>
            <button
              type="button"
              onClick={() => setAvailabilityFilter('open')}
              className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                availabilityFilter === 'open'
                  ? 'bg-white text-blue-800 shadow-xs'
                  : 'text-blue-100 hover:text-white'
              }`}
            >
              Open Slots Only
            </button>
          </div>
        </div>
      </section>

      {/* Live Aggregate Summary Strip */}
      <section aria-label="Network parking availability summary" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total Parking Bays</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {aggregateStats.total}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <p className="text-xs font-medium text-emerald-700">Available Now</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {aggregateStats.available}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-4">
          <p className="text-xs font-medium text-amber-800">Reserved (Awaiting Check-In)</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-800 tabular-nums">
            {aggregateStats.reserved}
          </p>
        </div>
        <div className="rounded-xl border border-red-200 bg-white p-4">
          <p className="text-xs font-medium text-red-800">Currently Occupied</p>
          <p className="mt-1 font-display text-2xl font-bold text-red-700 tabular-nums">
            {aggregateStats.occupied}
          </p>
        </div>
      </section>

      {/* Parking Lots Directory */}
      <section aria-labelledby="parking-lots-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="parking-lots-heading" className="font-display text-xl font-bold text-slate-900">
              Available Parking Facilities
            </h2>
            <p className="text-sm text-slate-500">
              Select a parking facility to view its live slot map and reserve an open bay.
            </p>
          </div>
        </div>

        {loadingLots ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-80 rounded-xl border border-slate-200 bg-white animate-pulse"
              />
            ))}
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <Building2 className="mx-auto h-9 w-9 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
              No matching parking lots found
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Try clearing your search query or switching to "All Lots".
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setAvailabilityFilter('all');
              }}
              className="mt-4 min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredLots.map((lot) => {
              const isSelected = lot._id === selectedLotId;
              const imgFailed = failedImages[lot._id] || !lot.imageUrl;

              return (
                <article
                  key={lot._id}
                  className={`flex flex-col justify-between rounded-xl border bg-white overflow-hidden transition-all duration-150 ${
                    isSelected
                      ? 'border-blue-600 ring-2 ring-blue-600/15 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="relative h-40 w-full bg-slate-100 overflow-hidden">
                      {!imgFailed ? (
                        <img
                          src={lot.imageUrl}
                          alt={`${lot.name} parking facility`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages((prev) => ({ ...prev, [lot._id]: true }))
                          }
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 text-slate-500">
                          <Building2 className="h-8 w-8 text-blue-600/70" aria-hidden="true" />
                          <span className="mt-1.5 text-xs font-medium text-slate-600">
                            {lot.name}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-display text-lg font-bold text-slate-900">
                          {lot.name}
                        </h3>
                        <span className="font-mono text-sm font-semibold text-blue-700 tabular-nums whitespace-nowrap shrink-0">
                          ${lot.hourlyRate.toFixed(2)}/hr
                        </span>
                      </div>

                      <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {lot.address}, {lot.city}
                        </span>
                      </p>

                      <p className="mt-2.5 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {lot.description || lot.operatingHours}
                      </p>

                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[11px] text-slate-500">Total</p>
                          <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                            {lot.totalSlots}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-emerald-700">Available</p>
                          <p className="font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                            {lot.availableSlots}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-red-700">Occupied</p>
                          <p className="font-mono text-sm font-semibold text-red-700 tabular-nums">
                            {lot.occupiedSlots}
                          </p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        {lot.operatingHours}
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        Est. 2h stay:{' '}
                        <span className="font-mono font-medium text-slate-700 tabular-nums">
                          ${(lot.hourlyRate * 2).toFixed(2)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      onClick={() => setSelectedLotId(lot._id)}
                      className={`w-full min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        isSelected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {isSelected ? 'Viewing Live Slots' : 'View Live Slots'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Live Selected Parking Lot Slot Grid */}
      {selectedLotDetail ? (
        <section
          aria-labelledby="live-slots-heading"
          className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs"
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <h2 id="live-slots-heading" className="font-display text-xl font-bold text-slate-900">
                Live Slot Grid — {selectedLotDetail.name}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedLotDetail.address}, {selectedLotDetail.city}
                <span aria-hidden="true" className="mx-2">·</span>
                <span className="font-mono tabular-nums">
                  ${selectedLotDetail.hourlyRate.toFixed(2)}/hr
                </span>
                <span aria-hidden="true" className="mx-2">·</span>
                <span className="text-emerald-700 font-medium tabular-nums">
                  {selectedLotDetail.availableSlots} of {selectedLotDetail.totalSlots} slots open
                </span>
              </p>
            </div>

            {/* Accessible Legend (Icon + Text + Color) */}
            <div
              aria-label="Slot status legend"
              className="flex flex-wrap items-center gap-3 text-xs font-medium"
            >
              <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>Green: Available</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                <Clock className="h-3.5 w-3.5 text-amber-800" aria-hidden="true" />
                <span>Yellow: Reserved</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-900">
                <Car className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                <span>Red: Occupied</span>
              </div>
            </div>
          </div>

          {user ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200/80 px-4 py-2.5 text-xs text-slate-700">
              <span>
                Signed in as <strong className="text-slate-900">{user.name}</strong>
              </span>
              <span className="font-mono tabular-nums">
                Active Reservations: <strong>{user.activeReservationsCount}</strong> /{' '}
                {user.maxActiveReservations} max
              </span>
            </div>
          ) : null}

          {loadingSlots ? (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-44 rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-700">
                No parking slots configured for this facility yet.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {slots.map((slot) => (
                <SlotCard
                  key={slot._id}
                  slot={slot}
                  hourlyRate={selectedLotDetail.hourlyRate}
                  reservingSlotId={reservingSlotId}
                  actionLoadingId={actionLoadingId}
                  onReserve={handleReserve}
                  onCheckIn={handleCheckIn}
                  onCancel={handleCancel}
                  onCheckout={handleCheckout}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
