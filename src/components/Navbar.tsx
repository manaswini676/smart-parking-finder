import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export type ActivePage = 'dashboard' | 'reservations' | 'admin';

interface NavbarProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  onOpenAuth: () => void;
}

export function Navbar({ activePage, onNavigate, onOpenAuth }: NavbarProps) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (page: ActivePage) => {
    if ((page === 'reservations' || page === 'admin') && !user) {
      onOpenAuth();
      setMobileOpen(false);
      return;
    }
    onNavigate(page);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleNav('dashboard')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
        >
          SmartPark Finder
        </button>

        {/* Zone 2: Primary Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => handleNav('dashboard')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              activePage === 'dashboard'
                ? 'border-blue-600 text-blue-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Parking Lots
          </button>

          <button
            type="button"
            onClick={() => handleNav('reservations')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              activePage === 'reservations'
                ? 'border-blue-600 text-blue-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            My Reservations
            {user && user.activeReservationsCount > 0 ? (
              <span className="ml-1.5 font-mono text-xs text-blue-700 tabular-nums">
                ({user.activeReservationsCount})
              </span>
            ) : null}
          </button>

          {user?.role === 'admin' ? (
            <button
              type="button"
              onClick={() => handleNav('admin')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                activePage === 'admin'
                  ? 'border-blue-600 text-blue-700 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              Admin Console
            </button>
          ) : null}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {user ? (
            <>
              <span className="text-sm text-slate-600 whitespace-nowrap truncate max-w-[180px]">
                {user.name}
                {user.role === 'admin' ? ' · Admin' : ''}
              </span>
              <button
                type="button"
                onClick={logout}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Sign Out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Sign In
            </button>
          )}
        </div>

        {/* Mobile Menu Trigger */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation menu"
          className="md:hidden inline-flex items-center justify-center rounded-lg p-2 text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen ? (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => handleNav('dashboard')}
            className={`block w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium min-h-[44px] ${
              activePage === 'dashboard'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Parking Lots
          </button>
          <button
            type="button"
            onClick={() => handleNav('reservations')}
            className={`block w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium min-h-[44px] ${
              activePage === 'reservations'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            My Reservations
            {user && user.activeReservationsCount > 0 ? ` (${user.activeReservationsCount})` : ''}
          </button>
          {user?.role === 'admin' ? (
            <button
              type="button"
              onClick={() => handleNav('admin')}
              className={`block w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium min-h-[44px] ${
                activePage === 'admin'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              Admin Console
            </button>
          ) : null}

          <div className="pt-2 border-t border-slate-100">
            {user ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-600 truncate">{user.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileOpen(false);
                  }}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  onOpenAuth();
                }}
                className="w-full min-h-[44px] rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
