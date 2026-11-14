export type UserRole = 'driver' | 'admin';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  vehicleNumber: string;
  phone: string;
  activeReservationsCount: number;
  maxActiveReservations: number;
}

export type SlotStatus = 'available' | 'reserved' | 'occupied';
export type SlotVehicleType = 'standard' | 'ev' | 'accessible';
export type ReservationStatus = 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'expired';

export interface OwnedSlotReservation {
  _id: string;
  status: ReservationStatus;
  expirationTime: string;
  cancelDeadline: string;
}

export interface ParkingSlot {
  _id: string;
  parkingLotId: string;
  slotNumber: string;
  zone: string;
  vehicleType: SlotVehicleType;
  status: SlotStatus;
  currentReservationId: string | null;
  ownedReservation?: OwnedSlotReservation | null;
}

export interface ParkingLot {
  _id: string;
  name: string;
  address: string;
  city: string;
  hourlyRate: number;
  description: string;
  imageUrl: string;
  operatingHours: string;
  amenities: string[];
  isActive: boolean;
  totalSlots: number;
  availableSlots: number;
  reservedSlots: number;
  occupiedSlots: number;
  slots?: ParkingSlot[];
}

export interface Reservation {
  _id: string;
  reservationCode: string;
  userId: string;
  parkingLotId: string;
  parkingLotName: string;
  parkingLotAddress?: string;
  slotId: string;
  slotNumber: string;
  hourlyRate: number;
  bookingTime: string;
  expirationTime: string;
  cancelDeadline: string;
  checkInTime: string | null;
  completedTime: string | null;
  totalCharge: number | null;
  status: ReservationStatus;
  driverName?: string;
  driverEmail?: string;
  driverVehicle?: string;
  driverPhone?: string;
}

export interface AdminSummary {
  totalLots: number;
  totalSlots: number;
  availableSlots: number;
  reservedSlots: number;
  occupiedSlots: number;
  activeReservations: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}
