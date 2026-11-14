import { CheckCircle2, Clock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Reservation } from '../types/parking';

interface ReservationModalProps {
  reservation: Reservation | null;
  onClose: () => void;
  onCheckInNow: (reservationId: string) => Promise<void>;
  onViewMyReservations: () => void;
}

function formatCountdown(targetIso: string, nowMs: number): string {
  const diff = Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ReservationModal({
  reservation,
  onClose,
  onCheckInNow,
  onViewMyReservations,
}: ReservationModalProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checkingIn, setCheckingIn] = useState(false);

  useEffect(() => {
    if (!reservation) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [reservation]);

  if (!reservation) return null;

  const bookingDate = new Date(reservation.bookingTime);
  const handleCheckIn = async () => {
    setCheckingIn(true);
    try {
      await onCheckInNow(reservation._id);
      onClose();
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-confirm-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-blue-50/60">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 id="reservation-confirm-title" className="font-display text-lg font-bold text-slate-900">
              Reservation Confirmed
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close confirmation modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Reservation ID</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
              {reservation.reservationCode}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Parking Lot</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{reservation.parkingLotName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reserved Slot</dt>
              <dd className="mt-0.5 font-display text-base font-bold text-blue-700">
                Slot {reservation.slotNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Booking Date</dt>
              <dd className="mt-0.5 font-medium text-slate-800 tabular-nums">
                {bookingDate.toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Booking Time</dt>
              <dd className="mt-0.5 font-medium text-slate-800 tabular-nums">
                {bookingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </dd>
            </div>
          </dl>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <Clock className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-semibold">
                Check-In Window:{' '}
                <span className="font-mono tabular-nums">
                  {formatCountdown(reservation.expirationTime, nowMs)}
                </span>{' '}
                remaining
              </p>
              <p>
                Please check in within 15 minutes or the slot automatically expires and returns to
                available. Free cancellation is available within 5 minutes of booking.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              disabled={checkingIn}
              onClick={handleCheckIn}
              className="flex-1 min-h-[44px] rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {checkingIn ? 'Checking In...' : 'Check In Now'}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onViewMyReservations();
              }}
              className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              View My Reservations
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
