/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal } from './components/AuthModal';
import { MyReservationsPage } from './components/MyReservationsPage';
import { Navbar, type ActivePage } from './components/Navbar';
import { ParkingDashboard } from './components/ParkingDashboard';
import { ReservationModal } from './components/ReservationModal';
import { ToastContainer } from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ApiError, api } from './lib/api';
import { getSocket } from './lib/socket';
import type { Reservation, ToastMessage } from './types/parking';

function AppShell() {
  const { user, refreshProfile } = useAuth();
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [confirmedReservation, setConfirmedReservation] = useState<Reservation | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
      setTimeout(() => {
        dismissToast(id);
      }, 5000);
    },
    [dismissToast]
  );

  // Redirect away from protected pages if signed out
  useEffect(() => {
    if (!user && (activePage === 'reservations' || activePage === 'admin')) {
      setActivePage('dashboard');
    } else if (user && user.role !== 'admin' && activePage === 'admin') {
      setActivePage('dashboard');
    }
  }, [user, activePage]);

  // Listen for real-time reservation expiration notifications on user channel
  useEffect(() => {
    const socket = getSocket();
    const handleReservationUpdated = (res: Reservation) => {
      if (res.status === 'expired' && user && res.userId === user.id) {
        refreshProfile();
        notify(
          'info',
          'Reservation Expired',
          `Reservation ${res.reservationCode} (Slot ${res.slotNumber}) expired after 15 minutes without check-in.`
        );
      }
    };
    socket.on('reservation:updated', handleReservationUpdated);
    return () => {
      socket.off('reservation:updated', handleReservationUpdated);
    };
  }, [user, refreshProfile, notify]);

  const handleCheckInFromModal = async (reservationId: string) => {
    try {
      const { reservation } = await api.reservations.checkIn(reservationId);
      await refreshProfile();
      notify(
        'success',
        'Checked In Successfully',
        `Slot ${reservation.slotNumber} at ${reservation.parkingLotName} is now occupied.`
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Check-in failed.';
      notify('error', 'Check-In Rejected', msg);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activePage === 'dashboard' ? (
          <ParkingDashboard
            onRequireAuth={() => setAuthModalOpen(true)}
            onReservationCreated={(res) => setConfirmedReservation(res)}
            onNotify={notify}
          />
        ) : activePage === 'reservations' && user ? (
          <MyReservationsPage
            onBackToLots={() => setActivePage('dashboard')}
            onNotify={notify}
          />
        ) : activePage === 'admin' && user?.role === 'admin' ? (
          <AdminDashboard onNotify={notify} />
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:px-6 lg:px-8">
          <p>SmartPark Finder — Real-Time Parking Slot Reservation System</p>
          <p>15-minute arrival hold · Max 2 active bays · 5-minute cancellation window</p>
        </div>
      </footer>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(msg) => notify('success', 'Authenticated', msg)}
      />

      <ReservationModal
        reservation={confirmedReservation}
        onClose={() => setConfirmedReservation(null)}
        onCheckInNow={handleCheckInFromModal}
        onViewMyReservations={() => setActivePage('reservations')}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
