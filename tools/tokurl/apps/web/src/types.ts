export interface RuntimeConfig {
  shortBaseUrl: string;
  slugLength: number;
  redirectStatus: number;
  adminAuthEnabled: boolean;
  allowRegistration: boolean;
  analyticsEnabled: boolean;
  siteSettings: SiteSettings;
}

export interface SiteSettings {
  siteName: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  analyticsCode: string;
  updatedAt: string;
}

export type UserRole = "admin" | "user";

export interface CurrentUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface PublicUser extends CurrentUser {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface UserListResponse {
  items: PublicUser[];
  total: number;
  limit: number;
  offset: number;
}

export interface BulkDeleteUsersResponse {
  deleted: PublicUser[];
  skipped: Array<{
    id: string;
    code: string;
    message: string;
  }>;
}

export interface PublicLink {
  id: string;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  description: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  clickCount: number;
  lastClickedAt: string | null;
}

export interface LinkListResponse {
  items: PublicLink[];
  total: number;
  summary: {
    total: number;
    active: number;
    clicks: number;
    topSlug: string | null;
  };
  limit: number;
  offset: number;
}

export interface AnalyticsSummary {
  id: string | null;
  slug: string;
  title: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  totalLinks?: number;
}

export interface AnalyticsRecentVisit {
  clickedAt: string;
  referrer: string | null;
  userAgent: string | null;
  slug?: string | null;
}

export interface LinkStats {
  scope?: "link";
  link: PublicLink;
  summary?: AnalyticsSummary;
  daily: Array<{ day: string; clicks: number }>;
  referrers: Array<{ referrer: string; clicks: number }>;
  devices: Array<{ device: string; clicks: number }>;
  recent: AnalyticsRecentVisit[];
}

export interface AllLinkStats {
  scope: "all";
  summary: AnalyticsSummary & { totalLinks: number };
  daily: Array<{ day: string; clicks: number }>;
  referrers: Array<{ referrer: string; clicks: number }>;
  devices: Array<{ device: string; clicks: number }>;
  recent: AnalyticsRecentVisit[];
}

export type AnalyticsStats = LinkStats | AllLinkStats;

export interface LinkInput {
  targetUrl: string;
  slug?: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: string | null;
  isActive?: boolean;
}
