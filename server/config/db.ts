import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | null = null;
let transactionsSupported = false;

export function supportsTransactions(): boolean {
  return transactionsSupported;
}

async function detectReplicaSetSupport(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const hello = await admin.command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    return false;
  }
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  let uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    console.log('[DB] No MONGODB_URI configured. Starting embedded MongoDB Replica Set for ACID transactions...');
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });
    uri = replSet.getUri('smartpark');
    console.log('[DB] Embedded MongoDB Replica Set ready.');
  }

  await mongoose.connect(uri, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });

  transactionsSupported = await detectReplicaSetSupport();
  console.log(
    `[DB] Connected to MongoDB (${mongoose.connection.name}) | ACID Transactions: ${
      transactionsSupported ? 'ENABLED (Replica Set)' : 'ATOMIC FALLBACK'
    }`
  );
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}
