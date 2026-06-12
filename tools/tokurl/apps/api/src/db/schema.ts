import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    name: varchar("name", { length: 120 }),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 16 }).notNull().default("user"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email), index("users_role_idx").on(table.role)]
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    targetUrl: text("target_url").notNull(),
    title: varchar("title", { length: 160 }),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    clickCount: integer("click_count").notNull().default(0),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("links_slug_unique").on(table.slug),
    index("links_created_at_idx").on(table.createdAt),
    index("links_owner_created_at_idx").on(table.ownerId, table.createdAt)
  ]
);

export const clicks = pgTable(
  "clicks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: varchar("ip_hash", { length: 96 }),
    source: varchar("source", { length: 32 }).notNull().default("redirect")
  },
  (table) => [
    index("clicks_link_id_clicked_at_idx").on(table.linkId, table.clickedAt),
    index("clicks_slug_clicked_at_idx").on(table.slug, table.clickedAt)
  ]
);

export const siteSettings = pgTable("site_settings", {
  id: varchar("id", { length: 32 }).primaryKey(),
  siteName: varchar("site_name", { length: 120 }).notNull(),
  seoTitle: varchar("seo_title", { length: 160 }).notNull(),
  seoDescription: text("seo_description").notNull(),
  seoKeywords: text("seo_keywords").notNull(),
  analyticsCode: text("analytics_code").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export type LinkRecord = typeof links.$inferSelect;
export type NewLinkRecord = typeof links.$inferInsert;
export type NewClickRecord = typeof clicks.$inferInsert;
export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type SiteSettingsRecord = typeof siteSettings.$inferSelect;
export type NewSiteSettingsRecord = typeof siteSettings.$inferInsert;
