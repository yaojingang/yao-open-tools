import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { ServiceError } from "../utils/errors.js";

const registrationLimitTtlSeconds = 60 * 60 * 24 * 2;

interface DailyRegistrationLimitInput {
  ip?: string;
  clientId?: string | string[];
  userAgent?: string;
  hashSalt: string;
  now?: Date;
}

export interface RegistrationReservation {
  keys: string[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function hashIdentity(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

function registrationLimitKeys(input: DailyRegistrationLimitInput): string[] {
  const day = dayKey(input.now ?? new Date());
  const ipIdentity = input.ip?.trim() || "unknown-ip";
  const clientIdentity = normalizeHeaderValue(input.clientId) || input.userAgent?.trim() || "unknown-client";

  return [
    `tokurl:register:ip:${day}:${hashIdentity(ipIdentity, input.hashSalt)}`,
    `tokurl:register:client:${day}:${hashIdentity(clientIdentity, input.hashSalt)}`
  ];
}

async function releaseReservation(redis: Redis, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await redis.del(...keys);
}

export async function reserveDailyRegistrationSlot(redis: Redis, input: DailyRegistrationLimitInput): Promise<RegistrationReservation> {
  const keys = registrationLimitKeys(input);
  const reservedKeys: string[] = [];

  for (const key of keys) {
    const reserved = await redis.set(key, "1", "EX", registrationLimitTtlSeconds, "NX");
    if (reserved !== "OK") {
      await releaseReservation(redis, reservedKeys);
      throw new ServiceError(429, "Daily registration quota exceeded.", "daily_registration_quota_exceeded");
    }

    reservedKeys.push(key);
  }

  return {
    keys: reservedKeys
  };
}

export async function releaseDailyRegistrationSlot(redis: Redis, reservation: RegistrationReservation | null | undefined): Promise<void> {
  await releaseReservation(redis, reservation?.keys ?? []);
}
