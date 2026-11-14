import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type SlotStatus = 'available' | 'reserved' | 'occupied';
export type SlotVehicleType = 'standard' | 'ev' | 'accessible';

export interface IParkingSlot extends Document {
  parkingLotId: Types.ObjectId;
  slotNumber: string;
  zone: string;
  vehicleType: SlotVehicleType;
  status: SlotStatus;
  currentReservationId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ParkingSlotSchema = new Schema<IParkingSlot>(
  {
    parkingLotId: {
      type: Schema.Types.ObjectId,
      ref: 'ParkingLot',
      required: true,
      index: true,
    },
    slotNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 12,
    },
    zone: {
      type: String,
      trim: true,
      default: 'Level 1',
    },
    vehicleType: {
      type: String,
      enum: ['standard', 'ev', 'accessible'],
      default: 'standard',
    },
    status: {
      type: String,
      enum: ['available', 'reserved', 'occupied'],
      default: 'available',
      index: true,
    },
    currentReservationId: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'parkingslots',
  }
);

ParkingSlotSchema.index({ parkingLotId: 1, slotNumber: 1 }, { unique: true });
ParkingSlotSchema.index({ parkingLotId: 1, status: 1 });

export const ParkingSlot =
  mongoose.models.ParkingSlot || mongoose.model<IParkingSlot>('ParkingSlot', ParkingSlotSchema);
