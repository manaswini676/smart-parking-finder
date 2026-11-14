import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type ReservationStatus = 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'expired';

export interface IReservation extends Document {
  reservationCode: string;
  userId: Types.ObjectId;
  parkingLotId: Types.ObjectId;
  slotId: Types.ObjectId;
  slotNumber: string;
  parkingLotName: string;
  hourlyRate: number;
  bookingTime: Date;
  expirationTime: Date;
  cancelDeadline: Date;
  checkInTime: Date | null;
  completedTime: Date | null;
  totalCharge: number | null;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ReservationSchema = new Schema<IReservation>(
  {
    reservationCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    parkingLotId: {
      type: Schema.Types.ObjectId,
      ref: 'ParkingLot',
      required: true,
      index: true,
    },
    slotId: {
      type: Schema.Types.ObjectId,
      ref: 'ParkingSlot',
      required: true,
      index: true,
    },
    slotNumber: {
      type: String,
      required: true,
    },
    parkingLotName: {
      type: String,
      required: true,
    },
    hourlyRate: {
      type: Number,
      required: true,
    },
    bookingTime: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expirationTime: {
      type: Date,
      required: true,
      index: true,
    },
    cancelDeadline: {
      type: Date,
      required: true,
    },
    checkInTime: {
      type: Date,
      default: null,
    },
    completedTime: {
      type: Date,
      default: null,
    },
    totalCharge: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ['confirmed', 'checked_in', 'completed', 'cancelled', 'expired'],
      default: 'confirmed',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'reservations',
  }
);

// Database-level partial unique index guarantees no two active reservations can ever occupy the same slot
ReservationSchema.index(
  { slotId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['confirmed', 'checked_in'] },
    },
  }
);

ReservationSchema.index({ userId: 1, status: 1 });
ReservationSchema.index({ status: 1, expirationTime: 1 });

export const Reservation =
  mongoose.models.Reservation || mongoose.model<IReservation>('Reservation', ReservationSchema);
