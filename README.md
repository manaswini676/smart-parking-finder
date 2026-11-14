# SmartPark Finder — Real-Time Parking Slot Reservation System

A full-stack MERN (MongoDB, Express.js, React.js, Node.js) application with real-time Socket.IO slot synchronization, JWT authentication, ACID-compliant MongoDB reservation transactions, and an operations Admin Console.

## Architecture & Folder Structure

```
├── server.ts                          # Express + HTTP + Socket.IO + Vite server (Port 3000)
├── server/
│   ├── config/db.ts                   # MongoDB connection (MONGODB_URI or embedded Replica Set)
│   ├── middleware/auth.ts             # JWT verification & role-based access control
│   ├── models/
│   │   ├── User.ts                    # Users collection schema
│   │   ├── ParkingLot.ts              # ParkingLots collection schema
│   │   ├── ParkingSlot.ts             # ParkingSlots collection schema (A–F+ labels)
│   │   └── Reservation.ts             # Reservations collection + partial unique active index
│   ├── routes/
│   │   ├── auth.ts                    # /api/auth/* (register, login, profile)
│   │   ├── lots.ts                    # /api/lots/* (search, lot details, live slots)
│   │   ├── reservations.ts            # /api/reservations/* (book, my, check-in, cancel, checkout)
│   │   └── admin.ts                   # /api/admin/* (lot/slot CRUD, monitor, force release)
│   ├── seed/seedData.ts               # Default urban parking lots, slots (A–F), & demo users
│   ├── services/reservationService.ts # ACID transaction logic & 15-minute expiration worker
│   └── socket/index.ts                # Room-based Socket.IO broadcast manager
├── src/
│   ├── components/                    # Navbar, AuthModal, ParkingDashboard, SlotCard, etc.
│   ├── context/AuthContext.tsx        # JWT auth provider
│   ├── lib/api.ts                     # Typed REST API client
│   ├── lib/socket.ts                  # Auto-reconnecting Socket.IO client
│   └── types/parking.ts               # Shared TypeScript interfaces
└── scripts/test-system.ts             # End-to-end integration test suite
```

## Implemented Business Rules & Backend Guarantees

- **Double-Booking Prevention**: Multi-document ACID MongoDB transactions (`session.withTransaction`), atomic conditional slot updates (`status: 'available' -> 'reserved'`), and a database-level partial unique index on `Reservations` (`{ slotId: 1 }` where `status in ['confirmed', 'checked_in']`).
- **15-Minute Expiration Window**: Un-checked-in reservations expire automatically after 15 minutes via a 5-second background worker and inline validation, releasing the slot back to `available` and notifying connected clients via Socket.IO.
- **Maximum 2 Active Reservations**: Enforced transactionally on the backend per driver.
- **5-Minute Cancellation Rule**: Drivers can cancel a confirmed reservation only within 5 minutes of booking.
- **Accessible Slot Cards**: Every slot displays a prominent label (`Slot A` – `Slot F`), color indicator, icon, and explicit text status (`Available`, `Reserved`, `Occupied`).

## Installation & Execution

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` if connecting to an external MongoDB Atlas or local replica set:
   ```bash
   cp .env.example .env
   ```
   > Note: If `MONGODB_URI` is left blank, the server automatically starts an embedded MongoDB Replica Set (`mongodb-memory-server`) with WiredTiger ACID transaction support so the application runs immediately out of the box.

3. **Run in development mode**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

4. **Run automated integration tests**:
   ```bash
   npx tsx scripts/test-system.ts
   ```

5. **Build and run for production**:
   ```bash
   npm run build
   npm start
   ```

## Demo Accounts

- **Driver**: `driver@smartpark.io` / `Driver@1234`
- **Admin**: `admin@smartpark.io` / `Admin@1234`
