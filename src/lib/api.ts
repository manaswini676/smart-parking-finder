import type {
  AdminSummary,
  ParkingLot,
  ParkingSlot,
  Reservation,
  UserProfile,
} from '../types/parking';

const TOKEN_STORAGE_KEY = 'smartpark_jwt_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  }

  return data as T;
}

export const api = {
  auth: {
    register: (payload: {
      name: string;
      email: string;
      password: string;
      vehicleNumber?: string;
      phone?: string;
    }) =>
      request<{ token: string; user: UserProfile }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    login: (payload: { email: string; password: string }) =>
      request<{ token: string; user: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    me: () => request<{ user: UserProfile }>('/api/auth/me'),
    updateProfile: (payload: { name: string; vehicleNumber: string; phone: string }) =>
      request<{ user: UserProfile }>('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
  },
  lots: {
    list: (search = '') =>
      request<{ lots: ParkingLot[] }>(
        `/api/lots${search ? `?search=${encodeURIComponent(search)}` : ''}`
      ),
    detail: (lotId: string) =>
      request<{ lot: ParkingLot; slots: ParkingSlot[] }>(`/api/lots/${lotId}`),
  },
  reservations: {
    create: (slotId: string) =>
      request<{ reservation: Reservation }>('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({ slotId }),
      }),
    my: () =>
      request<{
        reservations: Reservation[];
        activeCount: number;
        maxActiveReservations: number;
      }>('/api/reservations/my'),
    checkIn: (reservationId: string) =>
      request<{ reservation: Reservation }>(`/api/reservations/${reservationId}/checkin`, {
        method: 'POST',
      }),
    cancel: (reservationId: string) =>
      request<{ reservation: Reservation }>(`/api/reservations/${reservationId}/cancel`, {
        method: 'POST',
      }),
    checkout: (reservationId: string) =>
      request<{ reservation: Reservation }>(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST',
      }),
  },
  admin: {
    overview: () =>
      request<{
        summary: AdminSummary;
        lots: ParkingLot[];
        reservations: Reservation[];
      }>('/api/admin/overview'),
    createLot: (payload: {
      name: string;
      address: string;
      city: string;
      hourlyRate: number;
      description?: string;
      operatingHours?: string;
      amenities?: string[];
      initialSlotLabels?: string[];
    }) =>
      request<{ lot: ParkingLot }>('/api/admin/lots', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateLot: (
      lotId: string,
      payload: Partial<{
        name: string;
        address: string;
        city: string;
        hourlyRate: number;
        description: string;
        operatingHours: string;
      }>
    ) =>
      request<{ lot: ParkingLot }>(`/api/admin/lots/${lotId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteLot: (lotId: string) =>
      request<{ deleted: boolean }>(`/api/admin/lots/${lotId}`, {
        method: 'DELETE',
      }),
    addSlot: (
      lotId: string,
      payload: { slotNumber: string; zone?: string; vehicleType?: 'standard' | 'ev' | 'accessible' }
    ) =>
      request<{ slot: ParkingSlot }>(`/api/admin/lots/${lotId}/slots`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    patchSlot: (
      slotId: string,
      payload: { status?: 'available' | 'occupied'; zone?: string; vehicleType?: 'standard' | 'ev' | 'accessible' }
    ) =>
      request<{ slot: ParkingSlot }>(`/api/admin/slots/${slotId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    deleteSlot: (slotId: string) =>
      request<{ deleted: boolean }>(`/api/admin/slots/${slotId}`, {
        method: 'DELETE',
      }),
    forceReleaseReservation: (reservationId: string) =>
      request<{ reservation: Reservation }>(
        `/api/admin/reservations/${reservationId}/force-release`,
        { method: 'POST' }
      ),
  },
};
