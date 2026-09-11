import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../src/db/client.js";
import type { SiteSettingsRecord } from "../src/db/schema.js";
import { defaultSiteSettings, getSiteSettings, updateSiteSettings, updateSiteSettingsSchema } from "../src/services/settings.js";

function settingsRecord(overrides: Partial<SiteSettingsRecord> = {}): SiteSettingsRecord {
  return {
    id: "default",
    ...defaultSiteSettings,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function createDbMock(options: { existing?: SiteSettingsRecord[]; returning?: SiteSettingsRecord[] } = {}) {
  const existing = options.existing ?? [];
  const returning = options.returning ?? [];
  const limit = vi.fn(async () => existing);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const returningMock = vi.fn(async () => returning);
  const onConflictDoUpdate = vi.fn(() => ({ returning: returningMock }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const execute = vi.fn(async () => []);
  const transaction = vi.fn(async (operation: (transaction: DbClient) => Promise<unknown>) => operation(db));
  const db = { select, insert, execute, transaction } as unknown as DbClient;

  return {
    db,
    mocks: {
      select,
      insert,
      execute,
      transaction,
      values,
      onConflictDoUpdate,
      returning: returningMock
    }
  };
}

describe("site settings service", () => {
  it("returns public defaults when no row exists", async () => {
    const { db } = createDbMock();

    await expect(getSiteSettings({ db })).resolves.toEqual({
      ...defaultSiteSettings,
      updatedAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("upserts site settings and returns the saved public shape", async () => {
    const saved = settingsRecord({
      siteName: "TokURL Cloud",
      seoTitle: "TokURL Cloud - short links",
      seoDescription: "Managed short links with analytics.",
      seoKeywords: "TokURL,short links",
      analyticsCode: "<script>window.__tokurlAnalytics = true;</script>",
      redirectAnalyticsEnabled: true
    });
    const { db, mocks } = createDbMock({ returning: [saved] });

    await expect(updateSiteSettings({ db }, { siteName: "TokURL Cloud" })).resolves.toEqual({
      siteName: saved.siteName,
      seoTitle: saved.seoTitle,
      seoDescription: saved.seoDescription,
      seoKeywords: saved.seoKeywords,
      analyticsCode: saved.analyticsCode,
      registrationEnabled: saved.registrationEnabled,
      redirectAnalyticsEnabled: saved.redirectAnalyticsEnabled,
      updatedAt: saved.updatedAt.toISOString()
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("saves a disabled registration flag and preserves it on unrelated patches", async () => {
    const saved = settingsRecord({ registrationEnabled: false });
    const { db, mocks } = createDbMock({ existing: [saved], returning: [saved] });

    await expect(updateSiteSettings({ db }, { registrationEnabled: false })).resolves.toMatchObject({ registrationEnabled: false });
    expect(mocks.onConflictDoUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      set: { registrationEnabled: false, updatedAt: expect.any(Date) }
    }));
    await updateSiteSettings({ db }, { siteName: "Updated name" });
    expect(mocks.onConflictDoUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      set: { siteName: "Updated name", updatedAt: expect.any(Date) }
    }));
  });

  it("throws a structured error when the database does not return the saved row", async () => {
    const { db } = createDbMock();

    await expect(updateSiteSettings({ db }, { seoTitle: "TokURL" })).rejects.toMatchObject({
      statusCode: 500,
      code: "settings_save_failed"
    });
  });

  it("trims text input and enforces SEO field limits", () => {
    expect(updateSiteSettingsSchema.parse({ siteName: "  TokURL  " }).siteName).toBe("TokURL");
    expect(() => updateSiteSettingsSchema.parse({})).toThrow();
    expect(() => updateSiteSettingsSchema.parse({ seoDescription: "x".repeat(301) })).toThrow();
    expect(() => updateSiteSettingsSchema.parse({ analyticsCode: "x".repeat(12_001) })).toThrow();
    expect(updateSiteSettingsSchema.parse({ registrationEnabled: false }).registrationEnabled).toBe(false);
    expect(() => updateSiteSettingsSchema.parse({ registrationEnabled: "false" })).toThrow();
    expect(updateSiteSettingsSchema.parse({ redirectAnalyticsEnabled: true }).redirectAnalyticsEnabled).toBe(true);
  });
});
