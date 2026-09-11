import { sql } from "drizzle-orm";
import type { DbClient } from "./client.js";

export const registrationLockKey = 7_910_001;
export const activeAdminLockKey = 7_910_002;

export async function withAdvisoryTransactionLock<T>(
  db: DbClient,
  lockKey: number,
  operation: (transaction: DbClient) => Promise<T>
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
    return operation(transaction as unknown as DbClient);
  });
}
