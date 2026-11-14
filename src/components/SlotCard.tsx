import { Car, CheckCircle2, Clock } from 'lucide-react';
import type { ParkingSlot } from '../types/parking';

interface SlotCardProps {
  slot: ParkingSlot;
  hourlyRate: number;
  reservingSlotId: string | null;
  actionLoadingId: string | null;
  onReserve: (slot: ParkingSlot) => void;
  onCheckIn?: (reservationId: string) => void;
  onCancel?: (reservationId: string) => void;
  onCheckout?: (reservationId: string) => void;
}

const VEHICLE_LABELS: Record<ParkingSlot['vehicleType'], string> = {
  standard: 'Standard Bay',
  ev: 'EV Charging Bay',
  accessible: 'Accessible Bay',
};

export function SlotCard({
  slot,
  hourlyRate,
  reservingSlotId,
  actionLoadingId,
  onReserve,
  onCheckIn,
  onCancel,
  onCheckout,
}: SlotCardProps) {
  const isAvailable = slot.status === 'available';
  const isReserved = slot.status === 'reserved';
  const isOccupied = slot.status === 'occupied';
  const owned = slot.ownedReservation;

  const cardSurface = isAvailable
    ? 'border-emerald-200 bg-emerald-50/40'
    : isReserved
      ? 'border-amber-200 bg-amber-50/40'
      : 'border-red-200 bg-red-50/40';

  const statusTextStyle = isAvailable
    ? 'text-emerald-800 bg-emerald-100/80 border-emerald-200'
    : isReserved
      ? 'text-amber-900 bg-amber-100/80 border-amber-200'
      : 'text-red-900 bg-red-100/80 border-red-200';

  const statusLabel = isAvailable
    ? 'Available'
    : isReserved
      ? 'Reserved'
      : 'Occupied';

  const canCancelOwned =
    owned &&
    owned.status === 'confirmed' &&
    new Date(owned.cancelDeadline).getTime() > Date.now();

  return (
    <article
      aria-label={`Parking Slot ${slot.slotNumber}, status ${statusLabel}`}
      className={`flex flex-col justify-between rounded-xl border p-4 transition-colors duration-150 ${cardSurface}`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-xs font-medium text-slate-500">{slot.zone}</p>
            <h3 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Slot {slot.slotNumber}
            </h3>
          </div>

          {/* Explicit Icon + Text Status Indicator (Never color-only) */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${statusTextStyle}`}
          >
            {isAvailable ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            ) : isReserved ? (
              <Clock className="h-3.5 w-3.5 text-amber-800" aria-hidden="true" />
            ) : (
              <Car className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
            )}
            <span>{statusLabel}</span>
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-600">
          {VEHICLE_LABELS[slot.vehicleType]}
          <span aria-hidden="true" className="mx-1.5">·</span>
          <span className="font-mono tabular-nums">${hourlyRate.toFixed(2)}/hr</span>
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200/70">
        {isAvailable ? (
          <button
            type="button"
            disabled={reservingSlotId === slot._id}
            onClick={() => onReserve(slot)}
            className="w-full min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {reservingSlotId === slot._id ? 'Reserving...' : `Reserve Slot ${slot.slotNumber}`}
          </button>
        ) : owned ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-blue-800">
              {owned.status === 'confirmed' ? 'Your Reserved Slot' : 'Checked In · Active Stay'}
            </p>
            <div className="flex flex-wrap gap-2">
              {owned.status === 'confirmed' && onCheckIn ? (
                <button
                  type="button"
                  disabled={actionLoadingId === owned._id}
                  onClick={() => onCheckIn(owned._id)}
                  className="flex-1 min-h-[40px] rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {actionLoadingId === owned._id ? 'Working...' : 'Check In'}
                </button>
              ) : null}
              {owned.status === 'confirmed' && canCancelOwned && onCancel ? (
                <button
                  type="button"
                  disabled={actionLoadingId === owned._id}
                  onClick={() => onCancel(owned._id)}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Cancel
                </button>
              ) : null}
              {owned.status === 'checked_in' && onCheckout ? (
                <button
                  type="button"
                  disabled={actionLoadingId === owned._id}
                  onClick={() => onCheckout(owned._id)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {actionLoadingId === owned._id ? 'Completing...' : 'Complete & Exit'}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="min-h-[40px] flex items-center justify-between text-xs text-slate-600">
            <span>{isReserved ? 'Held awaiting driver check-in' : 'Currently occupied'}</span>
          </div>
        )}
      </div>
    </article>
  );
}
