import mongoose, { Schema, type Document } from 'mongoose';

export interface IParkingLot extends Document {
  name: string;
  address: string;
  city: string;
  hourlyRate: number;
  description: string;
  imageUrl: string;
  operatingHours: string;
  amenities: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ParkingLotSchema = new Schema<IParkingLot>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    hourlyRate: {
      type: Number,
      required: true,
      min: 0.5,
      max: 500,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    operatingHours: {
      type: String,
      trim: true,
      default: '24/7 Open Access',
    },
    amenities: {
      type: [String],
      default: ['Covered Parking', '24/7 Security'],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'parkinglots',
  }
);

ParkingLotSchema.index({ name: 'text', address: 'text', city: 'text' });

export const ParkingLot =
  mongoose.models.ParkingLot || mongoose.model<IParkingLot>('ParkingLot', ParkingLotSchema);
