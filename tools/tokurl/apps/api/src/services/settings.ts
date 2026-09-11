import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { registrationLockKey, withAdvisoryTransactionLock } from "../db/locks.js";
import { siteSettings, type SiteSettingsRecord } from "../db/schema.js";
import { ServiceError } from "../utils/errors.js";

const defaultSettingsId = "default";

export const siteSettingsCacheKeys = {
  redirectAnalyticsCode: "tokurl:settings:redirect-analytics-code"
} as const;

export const defaultSiteSettings = {
  siteName: "TokURL",
  seoTitle: "TokURL",
  seoDescription: "极速生成、全球跳转、实时统计、开源自部署的短链工具。",
  seoKeywords: "TokURL,短链接,短链,链接管理,二维码,数据统计",
  analyticsCode: "",
  registrationEnabled: true,
  redirectAnalyticsEnabled: false
};

export const updateSiteSettingsSchema = z
  .object({
    siteName: z.string().trim().min(1).max(120).optional(),
    seoTitle: z.string().trim().max(160).optional(),
    seoDescription: z.string().trim().max(300).optional(),
    seoKeywords: z.string().trim().max(300).optional(),
    analyticsCode: z.string().max(12_000).optional(),
    registrationEnabled: z.boolean().optional(),
    redirectAnalyticsEnabled: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export type SiteSettingsInput = z.infer<typeof updateSiteSettingsSchema>;

interface SettingsServices {
  db: DbClient;
}

export function toPublicSiteSettings(settings: SiteSettingsRecord) {
  return {
    siteName: settings.siteName,
    seoTitle: settings.seoTitle,
    seoDescription: settings.seoDescription,
    seoKeywords: settings.seoKeywords,
    analyticsCode: settings.analyticsCode,
    registrationEnabled: settings.registrationEnabled,
    redirectAnalyticsEnabled: settings.redirectAnalyticsEnabled,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toDefaultRecord(): SiteSettingsRecord {
  return {
    id: defaultSettingsId,
    ...defaultSiteSettings,
    updatedAt: new Date(0)
  };
}

export async function getSiteSettings(services: SettingsServices) {
  const [settings] = await services.db.select().from(siteSettings).where(eq(siteSettings.id, defaultSettingsId)).limit(1);

  return toPublicSiteSettings(settings ?? toDefaultRecord());
}

async function persistSiteSettings(services: SettingsServices, input: SiteSettingsInput) {
  const now = new Date();
  const next = {
    ...defaultSiteSettings,
    ...input,
    updatedAt: now
  };

  const [updated] = await services.db
    .insert(siteSettings)
    .values({
      id: defaultSettingsId,
      ...next
    })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: { ...input, updatedAt: now }
    })
    .returning();

  if (!updated) {
    throw new ServiceError(500, "Site settings were not saved.", "settings_save_failed");
  }

  return toPublicSiteSettings(updated);
}

export async function updateSiteSettings(services: SettingsServices, input: SiteSettingsInput) {
  if (input.registrationEnabled === undefined) {
    return persistSiteSettings(services, input);
  }

  return withAdvisoryTransactionLock(services.db, registrationLockKey, (db) => persistSiteSettings({ db }, input));
}

export async function assertRegistrationAllowed(services: SettingsServices & { config: AppConfig }) {
  if (!services.config.allowRegistration || !(await getSiteSettings(services)).registrationEnabled) {
    throw new ServiceError(403, "Registration is disabled.", "registration_disabled");
  }
}
