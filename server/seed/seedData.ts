import bcrypt from 'bcryptjs';
import { User } from '../models/User.ts';
import { ParkingLot } from '../models/ParkingLot.ts';
import { ParkingSlot } from '../models/ParkingSlot.ts';
import { Reservation } from '../models/Reservation.ts';

export async function seedInitialData(): Promise<void> {
  const existingUsers = await User.countDocuments();
  const existingLots = await ParkingLot.countDocuments();

  if (existingUsers > 0 && existingLots > 0) {
    return;
  }

  console.log('[Seed] Initializing default SmartPark users, parking lots, and labeled slots...');

  const adminPasswordHash = await bcrypt.hash('Admin@1234', 10);
  const driverPasswordHash = await bcrypt.hash('Driver@1234', 10);

  let adminUser = await User.findOne({ email: 'admin@smartpark.io' });
  if (!adminUser) {
    adminUser = await User.create({
      name: 'Elena Vance',
      email: 'admin@smartpark.io',
      passwordHash: adminPasswordHash,
      role: 'admin',
      vehicleNumber: 'ADMIN-01',
      phone: '+1 (415) 555-0100',
    });
  }

  let demoDriver = await User.findOne({ email: 'driver@smartpark.io' });
  if (!demoDriver) {
    demoDriver = await User.create({
      name: 'Marcus Chen',
      email: 'driver@smartpark.io',
      passwordHash: driverPasswordHash,
      role: 'driver',
      vehicleNumber: 'CA-8EV-402',
      phone: '+1 (415) 555-0148',
    });
  }

  let sampleDriver = await User.findOne({ email: 'alex.rivera@smartpark.io' });
  if (!sampleDriver) {
    sampleDriver = await User.create({
      name: 'Alex Rivera',
      email: 'alex.rivera@smartpark.io',
      passwordHash: driverPasswordHash,
      role: 'driver',
      vehicleNumber: 'CA-9TR-219',
      phone: '+1 (415) 555-0192',
    });
  }

  if (existingLots === 0) {
    const lotsData = [
      {
        name: 'Civic Plaza Garage',
        address: '420 Market Street',
        city: 'San Francisco, CA',
        hourlyRate: 5.5,
        description:
          'Multi-level smart garage steps from Civic Center transit, featuring overhead bay sensors and rapid license-plate entry.',
        imageUrl: '/src/assets/images/lot_civic_plaza_1794631463229.jpg',
        operatingHours: '24/7 Open Access',
        amenities: ['Covered Bays', 'EV Fast Charging', '24/7 Security'],
      },
      {
        name: 'Metro Tech Underground',
        address: '880 Howard Street',
        city: 'San Francisco, CA',
        hourlyRate: 6.0,
        description:
          'Brightly illuminated subterranean commuter hub serving SOMA & Moscone District with dedicated EV and accessible stalls.',
        imageUrl: '/src/assets/images/lot_metro_hub_1794631463727.jpg',
        operatingHours: '05:00 – 23:30 Daily',
        amenities: ['LED Guidance', 'EV Chargers', 'Elevator Access'],
      },
      {
        name: 'Harbor View Deck',
        address: '150 Embarcadero Way',
        city: 'San Francisco, CA',
        hourlyRate: 4.5,
        description:
          'Open-air waterfront parking deck near Ferry Terminal with wide-aisle bays and instant mobile check-in.',
        imageUrl: '/src/assets/images/lot_harbor_deck_1794631463945.jpg',
        operatingHours: '24/7 Open Access',
        amenities: ['Waterfront Access', 'Wide Bays', 'Contactless Gate'],
      },
    ];

    const createdLots = await ParkingLot.insertMany(lotsData);
    const slotLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

    for (let lotIdx = 0; lotIdx < createdLots.length; lotIdx++) {
      const lot = createdLots[lotIdx];
      const slotDocs = slotLabels.map((label, idx) => ({
        parkingLotId: lot._id,
        slotNumber: label,
        zone: lotIdx === 1 ? 'Level B1' : 'Level 1',
        vehicleType: idx === 1 ? 'ev' : idx === 5 ? 'accessible' : 'standard',
        status: 'available' as const,
        currentReservationId: null,
      }));

      const insertedSlots = await ParkingSlot.insertMany(slotDocs);

      // Seed realistic live occupied & reserved examples tied to real reservations for sampleDriver
      if (lotIdx === 0) {
        const slotF = insertedSlots.find((s) => s.slotNumber === 'F');
        if (slotF) {
          const now = new Date();
          const resDoc = await Reservation.create({
            reservationCode: `RES-SEED-${Date.now().toString(36).toUpperCase()}1`,
            userId: sampleDriver._id,
            parkingLotId: lot._id,
            slotId: slotF._id,
            slotNumber: slotF.slotNumber,
            parkingLotName: lot.name,
            hourlyRate: lot.hourlyRate,
            bookingTime: new Date(now.getTime() - 12 * 60 * 1000),
            expirationTime: new Date(now.getTime() + 3 * 60 * 1000),
            cancelDeadline: new Date(now.getTime() - 7 * 60 * 1000),
            checkInTime: new Date(now.getTime() - 8 * 60 * 1000),
            status: 'checked_in',
          });
          await ParkingSlot.findByIdAndUpdate(slotF._id, {
            status: 'occupied',
            currentReservationId: resDoc._id,
          });
        }
      }

      if (lotIdx === 1) {
        const slotE = insertedSlots.find((s) => s.slotNumber === 'E');
        if (slotE) {
          const now = new Date();
          const resDoc = await Reservation.create({
            reservationCode: `RES-SEED-${Date.now().toString(36).toUpperCase()}2`,
            userId: sampleDriver._id,
            parkingLotId: lot._id,
            slotId: slotE._id,
            slotNumber: slotE.slotNumber,
            parkingLotName: lot.name,
            hourlyRate: lot.hourlyRate,
            bookingTime: now,
            expirationTime: new Date(now.getTime() + 15 * 60 * 1000),
            cancelDeadline: new Date(now.getTime() + 5 * 60 * 1000),
            status: 'confirmed',
          });
          await ParkingSlot.findByIdAndUpdate(slotE._id, {
            status: 'reserved',
            currentReservationId: resDoc._id,
          });
        }
      }
    }
  }

  console.log('[Seed] Seed complete. Demo Driver: driver@smartpark.io | Admin: admin@smartpark.io');
}
