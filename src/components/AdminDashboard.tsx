import {
  Building2,
  Edit3,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type {
  AdminSummary,
  ParkingLot,
  ParkingSlot,
  Reservation,
  SlotVehicleType,
} from '../types/parking';

interface AdminDashboardProps {
  onNotify: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
}

export function AdminDashboard({ onNotify }: AdminDashboardProps) {
  const [summary, setSummary] = useState<AdminSummary>({
    totalLots: 0,
    totalSlots: 0,
    availableSlots: 0,
    reservedSlots: 0,
    occupiedSlots: 0,
    activeReservations: 0,
  });
  const [lots, setLots] = useState<ParkingLot[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'lots' | 'reservations'>('lots');

  // Add/Edit Lot Modal State
  const [showLotForm, setShowLotForm] = useState(false);
  const [editingLot, setEditingLot] = useState<ParkingLot | null>(null);
  const [lotName, setLotName] = useState('');
  const [lotAddress, setLotAddress] = useState('');
  const [lotCity, setLotCity] = useState('');
  const [lotRate, setLotRate] = useState('5.00');
  const [lotHours, setLotHours] = useState('24/7 Open Access');
  const [lotDesc, setLotDesc] = useState('');
  const [lotInitialSlots, setLotInitialSlots] = useState('A, B, C, D, E, F');
  const [savingLot, setSavingLot] = useState(false);

  // Slot Management State
  const [managingLotId, setManagingLotId] = useState<string | null>(null);
  const [newSlotLabel, setNewSlotLabel] = useState('');
  const [newSlotZone, setNewSlotZone] = useState('Level 1');
  const [newSlotType, setNewSlotType] = useState<SlotVehicleType>('standard');
  const [savingSlot, setSavingSlot] = useState(false);

  // Reservation Table Filters
  const [resSearch, setResSearch] = useState('');
  const [resStatusFilter, setResStatusFilter] = useState('all');

  const fetchOverview = useCallback(async () => {
    try {
      const data = await api.admin.overview();
      setSummary(data.summary);
      setLots(data.lots);
      setReservations(data.reservations);
      setManagingLotId((prev) => {
        if (prev && data.lots.some((l) => l._id === prev)) return prev;
        return data.lots[0]?._id || null;
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load admin console.';
      onNotify('error', 'Admin Load Error', msg);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      fetchOverview();
    };
    socket.on('slot:updated', refresh);
    socket.on('reservation:created', refresh);
    socket.on('reservation:updated', refresh);
    socket.on('lots:changed', refresh);

    return () => {
      socket.off('slot:updated', refresh);
      socket.off('reservation:created', refresh);
      socket.off('reservation:updated', refresh);
      socket.off('lots:changed', refresh);
    };
  }, [fetchOverview]);

  const openCreateLot = () => {
    setEditingLot(null);
    setLotName('');
    setLotAddress('');
    setLotCity('');
    setLotRate('5.00');
    setLotHours('24/7 Open Access');
    setLotDesc('');
    setLotInitialSlots('A, B, C, D, E, F');
    setShowLotForm(true);
  };

  const openEditLot = (lot: ParkingLot) => {
    setEditingLot(lot);
    setLotName(lot.name);
    setLotAddress(lot.address);
    setLotCity(lot.city);
    setLotRate(String(lot.hourlyRate));
    setLotHours(lot.operatingHours);
    setLotDesc(lot.description);
    setShowLotForm(true);
  };

  const handleSaveLot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLot(true);
    try {
      const hourlyRate = parseFloat(lotRate);
      if (editingLot) {
        await api.admin.updateLot(editingLot._id, {
          name: lotName,
          address: lotAddress,
          city: lotCity,
          hourlyRate,
          operatingHours: lotHours,
          description: lotDesc,
        });
        onNotify('success', 'Lot Updated', `${lotName} details saved.`);
      } else {
        const labels = lotInitialSlots
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        await api.admin.createLot({
          name: lotName,
          address: lotAddress,
          city: lotCity,
          hourlyRate,
          operatingHours: lotHours,
          description: lotDesc,
          initialSlotLabels: labels.length > 0 ? labels : ['A', 'B', 'C', 'D', 'E', 'F'],
        });
        onNotify('success', 'Parking Lot Created', `${lotName} added with live slots.`);
      }
      setShowLotForm(false);
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save parking lot.';
      onNotify('error', 'Save Failed', msg);
    } finally {
      setSavingLot(false);
    }
  };

  const handleDeleteLot = async (lot: ParkingLot) => {
    try {
      await api.admin.deleteLot(lot._id);
      onNotify('info', 'Parking Lot Deleted', `${lot.name} removed.`);
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not delete parking lot.';
      onNotify('error', 'Delete Blocked', msg);
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingLotId || !newSlotLabel.trim()) return;
    setSavingSlot(true);
    try {
      await api.admin.addSlot(managingLotId, {
        slotNumber: newSlotLabel.trim().toUpperCase(),
        zone: newSlotZone.trim() || 'Level 1',
        vehicleType: newSlotType,
      });
      setNewSlotLabel('');
      onNotify('success', 'Slot Added', `Slot ${newSlotLabel.toUpperCase()} is now live.`);
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to add slot.';
      onNotify('error', 'Add Slot Error', msg);
    } finally {
      setSavingSlot(false);
    }
  };

  const handleToggleSlotStatus = async (slot: ParkingSlot) => {
    const nextStatus = slot.status === 'available' ? 'occupied' : 'available';
    try {
      await api.admin.patchSlot(slot._id, { status: nextStatus });
      onNotify(
        'info',
        'Slot Updated',
        `Slot ${slot.slotNumber} marked ${nextStatus}.`
      );
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update slot status.';
      onNotify('error', 'Slot Update Blocked', msg);
    }
  };

  const handleDeleteSlot = async (slot: ParkingSlot) => {
    try {
      await api.admin.deleteSlot(slot._id);
      onNotify('info', 'Slot Deleted', `Slot ${slot.slotNumber} removed.`);
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not delete slot.';
      onNotify('error', 'Delete Slot Blocked', msg);
    }
  };

  const handleForceRelease = async (reservationId: string) => {
    try {
      await api.admin.forceReleaseReservation(reservationId);
      onNotify('info', 'Reservation Released', 'Bay returned to available status.');
      await fetchOverview();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not release reservation.';
      onNotify('error', 'Release Failed', msg);
    }
  };

  const managingLot = useMemo(
    () => lots.find((l) => l._id === managingLotId) || null,
    [lots, managingLotId]
  );

  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (resStatusFilter !== 'all' && r.status !== resStatusFilter) return false;
      if (!resSearch.trim()) return true;
      const q = resSearch.toLowerCase();
      return (
        r.reservationCode.toLowerCase().includes(q) ||
        r.parkingLotName.toLowerCase().includes(q) ||
        (r.driverName || '').toLowerCase().includes(q) ||
        (r.driverEmail || '').toLowerCase().includes(q) ||
        r.slotNumber.toLowerCase().includes(q)
      );
    });
  }, [reservations, resStatusFilter, resSearch]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Admin Operations Console
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage parking facilities, configure labeled bays, and monitor live reservations.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateLot}
          className="inline-flex items-center justify-center gap-2 min-h-[42px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add Parking Lot</span>
        </button>
      </div>

      {/* Fleet Summary Metrics */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Parking Lots</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summary.totalLots}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Slots</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summary.totalSlots}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <p className="text-xs text-emerald-700">Available</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {summary.availableSlots}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-4">
          <p className="text-xs text-amber-800">Reserved</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-800 tabular-nums">
            {summary.reservedSlots}
          </p>
        </div>
        <div className="rounded-xl border border-red-200 bg-white p-4">
          <p className="text-xs text-red-800">Occupied</p>
          <p className="mt-1 font-display text-2xl font-bold text-red-700 tabular-nums">
            {summary.occupiedSlots}
          </p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white p-4">
          <p className="text-xs text-blue-700">Active Bookings</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {summary.activeReservations}
          </p>
        </div>
      </section>

      {/* Admin View Switcher */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('lots')}
          className={`min-h-[38px] rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'lots'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Parking Lots & Slots
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reservations')}
          className={`min-h-[38px] rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'reservations'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Reservations ({reservations.length})
        </button>
      </div>

      {loading ? (
        <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />
      ) : activeTab === 'lots' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lots List */}
          <div className="lg:col-span-5 space-y-3">
            {lots.map((lot) => {
              const isSelected = lot._id === managingLotId;
              return (
                <div
                  key={lot._id}
                  className={`rounded-xl border p-4 bg-white transition-colors ${
                    isSelected ? 'border-blue-600 ring-2 ring-blue-600/15' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setManagingLotId(lot._id)}
                      className="text-left flex-1 focus-visible:outline-none"
                    >
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {lot.name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {lot.address}, {lot.city}
                      </p>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditLot(lot)}
                        aria-label={`Edit ${lot.name}`}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLot(lot)}
                        aria-label={`Delete ${lot.name}`}
                        className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 tabular-nums">
                    <span>
                      <strong className="text-emerald-700">{lot.availableSlots}</strong> Open ·{' '}
                      <strong className="text-amber-800">{lot.reservedSlots}</strong> Res ·{' '}
                      <strong className="text-red-700">{lot.occupiedSlots}</strong> Occ
                    </span>
                    <span className="font-mono font-semibold text-slate-900">
                      ${lot.hourlyRate.toFixed(2)}/hr
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Slot Manager Panel for Selected Lot */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-5">
            {managingLot ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Slot Manager — {managingLot.name}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Add new bays or override occupancy states in real time.
                    </p>
                  </div>
                </div>

                {/* Add Slot Form */}
                <form
                  onSubmit={handleAddSlot}
                  className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3.5"
                >
                  <div>
                    <label htmlFor="new-slot-label" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Slot Label
                    </label>
                    <input
                      id="new-slot-label"
                      type="text"
                      required
                      maxLength={10}
                      value={newSlotLabel}
                      onChange={(e) => setNewSlotLabel(e.target.value)}
                      placeholder="G"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm uppercase text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-slot-zone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Zone / Level
                    </label>
                    <input
                      id="new-slot-zone"
                      type="text"
                      value={newSlotZone}
                      onChange={(e) => setNewSlotZone(e.target.value)}
                      placeholder="Level 1"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-slot-type" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Bay Type
                    </label>
                    <select
                      id="new-slot-type"
                      value={newSlotType}
                      onChange={(e) => setNewSlotType(e.target.value as SlotVehicleType)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="standard">Standard</option>
                      <option value="ev">EV Charging</option>
                      <option value="accessible">Accessible</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={savingSlot}
                      className="w-full min-h-[38px] rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {savingSlot ? 'Adding...' : 'Add Slot'}
                    </button>
                  </div>
                </form>

                {/* Slots Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">Slot</th>
                        <th className="px-4 py-2.5">Zone</th>
                        <th className="px-4 py-2.5">Type</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(managingLot.slots || []).map((slot) => (
                        <tr key={slot._id}>
                          <td className="px-4 py-2.5 font-display font-bold text-slate-900">
                            Slot {slot.slotNumber}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">{slot.zone}</td>
                          <td className="px-4 py-2.5 text-xs capitalize text-slate-600">
                            {slot.vehicleType}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold capitalize ${
                                slot.status === 'available'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : slot.status === 'reserved'
                                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                                    : 'border-red-200 bg-red-50 text-red-900'
                              }`}
                            >
                              {slot.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleToggleSlotStatus(slot)}
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {slot.status === 'available' ? 'Set Occupied' : 'Release to Available'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSlot(slot)}
                              className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-sm text-slate-500">
                <Building2 className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                Select or create a parking lot to manage its slots.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Reservations Monitor Tab */
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={resSearch}
                onChange={(e) => setResSearch(e.target.value)}
                placeholder="Search reservation code, driver, email, or lot..."
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <select
              value={resStatusFilter}
              onChange={(e) => setResStatusFilter(e.target.value)}
              aria-label="Filter reservations by status"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Reserved (Confirmed)</option>
              <option value="checked_in">Checked In (Occupied)</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Reservation ID</th>
                  <th className="px-4 py-3">Driver Details</th>
                  <th className="px-4 py-3">Parking Lot & Slot</th>
                  <th className="px-4 py-3">Booking Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReservations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      No matching reservations found.
                    </td>
                  </tr>
                ) : (
                  filteredReservations.map((res) => {
                    const isActive = res.status === 'confirmed' || res.status === 'checked_in';
                    return (
                      <tr key={res._id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                          {res.reservationCode}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{res.driverName}</p>
                          <p className="text-xs text-slate-500">
                            {res.driverEmail}
                            {res.driverVehicle ? ` · ${res.driverVehicle}` : ''}
                          </p>
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
                            className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold capitalize whitespace-nowrap ${
                              res.status === 'confirmed'
                                ? 'border-amber-200 bg-amber-50 text-amber-900'
                                : res.status === 'checked_in'
                                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                                  : res.status === 'completed'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : res.status === 'expired'
                                      ? 'border-red-200 bg-red-50 text-red-800'
                                      : 'border-slate-200 bg-slate-100 text-slate-700'
                            }`}
                          >
                            {res.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isActive ? (
                            <button
                              type="button"
                              onClick={() => handleForceRelease(res._id)}
                              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Force Release
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Parking Lot Modal */}
      {showLotForm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lot-form-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 id="lot-form-title" className="font-display text-lg font-bold text-slate-900">
                {editingLot ? `Edit ${editingLot.name}` : 'Add New Parking Lot'}
              </h2>
              <button
                type="button"
                onClick={() => setShowLotForm(false)}
                aria-label="Close parking lot form"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLot} className="p-6 space-y-4">
              <div>
                <label htmlFor="lot-name" className="block text-sm font-medium text-slate-700 mb-1">
                  Parking Lot Name
                </label>
                <input
                  id="lot-name"
                  type="text"
                  required
                  value={lotName}
                  onChange={(e) => setLotName(e.target.value)}
                  placeholder="Union Square Smart Garage"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="lot-address" className="block text-sm font-medium text-slate-700 mb-1">
                    Street Address
                  </label>
                  <input
                    id="lot-address"
                    type="text"
                    required
                    value={lotAddress}
                    onChange={(e) => setLotAddress(e.target.value)}
                    placeholder="333 Post Street"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="lot-city" className="block text-sm font-medium text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    id="lot-city"
                    type="text"
                    required
                    value={lotCity}
                    onChange={(e) => setLotCity(e.target.value)}
                    placeholder="San Francisco, CA"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="lot-rate" className="block text-sm font-medium text-slate-700 mb-1">
                    Hourly Rate ($ USD)
                  </label>
                  <input
                    id="lot-rate"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    value={lotRate}
                    onChange={(e) => setLotRate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="lot-hours" className="block text-sm font-medium text-slate-700 mb-1">
                    Operating Hours
                  </label>
                  <input
                    id="lot-hours"
                    type="text"
                    value={lotHours}
                    onChange={(e) => setLotHours(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>

              {!editingLot ? (
                <div>
                  <label htmlFor="lot-slots" className="block text-sm font-medium text-slate-700 mb-1">
                    Initial Slot Labels (comma-separated)
                  </label>
                  <input
                    id="lot-slots"
                    type="text"
                    value={lotInitialSlots}
                    onChange={(e) => setLotInitialSlots(e.target.value)}
                    placeholder="A, B, C, D, E, F"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase text-slate-900"
                  />
                </div>
              ) : null}

              <div>
                <label htmlFor="lot-desc" className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  id="lot-desc"
                  rows={2}
                  value={lotDesc}
                  onChange={(e) => setLotDesc(e.target.value)}
                  placeholder="Covered multi-level facility with EV bays and 24/7 license-plate entry."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLotForm(false)}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLot}
                  className="min-h-[40px] rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingLot ? 'Saving...' : editingLot ? 'Save Changes' : 'Create Lot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
