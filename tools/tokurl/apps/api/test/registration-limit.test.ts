import { describe, expect, it, vi } from "vitest";
import { reserveDailyRegistrationSlot } from "../src/services/registration-limit.js";

function createRedisMock(blockPattern?: string) {
  const set = vi.fn(async (key: string) => (blockPattern && key.includes(blockPattern) ? null : "OK"));
  const del = vi.fn(async () => 1);

  return {
    redis: {
      set,
      del
    } as never,
    mocks: {
      set,
      del
    }
  };
}

describe("daily registration limit", () => {
  it("reserves one daily slot for both IP and client identity", async () => {
    const { redis, mocks } = createRedisMock();

    const reservation = await reserveDailyRegistrationSlot(redis, {
      ip: "203.0.113.10",
      clientId: "browser-client",
      userAgent: "TokURL Test",
      hashSalt: "test-salt",
      now: new Date("2026-06-12T09:00:00.000Z")
    });

    expect(reservation.keys).toHaveLength(2);
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.set.mock.calls[0]).toEqual([expect.stringContaining("tokurl:register:ip:2026-06-12:"), "1", "EX", 172800, "NX"]);
    expect(mocks.set.mock.calls[1]).toEqual([expect.stringContaining("tokurl:register:client:2026-06-12:"), "1", "EX", 172800, "NX"]);
  });

  it("rejects when the IP already registered today", async () => {
    const { redis } = createRedisMock("register:ip");

    await expect(
      reserveDailyRegistrationSlot(redis, {
        ip: "203.0.113.10",
        clientId: "browser-client",
        userAgent: "TokURL Test",
        hashSalt: "test-salt",
        now: new Date("2026-06-12T09:00:00.000Z")
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "daily_registration_quota_exceeded"
    });
  });

  it("rolls back the IP reservation when the client identity is already used", async () => {
    const { redis, mocks } = createRedisMock("register:client");

    await expect(
      reserveDailyRegistrationSlot(redis, {
        ip: "203.0.113.10",
        clientId: "browser-client",
        userAgent: "TokURL Test",
        hashSalt: "test-salt",
        now: new Date("2026-06-12T09:00:00.000Z")
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "daily_registration_quota_exceeded"
    });
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });
});
