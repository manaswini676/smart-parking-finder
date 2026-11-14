import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createAppServer } from '../server.ts';
import { disconnectDatabase } from '../server/config/db.ts';
import { Reservation } from '../server/models/Reservation.ts';

async function runTests() {
  console.log('Starting SmartPark Finder end-to-end integration test...');
  const { httpServer, stop } = await createAppServer({ skipFrontend: true });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind test HTTP server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`Test server listening on ${baseUrl}`);

  const socketClient = ioClient(baseUrl, { transports: ['websocket'] });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
      socketClient.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // 1. Register two distinct test drivers
    const reg1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Driver One',
        email: `driver1_${Date.now()}@test.io`,
        password: 'Password123',
        vehicleNumber: 'TEST-001',
      }),
    }).then((r) => r.json());
    assert.ok(reg1.token, 'Driver 1 registration should return JWT token');

    const reg2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Driver Two',
        email: `driver2_${Date.now()}@test.io`,
        password: 'Password123',
        vehicleNumber: 'TEST-002',
      }),
    }).then((r) => r.json());
    assert.ok(reg2.token, 'Driver 2 registration should return JWT token');

    // 2. Login as Admin
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@smartpark.io',
        password: 'Admin@1234',
      }),
    }).then((r) => r.json());
    assert.equal(adminLogin.user.role, 'admin', 'Admin login must return admin role');

    // 3. Fetch Lots & pick Harbor View Deck (all 6 slots A-F available)
    const lotsRes = await fetch(`${baseUrl}/api/lots`).then((r) => r.json());
    const targetLot = lotsRes.lots.find((l: { name: string }) => l.name === 'Harbor View Deck');
    assert.ok(targetLot, 'Harbor View Deck seed lot should exist');

    const detailRes = await fetch(`${baseUrl}/api/lots/${targetLot._id}`).then((r) => r.json());
    const slots = detailRes.slots as Array<{ _id: string; slotNumber: string; status: string }>;
    assert.ok(slots.length >= 6, 'Lot must have at least 6 slots (A-F)');

    const slotA = slots.find((s) => s.slotNumber === 'A')!;
    const slotB = slots.find((s) => s.slotNumber === 'B')!;
    const slotC = slots.find((s) => s.slotNumber === 'C')!;
    assert.ok(slotA && slotB && slotC, 'Slots A, B, C must exist');

    // Join lot room on Socket.IO and listen for live slot:updated within 2 seconds
    socketClient.emit('lot:join', targetLot._id);
    const socketEvents: Array<{ _id: string; status: string; receivedAt: number }> = [];
    socketClient.on('slot:updated', (payload) => {
      socketEvents.push({ ...payload, receivedAt: Date.now() });
    });

    // 4. Double-Booking Prevention Test (concurrent POST /api/reservations on Slot A)
    const startTs = Date.now();
    const [book1, book2] = await Promise.all([
      fetch(`${baseUrl}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${reg1.token}`,
        },
        body: JSON.stringify({ slotId: slotA._id }),
      }),
      fetch(`${baseUrl}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${reg2.token}`,
        },
        body: JSON.stringify({ slotId: slotA._id }),
      }),
    ]);

    const statuses = [book1.status, book2.status].sort();
    assert.deepEqual(
      statuses,
      [201, 409],
      `Concurrent double-booking attempt must yield [201, 409], got ${JSON.stringify(statuses)}`
    );
    console.log('[PASS] Concurrent double-booking prevention: [201, 409]');

    // Wait briefly for Socket.IO event propagation (< 2s requirement)
    await new Promise((r) => setTimeout(r, 250));
    const slotAUpdate = socketEvents.find((e) => e._id === slotA._id && e.status === 'reserved');
    assert.ok(slotAUpdate, 'Socket.IO must broadcast slot:updated = reserved');
    assert.ok(
      slotAUpdate.receivedAt - startTs < 2000,
      'Real-time update must arrive within 2 seconds'
    );
    console.log(
      `[PASS] Real-time Socket.IO slot:updated delivered in ${slotAUpdate.receivedAt - startTs}ms (< 2000ms)`
    );

    const winnerBody = book1.status === 201 ? await book1.json() : await book2.json();
    const winnerToken = book1.status === 201 ? reg1.token : reg2.token;
    const res1Id = winnerBody.reservation._id as string;

    // 5. Max 2 Active Reservations Limit Test (for winnerToken)
    const res2Resp = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${winnerToken}`,
      },
      body: JSON.stringify({ slotId: slotB._id }),
    });
    assert.equal(res2Resp.status, 201, '2nd active reservation should succeed');
    const res2Body = await res2Resp.json();
    const res2Id = res2Body.reservation._id as string;

    const res3Resp = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${winnerToken}`,
      },
      body: JSON.stringify({ slotId: slotC._id }),
    });
    assert.equal(res3Resp.status, 409, '3rd active reservation must be rejected (max 2 limit)');
    console.log('[PASS] Maximum 2 active reservations per driver enforced');

    // 6. 5-Minute Cancellation Rule Test
    // 6a: Cancel within 5 minutes -> succeeds
    const cancelOkResp = await fetch(`${baseUrl}/api/reservations/${res2Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${winnerToken}` },
    });
    assert.equal(cancelOkResp.status, 200, 'Cancel within 5 minutes must succeed');

    // 6b: Re-book Slot B, then simulate >5 minutes elapsed -> cancel must be rejected
    const res2Again = await fetch(`${baseUrl}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${winnerToken}`,
      },
      body: JSON.stringify({ slotId: slotB._id }),
    }).then((r) => r.json());
    const res2AgainId = res2Again.reservation._id as string;

    await Reservation.findByIdAndUpdate(res2AgainId, {
      $set: {
        bookingTime: new Date(Date.now() - 6 * 60 * 1000),
        cancelDeadline: new Date(Date.now() - 60 * 1000),
      },
    });

    const cancelLateResp = await fetch(`${baseUrl}/api/reservations/${res2AgainId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${winnerToken}` },
    });
    assert.equal(cancelLateResp.status, 400, 'Cancel after 5 minutes must be rejected');
    console.log('[PASS] 5-minute cancellation window enforced');

    // 7. 15-Minute Expiration & Check-In Rejection Test
    await Reservation.findByIdAndUpdate(res2AgainId, {
      $set: {
        bookingTime: new Date(Date.now() - 16 * 60 * 1000),
        expirationTime: new Date(Date.now() - 60 * 1000),
      },
    });

    const expiredCheckInResp = await fetch(`${baseUrl}/api/reservations/${res2AgainId}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${winnerToken}` },
    });
    assert.equal(expiredCheckInResp.status, 400, 'Check-in on expired reservation must fail');

    const slotBAfterExpiry = await fetch(`${baseUrl}/api/lots/${targetLot._id}`)
      .then((r) => r.json())
      .then((d) => d.slots.find((s: { _id: string }) => s._id === slotB._id));
    assert.equal(
      slotBAfterExpiry.status,
      'available',
      'Expired reservation must immediately return slot to available'
    );
    console.log('[PASS] 15-minute expiration & automatic slot release verified');

    // 8. Check-In Within 15 Minutes + Complete & Exit
    const checkInOkResp = await fetch(`${baseUrl}/api/reservations/${res1Id}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${winnerToken}` },
    });
    assert.equal(checkInOkResp.status, 200, 'Valid check-in within 15 mins must succeed');
    const checkInBody = await checkInOkResp.json();
    assert.equal(checkInBody.reservation.status, 'checked_in');

    const slotAAfterCheckIn = await fetch(`${baseUrl}/api/lots/${targetLot._id}`)
      .then((r) => r.json())
      .then((d) => d.slots.find((s: { _id: string }) => s._id === slotA._id));
    assert.equal(slotAAfterCheckIn.status, 'occupied', 'Check-in must mark slot as occupied');

    const checkoutResp = await fetch(`${baseUrl}/api/reservations/${res1Id}/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${winnerToken}` },
    });
    assert.equal(checkoutResp.status, 200, 'Checkout must succeed');
    console.log('[PASS] Check-in -> Occupied -> Complete & Exit lifecycle verified');

    // 9. Admin CRUD Verification
    const createLotResp = await fetch(`${baseUrl}/api/admin/lots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.token}`,
      },
      body: JSON.stringify({
        name: 'Test Civic Lot',
        address: '99 Test Ave',
        city: 'San Francisco, CA',
        hourlyRate: 7.5,
        initialSlotLabels: ['A', 'B', 'C', 'D', 'E', 'F'],
      }),
    });
    assert.equal(createLotResp.status, 201, 'Admin create lot must succeed');
    const createdLotBody = await createLotResp.json();

    const addSlotResp = await fetch(
      `${baseUrl}/api/admin/lots/${createdLotBody.lot._id}/slots`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`,
        },
        body: JSON.stringify({ slotNumber: 'G', zone: 'Level 2', vehicleType: 'ev' }),
      }
    );
    assert.equal(addSlotResp.status, 201, 'Admin add slot must succeed');

    const deleteLotResp = await fetch(
      `${baseUrl}/api/admin/lots/${createdLotBody.lot._id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminLogin.token}` },
      }
    );
    assert.equal(deleteLotResp.status, 200, 'Admin delete empty lot must succeed');
    console.log('[PASS] Admin lot & slot CRUD verified');

    console.log('\nALL SMARTPARK INTEGRATION TESTS PASSED!');
  } finally {
    stop();
    socketClient.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await disconnectDatabase();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  });
