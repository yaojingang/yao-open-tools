import {
  Activity,
  AlertTriangle,
  BarChart3,
  Box,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  KeyRound,
  Languages,
  Link2,
  Loader2,
  LogOut,
  MousePointerClick,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  UserPlus,
  UsersRound,
  Webhook,
  X,
  Zap
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ApiError,
  bulkDeleteUsers as bulkDeleteUsersRequest,
  createLink,
  createUser,
  deleteLink,
  deleteUser as deleteUserRequest,
  getAllLinkStats,
  getCurrentUser,
  getLinkStats,
  getRuntimeConfig,
  listLinks,
  listUsers,
  login,
  logout,
  register,
  resetUserPassword,
  updateLink,
  updateSiteSettings,
  updateUser
} from "./api";
import { messages, type Locale, type MessageCatalog } from "./i18n";
import type { AnalyticsStats, LinkInput, PublicLink, PublicUser, UserRole } from "./types";

type View = "create" | "links" | "analytics" | "users" | "settings";
type LinkStatusFilter = "all" | "active" | "paused";
type RangeFilter = "7d" | "30d" | "all";
type SettingsTab = "site" | "domain" | "api" | "webhook" | "deploy";
type AuthMode = "login" | "register";

const AUTHOR_PROFILE_URL = "https://x.com/yaojingang";
const ANALYTICS_ALL_VALUE = "all";
const LINKS_PAGE_SIZE = 10;
const SITE_ANALYTICS_NODE_ATTRIBUTE = "data-tokurl-site-analytics";
const VIEW_PATHS: Record<View, string> = {
  create: "/",
  links: "/links",
  analytics: "/analytics",
  users: "/users",
  settings: "/settings"
};
const PATH_VIEWS: Record<string, View> = {
  "/": "create",
  "/create": "create",
  "/links": "links",
  "/analytics": "analytics",
  "/users": "users",
  "/settings": "settings"
};

interface LinkFormState {
  targetUrl: string;
  slug: string;
  title: string;
  description: string;
  expiresAt: string;
  isActive: boolean;
}

interface AuthFormState {
  username: string;
  password: string;
}

interface UserFormState {
  username: string;
  password: string;
  role: UserRole;
}

interface UserEditFormState {
  username: string;
  role: UserRole;
  isActive: boolean;
  password: string;
}

interface UserDeleteTarget {
  mode: "single" | "bulk";
  users: PublicUser[];
}

interface SiteSettingsFormState {
  siteName: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  analyticsCode: string;
}

const emptyForm: LinkFormState = {
  targetUrl: "",
  slug: "",
  title: "",
  description: "",
  expiresAt: "",
  isActive: true
};

const emptyAuthForm: AuthFormState = {
  username: "",
  password: ""
};

const emptyUserForm: UserFormState = {
  username: "",
  password: "",
  role: "user"
};

const emptyUserEditForm: UserEditFormState = {
  username: "",
  role: "user",
  isActive: true,
  password: ""
};

const emptySiteSettingsForm: SiteSettingsFormState = {
  siteName: "TokURL",
  seoTitle: "TokURL",
  seoDescription: "",
  seoKeywords: "",
  analyticsCode: ""
};

function setNamedMeta(name: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }

  element.content = content;
}

type AnalyticsWindow = Window & {
  _hmt?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

function removeSiteAnalyticsCode() {
  document.querySelectorAll(`[${SITE_ANALYTICS_NODE_ATTRIBUTE}]`).forEach((node) => node.remove());
}

function cloneAnalyticsElement(element: Element): Element {
  const tagName = element.tagName.toLowerCase();

  if (tagName === "script") {
    const source = element as HTMLScriptElement;
    const script = document.createElement("script");
    Array.from(source.attributes).forEach((attribute) => script.setAttribute(attribute.name, attribute.value));
    script.text = source.textContent ?? "";
    script.setAttribute(SITE_ANALYTICS_NODE_ATTRIBUTE, "true");
    return script;
  }

  const clone = element.cloneNode(true) as Element;
  clone.setAttribute(SITE_ANALYTICS_NODE_ATTRIBUTE, "true");
  return clone;
}

function injectSiteAnalyticsCode(code: string) {
  removeSiteAnalyticsCode();

  const html = code.trim();
  if (!html) {
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  Array.from(template.content.children).forEach((element) => {
    const clone = cloneAnalyticsElement(element);
    const target = element.tagName.toLowerCase() === "noscript" ? document.body : document.head;
    target.appendChild(clone);
  });
}

function trackSitePageView() {
  const analyticsWindow = window as AnalyticsWindow;
  const pagePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (typeof analyticsWindow.gtag === "function") {
    analyticsWindow.gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: pagePath,
      page_title: document.title
    });
  }

  if (Array.isArray(analyticsWindow._hmt)) {
    analyticsWindow._hmt.push(["_trackPageview", pagePath]);
  }
}

function normalizeViewPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function parseViewValue(value: string | null): View | null {
  return value === "create" || value === "links" || value === "analytics" || value === "users" || value === "settings" ? value : null;
}

function getInitialView(): View {
  return getViewFromLocation();
}

function getViewFromLocation(): View {
  const legacyView = parseViewValue(new URLSearchParams(window.location.search).get("view"));
  if (legacyView) {
    return legacyView;
  }

  return PATH_VIEWS[normalizeViewPath(window.location.pathname)] ?? "create";
}

function getViewUrl(view: View, options: { includeHash?: boolean } = {}) {
  const searchParams = new URLSearchParams(window.location.search);
  searchParams.delete("view");
  const query = searchParams.toString();
  const hash = options.includeHash ? window.location.hash : "";

  return `${VIEW_PATHS[view]}${query ? `?${query}` : ""}${hash}`;
}

function getCurrentRelativeUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isCanonicalViewUrl(view: View) {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("view")) {
    return false;
  }

  return normalizeViewPath(window.location.pathname) === VIEW_PATHS[view];
}

function toLocalInputValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function parseExpiration(value: string, invalidMessage: string): string | null {
  const raw = value.trim();

  if (!raw) {
    return null;
  }

  const normalized = raw.includes("T") ? raw : raw.replace(/\s+/, "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new Error(invalidMessage);
  }

  return date.toISOString();
}

function toPayload(form: LinkFormState, invalidExpiresMessage: string, options: { includeSlug?: boolean } = {}): LinkInput {
  return {
    targetUrl: form.targetUrl.trim(),
    slug: options.includeSlug === false ? undefined : form.slug.trim() || undefined,
    title: form.title.trim() || null,
    description: form.description.trim() || null,
    expiresAt: parseExpiration(form.expiresAt, invalidExpiresMessage),
    isActive: form.isActive
  };
}

function formatDate(value: string | null, locale: Locale, emptyText: string): string {
  if (!value) {
    return emptyText;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDay(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

function getErrorMessage(error: unknown, fallback: string, t: MessageCatalog): string {
  if (error instanceof ApiError) {
    const code = error.code?.toLowerCase();
    const localized = {
      unauthorized: t.errorUnauthorized,
      forbidden: t.errorForbidden,
      invalid_request: t.errorInvalidRequest,
      invalid_credentials: t.errorInvalidCredentials,
      registration_disabled: t.errorRegistrationDisabled,
      email_conflict: t.errorUsernameConflict,
      username_conflict: t.errorUsernameConflict,
      last_admin: t.errorLastAdmin,
      admin_required: t.errorAdminRequired,
      invalid_slug: t.errorInvalidSlug,
      slug_conflict: t.errorSlugConflict,
      not_found: t.errorNotFound,
      slug_exhausted: t.errorSlugExhausted,
      daily_quota_exceeded: t.errorDailyQuotaExceeded,
      daily_registration_quota_exceeded: t.errorDailyRegistrationQuotaExceeded,
      self_delete_forbidden: t.errorSelfDeleteForbidden,
      custom_slug_forbidden: t.errorCustomSlugForbidden
    }[code ?? ""];

    return localized ?? error.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the textarea path when clipboard permission is denied.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function isExpired(link: PublicLink): boolean {
  return Boolean(link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now());
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getQrCopyKey(link: PublicLink): string {
  return `qr:${link.id}`;
}

function getBrandInitial(siteName: string): string {
  return Array.from(siteName.trim())[0]?.toUpperCase() || "T";
}

function getPaginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis-start" | "ellipsis-end"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_item, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | "ellipsis-start" | "ellipsis-end"> = [];

  sortedPages.forEach((page, index) => {
    const previous = sortedPages[index - 1];
    if (previous && page - previous > 1) {
      items.push(previous === 1 ? "ellipsis-start" : "ellipsis-end");
    }
    items.push(page);
  });

  return items;
}

export default function App() {
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<Locale>(() => {
    const queryLang = new URLSearchParams(window.location.search).get("lang");
    if (queryLang === "en" || queryLang === "en-US") {
      return "en-US";
    }
    if (queryLang === "zh" || queryLang === "zh-CN") {
      return "zh-CN";
    }

    return (localStorage.getItem("tokurl.locale") as Locale) || "zh-CN";
  });
  const [view, setView] = useState<View>(getInitialView);
  const [token, setToken] = useState(() => localStorage.getItem("tokurl.adminToken") ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<AuthFormState>(emptyAuthForm);
  const [search, setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LinkStatusFilter>("all");
  const [linksPage, setLinksPage] = useState(1);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("7d");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("site");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [createForm, setCreateForm] = useState<LinkFormState>(emptyForm);
  const [editForm, setEditForm] = useState<LinkFormState>(emptyForm);
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [editUserForm, setEditUserForm] = useState<UserEditFormState>(emptyUserEditForm);
  const [siteSettingsForm, setSiteSettingsForm] = useState<SiteSettingsFormState>(emptySiteSettingsForm);
  const [lastCreated, setLastCreated] = useState<PublicLink | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PublicLink | null>(null);
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserDeleteTarget | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingCreateAfterAuth, setPendingCreateAfterAuth] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const analyticsInitialPageViewRef = useRef(false);
  const t = messages[locale];

  useEffect(() => {
    localStorage.setItem("tokurl.adminToken", token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem("tokurl.locale", locale);
    document.documentElement.lang = locale === "zh-CN" ? "zh-Hans-CN" : "en";
    document.documentElement.dataset.lang = locale;
  }, [locale]);

  useEffect(() => {
    const initialView = getViewFromLocation();
    setView(initialView);

    if (!isCanonicalViewUrl(initialView)) {
      window.history.replaceState({}, "", getViewUrl(initialView, { includeHash: true }));
    }

    const handlePopState = () => {
      const nextView = getViewFromLocation();
      setView(nextView);

      if (!isCanonicalViewUrl(nextView)) {
        window.history.replaceState({}, "", getViewUrl(nextView, { includeHash: true }));
      }

      if (nextView === "users") {
        setUserSearch("");
      }
      if (nextView === "analytics") {
        setSelectedId(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getRuntimeConfig
  });
  const brandName = configQuery.data?.siteSettings.siteName.trim() || emptySiteSettingsForm.siteName;
  const brandInitial = getBrandInitial(brandName);

  useEffect(() => {
    const settings = configQuery.data?.siteSettings;
    if (!settings) {
      return;
    }

    setSiteSettingsForm({
      siteName: settings.siteName,
      seoTitle: settings.seoTitle,
      seoDescription: settings.seoDescription,
      seoKeywords: settings.seoKeywords,
      analyticsCode: settings.analyticsCode
    });
  }, [configQuery.data?.siteSettings]);

  useEffect(() => {
    const settings = configQuery.data?.siteSettings;
    if (!settings) {
      return;
    }

    document.title = settings.seoTitle || settings.siteName;
    setNamedMeta("description", settings.seoDescription);
    setNamedMeta("keywords", settings.seoKeywords);
  }, [configQuery.data?.siteSettings]);

  useEffect(() => {
    injectSiteAnalyticsCode(configQuery.data?.siteSettings.analyticsCode ?? "");
    return () => removeSiteAnalyticsCode();
  }, [configQuery.data?.siteSettings.analyticsCode]);

  useEffect(() => {
    if (!configQuery.data?.siteSettings.analyticsCode.trim()) {
      analyticsInitialPageViewRef.current = false;
      return;
    }

    if (!analyticsInitialPageViewRef.current) {
      analyticsInitialPageViewRef.current = true;
      return;
    }

    const timer = window.setTimeout(trackSitePageView, 0);
    return () => window.clearTimeout(timer);
  }, [view, configQuery.data?.siteSettings.analyticsCode]);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    retry: false
  });
  const currentUser = meQuery.isError ? null : (meQuery.data?.user ?? null);
  const isAdmin = currentUser?.role === "admin";

  const linksQuery = useQuery({
    queryKey: ["links", token, search, statusFilter, linksPage],
    queryFn: () =>
      listLinks(token, {
        search,
        status: statusFilter,
        limit: LINKS_PAGE_SIZE,
        offset: (linksPage - 1) * LINKS_PAGE_SIZE
      }),
    enabled: Boolean(currentUser),
    placeholderData: (previousData) => previousData,
    retry: false
  });

  useEffect(() => {
    setLinksPage(1);
  }, [search, statusFilter]);

  const usersQuery = useQuery({
    queryKey: ["users", token, userSearch],
    queryFn: () => listUsers(token, userSearch),
    enabled: view === "users" && Boolean(currentUser),
    retry: false
  });

  useEffect(() => {
    const allowedUserIds = new Set((usersQuery.data?.items ?? []).filter((user) => user.id !== currentUser?.id).map((user) => user.id));
    setSelectedUserIds((current) => {
      let changed = false;
      const next = new Set<string>();

      current.forEach((id) => {
        if (allowedUserIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [currentUser?.id, usersQuery.data?.items]);

  const links = linksQuery.data?.items ?? [];
  const linksTotal = linksQuery.data?.total ?? 0;
  const linksPageCount = Math.max(1, Math.ceil(linksTotal / LINKS_PAGE_SIZE));
  const linksPageStart = linksTotal === 0 ? 0 : (linksPage - 1) * LINKS_PAGE_SIZE + 1;
  const linksPageEnd = Math.min(linksPage * LINKS_PAGE_SIZE, linksTotal);
  const paginationItems = getPaginationItems(Math.min(linksPage, linksPageCount), linksPageCount);
  const selectedLink = selectedId
    ? links.find((link) => link.id === selectedId) ?? (lastCreated?.id === selectedId ? lastCreated : null)
    : null;
  const analyticsSelection = selectedId ?? ANALYTICS_ALL_VALUE;

  useEffect(() => {
    if (linksPage > linksPageCount) {
      setLinksPage(linksPageCount);
    }
  }, [linksPage, linksPageCount]);

  const statsQuery = useQuery<AnalyticsStats>({
    queryKey: ["stats", token, analyticsSelection],
    queryFn: () => (selectedId ? getLinkStats(token, selectedId) : getAllLinkStats(token)),
    enabled: view === "analytics" && Boolean(currentUser),
    retry: false
  });

  const analyticsLinksQuery = useQuery({
    queryKey: ["analytics-links", token],
    queryFn: () =>
      listLinks(token, {
        search: "",
        status: "all",
        limit: 100,
        offset: 0
      }),
    enabled: view === "analytics" && Boolean(currentUser),
    retry: false
  });

  const loginMutation = useMutation({
    mutationFn: () => login({ username: authForm.username.trim(), password: authForm.password }),
    onSuccess: async () => {
      const shouldCreate = pendingCreateAfterAuth;
      setAuthForm(emptyAuthForm);
      setAuthModalOpen(false);
      setPendingCreateAfterAuth(false);
      showToast(t.toastLoggedIn);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
      if (shouldCreate) {
        createMutation.mutate();
      }
    }
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      register({
        username: authForm.username.trim(),
        password: authForm.password
    }),
    onSuccess: async () => {
      const shouldCreate = pendingCreateAfterAuth;
      setAuthForm(emptyAuthForm);
      setAuthModalOpen(false);
      setPendingCreateAfterAuth(false);
      showToast(t.toastRegistered);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
      if (shouldCreate) {
        createMutation.mutate();
      }
    }
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      setAuthModalOpen(false);
      setPendingCreateAfterAuth(false);
      setSelectedId(null);
      setLastCreated(null);
      setSelectedUserIds(new Set());
      showToast(t.toastLoggedOut);
      await queryClient.invalidateQueries();
    }
  });

  const createMutation = useMutation({
    mutationFn: () => createLink(token, toPayload(createForm, t.invalidExpires, { includeSlug: isAdmin })),
    onSuccess: async (link) => {
      setCreateForm(emptyForm);
      setLastCreated(link);
      setSelectedId(link.id);
      showToast(t.toastCreated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", token] })
      ]);
    }
  });

  const updateMutation = useMutation({
    mutationFn: () => updateLink(token, selectedLink!.id, toPayload(editForm, t.invalidExpires, { includeSlug: isAdmin })),
    onSuccess: async (link) => {
      setSelectedId(link.id);
      setEditModalOpen(false);
      showToast(t.toastSaved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", token] })
      ]);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLink(token, id),
    onSuccess: async () => {
      setSelectedId(null);
      setEditModalOpen(false);
      setDeleteTarget(null);
      showToast(t.toastDeleted);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", token] })
      ]);
    }
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      createUser(token, {
        username: userForm.username.trim(),
        password: userForm.password,
        role: userForm.role,
        isActive: true
    }),
    onSuccess: async () => {
      setUserForm(emptyUserForm);
      setCreateUserModalOpen(false);
      showToast(t.toastUserCreated);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    }
  });

  const saveUserMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) {
        throw new Error("No user is selected.");
      }

      const input: { username?: string; role?: UserRole; isActive?: boolean } = {
        username: editUserForm.username.trim()
      };

      if (isAdmin) {
        input.role = editUserForm.role;
        input.isActive = editUserForm.isActive;
      }

      let updated = await updateUser(token, editingUser.id, input);
      const password = editUserForm.password.trim();

      if (password) {
        updated = await resetUserPassword(token, editingUser.id, password);
      }

      return updated;
    },
    onSuccess: async () => {
      setEditingUser(null);
      setEditUserForm(emptyUserEditForm);
      showToast(t.toastUserSaved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => deleteUserRequest(token, id),
    onSuccess: async (user) => {
      setDeleteUserTarget(null);
      setSelectedUserIds((current) => {
        const next = new Set(current);
        next.delete(user.id);
        return next;
      });
      showToast(t.toastUserDeleted);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
    }
  });

  const bulkDeleteUsersMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteUsersRequest(token, ids),
    onSuccess: async (result) => {
      setDeleteUserTarget(null);
      setSelectedUserIds(new Set());
      showToast(
        result.skipped.length > 0
          ? t.toastUsersDeletedPartial(String(result.deleted.length), String(result.skipped.length))
          : t.toastUsersDeleted(String(result.deleted.length))
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
    }
  });

  const siteSettingsMutation = useMutation({
    mutationFn: () => updateSiteSettings(token, siteSettingsForm),
    onSuccess: async (settings) => {
      setSiteSettingsForm({
        siteName: settings.siteName,
        seoTitle: settings.seoTitle,
        seoDescription: settings.seoDescription,
        seoKeywords: settings.seoKeywords,
        analyticsCode: settings.analyticsCode
      });
      showToast(t.toastSiteSettingsSaved);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    }
  });

  const totals = useMemo(() => {
    const summary = linksQuery.data?.summary;

    return {
      total: summary?.total ?? linksTotal,
      active: summary?.active ?? 0,
      clicks: summary?.clicks ?? 0,
      topSlug: summary?.topSlug ?? null
    };
  }, [linksQuery.data?.summary, linksTotal]);

  const todayClicks = useMemo(() => {
    const day = todayKey();
    return statsQuery.data?.daily.find((item) => item.day === day)?.clicks ?? 0;
  }, [statsQuery.data?.daily]);

  const selectedStats = statsQuery.data;
  const visibleDaily = useMemo(() => {
    const daily = selectedStats?.daily ?? [];

    if (rangeFilter === "all") {
      return daily;
    }

    const days = rangeFilter === "7d" ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    return daily.filter((item) => item.day >= cutoffKey);
  }, [rangeFilter, selectedStats?.daily]);
  const dailyMax = Math.max(...visibleDaily.map((item) => item.clicks), 1);
  const referrerTotal = selectedStats?.referrers.reduce((sum, item) => sum + item.clicks, 0) ?? 0;
  const deviceTotal = selectedStats?.devices.reduce((sum, item) => sum + item.clicks, 0) ?? 0;

  function go(nextView: View, options: { replace?: boolean } = {}) {
    if (nextView === "users") {
      setUserSearch("");
    }

    setView(nextView);
    const method = options.replace ? "replaceState" : "pushState";
    const nextUrl = getViewUrl(nextView);
    if (getCurrentRelativeUrl() !== nextUrl) {
      window.history[method]({}, "", nextUrl);
    }
  }

  useEffect(() => {
    if (currentUser && !isAdmin && view === "settings") {
      go("create", { replace: true });
    }
  }, [currentUser, isAdmin, view]);

  function flashCopied(value: string, message = t.toastCopied) {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }

    setCopiedValue(value);
    showToast(message);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedValue(null);
      copiedTimerRef.current = null;
    }, 1200);
  }

  function showToast(message: string) {
    setToast({ id: Date.now(), message });
  }

  async function handleCopy(value: string) {
    await copyToClipboard(value);
    flashCopied(value);
  }

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  async function createQrPngBlob(link: PublicLink): Promise<Blob> {
    const qrHost = Array.from(document.querySelectorAll<HTMLElement>("[data-qr-link-id]")).find(
      (node) => node.dataset.qrLinkId === link.id
    );
    const svg = qrHost?.querySelector<SVGSVGElement>("svg");

    if (!svg) {
      throw new Error("QR code is not rendered");
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "512");
    clone.setAttribute("height", "512");

    const svgText = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    const imageLoaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("QR image failed to load"));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas is not available");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("QR export failed"));
        }
      }, "image/png");
    });
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 300);
  }

  async function handleCopyQr(link: PublicLink) {
    try {
      const blob = await createQrPngBlob(link);
      const key = getQrCopyKey(link);

      if (navigator.clipboard?.write && "ClipboardItem" in window) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          flashCopied(key, t.toastQrCopied);
          return;
        } catch {
          downloadBlob(blob, `${link.slug}-qr.png`);
          flashCopied(key, t.toastQrDownloaded);
          return;
        }
      }

      downloadBlob(blob, `${link.slug}-qr.png`);
      flashCopied(key, t.toastQrDownloaded);
    } catch {
      showToast(t.toastQrFailed);
    }
  }

  function goToLinkAnalytics(link: PublicLink) {
    setSelectedId(link.id);
    setEditModalOpen(false);
    go("analytics");
  }

  function goToLinkManagement(link: PublicLink) {
    setSelectedId(link.id);
    setEditModalOpen(false);
    go("links");
  }

  function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authMode === "login" || configQuery.data?.allowRegistration === false) {
      loginMutation.mutate();
      return;
    }

    registerMutation.mutate();
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) {
      try {
        toPayload(createForm, t.invalidExpires, { includeSlug: false });
      } catch (error) {
        showToast(error instanceof Error ? error.message : t.fallbackError);
        return;
      }

      openAuthModalForCreate();
      return;
    }

    createMutation.mutate();
  }

  function openAuthModalForCreate() {
    createMutation.reset();
    loginMutation.reset();
    registerMutation.reset();
    setAuthMode(configQuery.data?.allowRegistration === false ? "login" : "register");
    setPendingCreateAfterAuth(true);
    setAuthModalOpen(true);
  }

  function openAuthModal(mode: AuthMode) {
    loginMutation.reset();
    registerMutation.reset();
    setAuthMode(mode);
    setPendingCreateAfterAuth(false);
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    if (loginMutation.isPending || registerMutation.isPending) {
      return;
    }

    loginMutation.reset();
    registerMutation.reset();
    setPendingCreateAfterAuth(false);
    setAuthModalOpen(false);
  }

  function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createUserMutation.mutate();
  }

  function closeCreateUserModal() {
    if (createUserMutation.isPending) {
      return;
    }

    createUserMutation.reset();
    setUserForm(emptyUserForm);
    setCreateUserModalOpen(false);
  }

  function openUserEditor(user: PublicUser) {
    saveUserMutation.reset();
    setEditingUser(user);
    setEditUserForm({
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      password: ""
    });
  }

  function closeUserEditor() {
    if (saveUserMutation.isPending) {
      return;
    }

    saveUserMutation.reset();
    setEditingUser(null);
    setEditUserForm(emptyUserEditForm);
  }

  function toggleUserSelection(userId: string, selected: boolean) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }

  function setVisibleUserSelection(users: PublicUser[], selected: boolean) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      users.forEach((user) => {
        if (selected) {
          next.add(user.id);
        } else {
          next.delete(user.id);
        }
      });
      return next;
    });
  }

  function openDeleteUserModal(user: PublicUser) {
    deleteUserMutation.reset();
    bulkDeleteUsersMutation.reset();
    setDeleteUserTarget({ mode: "single", users: [user] });
  }

  function openBulkDeleteUsersModal(users: PublicUser[]) {
    if (users.length === 0) {
      return;
    }

    deleteUserMutation.reset();
    bulkDeleteUsersMutation.reset();
    setDeleteUserTarget({ mode: "bulk", users });
  }

  function closeDeleteUserModal() {
    if (deleteUserMutation.isPending || bulkDeleteUsersMutation.isPending) {
      return;
    }

    deleteUserMutation.reset();
    bulkDeleteUsersMutation.reset();
    setDeleteUserTarget(null);
  }

  function confirmDeleteUser() {
    if (!deleteUserTarget) {
      return;
    }

    if (deleteUserTarget.mode === "single") {
      const user = deleteUserTarget.users[0];
      if (user) {
        deleteUserMutation.mutate(user.id);
      }
      return;
    }

    bulkDeleteUsersMutation.mutate(deleteUserTarget.users.map((user) => user.id));
  }

  function handleEditUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = editUserForm.password.trim();
    if (password && password.length < 8) {
      showToast(t.passwordTooShort);
      return;
    }

    saveUserMutation.mutate();
  }

  function handleSiteSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    siteSettingsMutation.mutate();
  }

  function openEditor(link: PublicLink) {
    setSelectedId(link.id);
    setEditForm({
      targetUrl: link.targetUrl,
      slug: link.slug,
      title: link.title ?? "",
      description: link.description ?? "",
      expiresAt: toLocalInputValue(link.expiresAt),
      isActive: link.isActive
    });
    setEditModalOpen(true);
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedLink) {
      updateMutation.mutate();
    }
  }

  function handleDelete(link: PublicLink) {
    deleteMutation.reset();
    setDeleteTarget(link);
  }

  function closeDeleteModal() {
    if (deleteMutation.isPending) {
      return;
    }

    deleteMutation.reset();
    setDeleteTarget(null);
  }

  function confirmDelete() {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
    }
  }

  const navItems: Array<{ id: View; label: string; icon: typeof Link2 }> = [
    { id: "create", label: t.navCreate, icon: Plus },
    { id: "links", label: t.navLinks, icon: Link2 },
    { id: "analytics", label: t.navAnalytics, icon: BarChart3 },
    { id: "users", label: t.navUsers, icon: UsersRound },
    { id: "settings", label: t.navSettings, icon: Settings }
  ];

  const settingsItems: Array<{ id: SettingsTab; label: string; icon: typeof Globe2 }> = [
    { id: "site", label: t.settingsSite, icon: FileText },
    { id: "domain", label: t.settingsDomain, icon: Globe2 },
    { id: "api", label: t.settingsApi, icon: KeyRound },
    { id: "webhook", label: t.settingsWebhook, icon: Webhook },
    { id: "deploy", label: t.settingsDeploy, icon: Box }
  ];

  function renderServiceBadge() {
    if (configQuery.isLoading) {
      return (
        <span className="status-badge neutral nav-status" title={t.statusChecking} aria-label={t.statusChecking}>
          <Loader2 size={13} className="spin" />
          <span className="nav-status-text">{t.statusChecking}</span>
        </span>
      );
    }

    if (configQuery.error) {
      return (
        <span className="status-badge danger nav-status" title={t.statusOffline} aria-label={t.statusOffline}>
          <AlertTriangle size={13} />
          <span className="nav-status-text">{t.statusOffline}</span>
        </span>
      );
    }

    return (
      <span className="status-badge nav-status" title={t.statusOnline} aria-label={t.statusOnline}>
        <Activity size={13} />
        <span className="nav-status-text">{t.statusOnline}</span>
      </span>
    );
  }

  function renderAuthView() {
    const registrationAllowed = configQuery.data?.allowRegistration ?? true;
    const isRegister = authMode === "register" && registrationAllowed;
    const mutation = isRegister ? registerMutation : loginMutation;
    const error = mutation.error ? getErrorMessage(mutation.error, t.fallbackError, t) : null;

    return (
      <section className="auth-page">
        <div className="auth-shell">
          <div className="auth-brand">
            <span className="logo-mark">{brandInitial}</span>
            <div>
              <strong>{brandName}</strong>
              <p>{t.authSubtitle}</p>
            </div>
          </div>

          <form className="card auth-card" onSubmit={handleAuthSubmit}>
            <div className="card-head">
              <div>
                <p className="card-kicker">{isRegister ? t.registerEyebrow : t.loginEyebrow}</p>
                <h1>{isRegister ? t.registerTitle(brandName) : t.loginTitle(brandName)}</h1>
              </div>
              <ShieldCheck size={22} />
            </div>

            {registrationAllowed ? (
              <div className="segmented auth-switch">
                {(["login", "register"] as AuthMode[]).map((mode) => (
                  <button key={mode} type="button" className={authMode === mode ? "active" : ""} onClick={() => setAuthMode(mode)}>
                    {mode === "login" ? t.loginAction : t.registerAction}
                  </button>
                ))}
              </div>
            ) : null}

            <label className="field block-field">
              <span>{t.usernameLabel}</span>
              <input
                required
                autoComplete="username"
                value={authForm.username}
                onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
                placeholder={t.usernamePlaceholder}
              />
            </label>

            <label className="field block-field">
              <span>{t.passwordLabel}</span>
              <input
                required
                minLength={isRegister ? 8 : 1}
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={isRegister ? t.passwordRegisterPlaceholder : t.passwordLoginPlaceholder}
              />
            </label>

            {error ? <p className="form-error">{error}</p> : null}

            <button className="btn primary full" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 size={17} className="spin" /> : <ShieldCheck size={17} />}
              {isRegister ? t.registerSubmit : t.loginSubmit}
            </button>

            <p className="auth-hint">{t.bootstrapHint}</p>
          </form>
        </div>
      </section>
    );
  }

  function renderAuthModal() {
    if (!authModalOpen) {
      return null;
    }

    const registrationAllowed = configQuery.data?.allowRegistration ?? true;
    const isRegister = authMode === "register" && registrationAllowed;
    const mutation = isRegister ? registerMutation : loginMutation;
    const error = mutation.error ? getErrorMessage(mutation.error, t.fallbackError, t) : null;
    const title = pendingCreateAfterAuth ? (isRegister ? t.guestAuthTitle : t.guestAuthLoginTitle) : isRegister ? t.registerTitle(brandName) : t.loginTitle(brandName);
    const subtitle = pendingCreateAfterAuth ? (isRegister ? t.guestAuthSubtitle : t.guestAuthLoginSubtitle) : t.authSubtitle;

    return (
      <div className="modal-mask" role="presentation">
        <form className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onSubmit={handleAuthSubmit}>
          <div className="modal-head auth-modal-head">
            <div>
              <p className="card-kicker">{isRegister ? t.registerEyebrow : t.loginEyebrow}</p>
              <h2 id="auth-modal-title">{title}</h2>
              <p>{subtitle}</p>
            </div>
            <button className="icon-btn" type="button" title={t.close} aria-label={t.close} onClick={closeAuthModal} disabled={mutation.isPending}>
              <X size={16} />
            </button>
          </div>

          {registrationAllowed ? (
            <div className="segmented auth-switch">
              {(["register", "login"] as AuthMode[]).map((mode) => (
                <button key={mode} type="button" className={authMode === mode ? "active" : ""} onClick={() => setAuthMode(mode)} disabled={mutation.isPending}>
                  {mode === "login" ? t.loginAction : t.registerAction}
                </button>
              ))}
            </div>
          ) : null}

          <label className="field block-field">
            <span>{t.usernameLabel}</span>
            <input
              required
              autoComplete="username"
              value={authForm.username}
              onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
              placeholder={t.usernamePlaceholder}
            />
          </label>

          <label className="field block-field">
            <span>{t.passwordLabel}</span>
            <input
              required
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={isRegister ? 8 : 1}
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={isRegister ? t.passwordRegisterPlaceholder : t.passwordLoginPlaceholder}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="btn primary full" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 size={17} className="spin" /> : <ShieldCheck size={17} />}
            {isRegister ? t.registerSubmit : t.loginSubmit}
          </button>
        </form>
      </div>
    );
  }

  function renderLinkShareCard(link: PublicLink, options: { showManage?: boolean } = {}) {
    const qrKey = getQrCopyKey(link);

    return (
      <div className="result-card link-share-card">
        <div className="qr-box" data-qr-link-id={link.id}>
          <QRCodeSVG
            value={link.shortUrl}
            size={96}
            level="M"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#18181b"
            title={t.qrCodeLabel}
            className="qr-code-svg"
          />
        </div>
        <div className="result-main">
          <a className="short-link" href={link.shortUrl} target="_blank" rel="noreferrer">
            {link.shortUrl}
          </a>
          {link.title ? <div className="result-title">{link.title}</div> : null}
          <div className="long-link">{link.targetUrl}</div>
          <div className="result-actions">
            <button className="btn ghost compact" type="button" onClick={() => void handleCopy(link.shortUrl)}>
              {copiedValue === link.shortUrl ? <Check size={15} /> : <Copy size={15} />}
              {t.copyShortLink}
            </button>
            <button className="btn ghost compact" type="button" onClick={() => void handleCopyQr(link)}>
              {copiedValue === qrKey ? <Check size={15} /> : <QrCode size={15} />}
              {t.copyQrCode}
            </button>
            <a className="btn ghost compact" href={link.shortUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              {t.openShortLink}
            </a>
            {options.showManage ? (
              <button className="btn ghost compact" type="button" onClick={() => goToLinkManagement(link)}>
                <Link2 size={15} />
                {t.manageLink}
              </button>
            ) : null}
            <button className="btn ghost compact" type="button" onClick={() => goToLinkAnalytics(link)}>
              <BarChart3 size={15} />
              {t.viewAnalytics}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderCreateView() {
    const createError = createMutation.error ? getErrorMessage(createMutation.error, t.fallbackError, t) : null;
    const resultLink = lastCreated;
    const baseUrl = configQuery.data?.shortBaseUrl ?? "tok.url";
    const shortBaseDisplay = baseUrl.replace(/^https?:\/\//, "");
    const canCustomizeSlug = isAdmin;
    const copyrightYear = new Date().getFullYear().toString();
    const examples = [
      {
        icon: FileText,
        title: t.exampleDocsTitle,
        longUrl: "https://yaojingang.feishu.cn/wiki/MwkiwPDqCiHGvvK2uOtcNUIrnnf?from=from_copylink&utm_source=wechat",
        shortPath: "wiki"
      },
      {
        icon: MousePointerClick,
        title: t.exampleCampaignTitle,
        longUrl:
          "https://example.com/campaign/summer-launch?utm_source=wechat&utm_medium=group&utm_campaign=tokurl_launch",
        shortPath: "launch"
      },
      {
        icon: CalendarClock,
        title: t.exampleEventTitle,
        longUrl: "https://lu.ma/tokurl-demo?utm_source=newsletter&utm_content=product-demo-2026",
        shortPath: "demo"
      }
    ];

    return (
      <section className="page create-page">
        <section className="prototype-hero">
          <h1>
            {t.createHeroTitleStart}
            <em>{t.createHeroTitleEm}</em>
          </h1>
          <p>{t.createHeroSubtitle}</p>

          <form className="shorten-box" onSubmit={handleCreate}>
            <div className="url-row">
              <input
                className="url-input"
                required
                type="url"
                value={createForm.targetUrl}
                onChange={(event) => setCreateForm((form) => ({ ...form, targetUrl: event.target.value }))}
                placeholder={t.destinationPlaceholder}
              />
              <button className="btn primary" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
                {t.createButton}
              </button>
            </div>

            <button className="adv-toggle" type="button" onClick={() => setAdvancedOpen((current) => !current)}>
              <SlidersHorizontal size={14} />
              {canCustomizeSlug ? t.advancedToggle : t.advancedToggleDefault}
            </button>

            <div className={`advanced-fields ${advancedOpen ? "open" : ""}`}>
              {canCustomizeSlug ? (
                <label className="field">
                  <span>{t.alias}</span>
                  <div className="slug-input">
                    <span className="slug-prefix">{baseUrl.replace(/^https?:\/\//, "")}/</span>
                    <input
                      value={createForm.slug}
                      onChange={(event) => setCreateForm((form) => ({ ...form, slug: event.target.value }))}
                      placeholder={t.auto}
                    />
                  </div>
                </label>
              ) : (
                <div className="permission-note wide">
                  <ShieldCheck size={15} />
                  <span>{t.autoSlugUserHint}</span>
                </div>
              )}
              <label className="field">
                <span>{t.expires}</span>
                <input
                  type="datetime-local"
                  value={createForm.expiresAt}
                  onChange={(event) => setCreateForm((form) => ({ ...form, expiresAt: event.target.value }))}
                />
              </label>
              <label className="field wide">
                <span>{t.description}</span>
                <input
                  value={createForm.description}
                  onChange={(event) => setCreateForm((form) => ({ ...form, description: event.target.value }))}
                  placeholder={t.notePlaceholder}
                />
              </label>
              <label className="field wide">
                <span>{t.titleLabel}</span>
                <input
                  value={createForm.title}
                  onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))}
                  placeholder={t.titlePlaceholder}
                />
              </label>
            </div>

            {createError ? <p className="form-error">{createError}</p> : null}
          </form>

          <div className={`prototype-result ${resultLink ? "show" : ""}`}>
            {resultLink ? (
              renderLinkShareCard(resultLink, { showManage: true })
            ) : (
              <div className="result-placeholder">
                <Link2 size={22} />
                <span>{t.resultEmptyText}</span>
              </div>
            )}
          </div>
        </section>

        <section className="link-examples" aria-label={t.examplesTitle}>
          <div className="examples-head">
            <span>{t.examplesKicker}</span>
            <strong>{t.examplesTitle}</strong>
          </div>
          <div className="examples-grid">
            {examples.map((example) => {
              const Icon = example.icon;
              return (
                <article className="example-card" key={example.shortPath}>
                  <div className="example-card-head">
                    <div className="example-icon">
                      <Icon size={17} />
                    </div>
                    <h3>{example.title}</h3>
                  </div>
                  <div className="example-flow">
                    <div>
                      <span>{t.exampleLongLabel}</span>
                      <p>{example.longUrl}</p>
                    </div>
                    <div className="example-arrow" aria-hidden="true">
                      <ChevronRight size={14} />
                    </div>
                    <div>
                      <span>{t.exampleShortLabel}</span>
                      <p className="example-short">{shortBaseDisplay}/{example.shortPath}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="features-grid">
          {[
            { icon: Zap, title: t.featureFastTitle, text: t.featureFastText },
            { icon: BarChart3, title: t.featureStatsTitle, text: t.featureStatsText },
            { icon: Edit3, title: t.featureEditTitle, text: t.featureEditText },
            { icon: Box, title: t.featureDeployTitle, text: t.featureDeployText },
            { icon: KeyRound, title: t.featureApiTitle, text: t.featureApiText },
            { icon: ShieldCheck, title: t.featureOpenTitle, text: t.featureOpenText }
          ].map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="feature-card" key={feature.title}>
                <div className="feature-icon">
                  <Icon size={18} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </section>

        <footer className="home-footer">
          <span>{t.footerCopyright(copyrightYear, brandName)}</span>
          <a href={AUTHOR_PROFILE_URL} target="_blank" rel="noreferrer">
            {t.footerAuthor}
            <ExternalLink size={13} />
          </a>
        </footer>
      </section>
    );
  }

  function renderLinksView() {
    return (
      <section className="page">
        <div className="page-head">
          <div>
            <span className="eyebrow">{t.linksEyebrow}</span>
            <h1>{t.linksPageTitle}</h1>
            <p>{t.linksPageSubtitle}</p>
          </div>
          <button className="btn primary" type="button" onClick={() => go("create")}>
            <Plus size={16} />
            {t.newLink}
          </button>
        </div>

        <section className="kpi-grid">
          <div className="kpi">
            <span>{t.linksMetric}</span>
            <strong>{formatNumber(totals.total, locale)}</strong>
          </div>
          <div className="kpi">
            <span>{t.activeMetric}</span>
            <strong>{formatNumber(totals.active, locale)}</strong>
          </div>
          <div className="kpi">
            <span>{t.clicksMetric}</span>
            <strong>{formatNumber(totals.clicks, locale)}</strong>
          </div>
          <div className="kpi">
            <span>{t.topLinkMetric}</span>
            <strong>{totals.topSlug ?? "-"}</strong>
          </div>
        </section>

        <section className="card table-card">
          <div className="toolbar">
            <label className="search-field">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} />
            </label>
            <div className="segmented" aria-label={t.statusFilter}>
              {(["all", "active", "paused"] as LinkStatusFilter[]).map((item) => (
                <button
                  key={item}
                  className={statusFilter === item ? "active" : ""}
                  type="button"
                  onClick={() => setStatusFilter(item)}
                >
                  {item === "all" ? t.filterAll : item === "active" ? t.filterActive : t.filterPaused}
                </button>
              ))}
            </div>
          </div>

          {linksQuery.isLoading ? (
            <div className="empty-state">
              <Loader2 size={20} className="spin" />
              {t.loading}
            </div>
          ) : linksQuery.error ? (
            <div className="empty-state error-state">{getErrorMessage(linksQuery.error, t.fallbackError, t)}</div>
          ) : links.length === 0 ? (
            <div className="empty-state">{t.noLinks}</div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="links-table">
                  <thead>
                    <tr>
                      <th>{t.tableStatus}</th>
                      <th>{t.tableShortLink}</th>
                      <th>{t.tableDestination}</th>
                      <th>{t.tableClicks}</th>
                      <th>{t.tableCreatedAt}</th>
                      <th>{t.tableLastClick}</th>
                      <th>{t.tableActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id} className={selectedLink?.id === link.id ? "selected-row" : ""}>
                        <td data-label={t.tableStatus}>
                          <span className={`pill ${link.isActive && !isExpired(link) ? "green" : "gray"}`}>
                            {link.isActive && !isExpired(link) ? t.active : isExpired(link) ? t.expired : t.paused}
                          </span>
                        </td>
                        <td data-label={t.tableShortLink}>
                          <button className="link-cell" type="button" onClick={() => setSelectedId(link.id)}>
                            <strong title={link.slug}>{link.slug}</strong>
                            <span title={link.shortUrl}>{link.shortUrl}</span>
                          </button>
                        </td>
                        <td className="destination-cell" data-label={t.tableDestination}>
                          <strong title={link.title || t.untitled}>{link.title || t.untitled}</strong>
                          <span title={link.targetUrl}>{link.targetUrl}</span>
                        </td>
                        <td className="number-cell" data-label={t.tableClicks}>
                          {formatNumber(link.clickCount, locale)}
                        </td>
                        <td data-label={t.tableCreatedAt}>{formatDate(link.createdAt, locale, t.never)}</td>
                        <td data-label={t.tableLastClick}>{formatDate(link.lastClickedAt, locale, t.never)}</td>
                        <td className="actions-cell" data-label={t.tableActions}>
                          <div className="row-actions">
                            <button className="icon-btn" type="button" title={t.copyShortLink} onClick={() => void handleCopy(link.shortUrl)}>
                              {copiedValue === link.shortUrl ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <a className="icon-btn" href={link.shortUrl} target="_blank" rel="noreferrer" title={t.openShortLink}>
                              <ExternalLink size={16} />
                            </a>
                            <button className="icon-btn" type="button" title={t.editLink} onClick={() => openEditor(link)}>
                              <Edit3 size={16} />
                            </button>
                            <button className="icon-btn danger" type="button" title={t.delete} onClick={() => handleDelete(link)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination-bar">
                <span>{t.paginationSummary(formatNumber(linksPageStart, locale), formatNumber(linksPageEnd, locale), formatNumber(linksTotal, locale))}</span>
                <div className="pagination-controls" aria-label={t.paginationLabel}>
                  <button className="icon-btn" type="button" title={t.previousPage} disabled={linksPage <= 1} onClick={() => setLinksPage((page) => Math.max(1, page - 1))}>
                    <ChevronLeft size={16} />
                  </button>
                  {paginationItems.map((item) =>
                    typeof item === "number" ? (
                      <button
                        key={item}
                        className={`page-btn ${linksPage === item ? "active" : ""}`}
                        type="button"
                        aria-current={linksPage === item ? "page" : undefined}
                        onClick={() => setLinksPage(item)}
                      >
                        {formatNumber(item, locale)}
                      </button>
                    ) : (
                      <span className="pagination-ellipsis" key={item}>
                        ...
                      </span>
                    )
                  )}
                  <button
                    className="icon-btn"
                    type="button"
                    title={t.nextPage}
                    disabled={linksPage >= linksPageCount}
                    onClick={() => setLinksPage((page) => Math.min(linksPageCount, page + 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    );
  }

  function renderCreateUserModal() {
    if (!createUserModalOpen) {
      return null;
    }

    const createError = createUserMutation.error ? getErrorMessage(createUserMutation.error, t.fallbackError, t) : null;

    return (
      <div className="modal-mask" role="presentation">
        <form className="modal user-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onSubmit={handleCreateUser}>
          <div className="modal-head">
            <div>
              <p className="card-kicker">{t.newUserKicker}</p>
              <h2 id="create-user-title">{t.newUserTitle}</h2>
            </div>
            <button className="icon-btn" type="button" title={t.close} aria-label={t.close} onClick={closeCreateUserModal} disabled={createUserMutation.isPending}>
              <X size={16} />
            </button>
          </div>

          <label className="field block-field">
            <span>{t.usernameLabel}</span>
            <input
              required
              autoComplete="username"
              value={userForm.username}
              onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))}
              placeholder={t.usernamePlaceholder}
            />
          </label>
          <label className="field block-field">
            <span>{t.passwordLabel}</span>
            <input
              required
              minLength={8}
              type="password"
              value={userForm.password}
              onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={t.passwordRegisterPlaceholder}
            />
          </label>
          <label className="field block-field">
            <span>{t.roleLabel}</span>
            <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
              <option value="user">{t.roleUser}</option>
              <option value="admin">{t.roleAdmin}</option>
            </select>
          </label>

          {createError ? <p className="form-error">{createError}</p> : null}

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={closeCreateUserModal} disabled={createUserMutation.isPending}>
              {t.cancel}
            </button>
            <button className="btn primary" type="submit" disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? <Loader2 size={17} className="spin" /> : <UserPlus size={17} />}
              {t.createUserSubmit}
            </button>
          </div>
        </form>
      </div>
    );
  }

  function renderEditUserModal() {
    if (!editingUser) {
      return null;
    }

    const editError = saveUserMutation.error ? getErrorMessage(saveUserMutation.error, t.fallbackError, t) : null;

    return (
      <div className="modal-mask" role="presentation">
        <form className="modal user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title" onSubmit={handleEditUserSubmit}>
          <div className="modal-head">
            <div>
              <p className="card-kicker">{t.editUserKicker}</p>
              <h2 id="edit-user-title">{t.editUserTitle}</h2>
            </div>
            <button className="icon-btn" type="button" title={t.close} aria-label={t.close} onClick={closeUserEditor} disabled={saveUserMutation.isPending}>
              <X size={16} />
            </button>
          </div>

          <div className="user-edit-summary">
            <span className="user-avatar" aria-hidden="true">
              {editingUser.username.trim().charAt(0).toUpperCase()}
            </span>
            <div className="user-identity">
              <strong>{editingUser.username}</strong>
            </div>
          </div>

          <label className="field block-field">
            <span>{t.userNameLabel}</span>
            <input
              required
              value={editUserForm.username}
              onChange={(event) => setEditUserForm((current) => ({ ...current, username: event.target.value }))}
              placeholder={t.userNamePlaceholder}
            />
          </label>

          {isAdmin ? (
            <div className="user-edit-grid">
              <label className="field block-field">
                <span>{t.roleLabel}</span>
                <select value={editUserForm.role} onChange={(event) => setEditUserForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                  <option value="user">{t.roleUser}</option>
                  <option value="admin">{t.roleAdmin}</option>
                </select>
              </label>
              <label className="field block-field">
                <span>{t.accountStatusLabel}</span>
                <select
                  value={editUserForm.isActive ? "active" : "paused"}
                  onChange={(event) => setEditUserForm((current) => ({ ...current, isActive: event.target.value === "active" }))}
                >
                  <option value="active">{t.active}</option>
                  <option value="paused">{t.paused}</option>
                </select>
              </label>
            </div>
          ) : null}

          <label className="field block-field">
            <span>{t.resetPassword}</span>
            <input
              minLength={8}
              type="password"
              value={editUserForm.password}
              onChange={(event) => setEditUserForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={t.passwordOptionalPlaceholder}
            />
          </label>

          {editError ? <p className="form-error">{editError}</p> : null}

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={closeUserEditor} disabled={saveUserMutation.isPending}>
              {t.cancel}
            </button>
            <button className="btn primary" type="submit" disabled={saveUserMutation.isPending}>
              {saveUserMutation.isPending ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
              {t.saveUser}
            </button>
          </div>
        </form>
      </div>
    );
  }

  function renderDeleteModal() {
    if (!deleteTarget) {
      return null;
    }

    return (
      <div className="modal-mask" role="presentation">
        <section
          className="modal delete-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-link-title"
          aria-describedby="delete-link-description"
        >
          <div className="delete-confirm-hero">
            <div className="delete-confirm-icon" aria-hidden="true">
              <Trash2 size={22} />
            </div>
            <div>
              <p className="card-kicker">{t.delete}</p>
              <h2 id="delete-link-title">{t.deleteConfirmTitle}</h2>
            </div>
            <button className="icon-btn" type="button" title={t.close} aria-label={t.close} onClick={closeDeleteModal} disabled={deleteMutation.isPending}>
              <X size={16} />
            </button>
          </div>

          <p className="delete-confirm-copy" id="delete-link-description">
            {t.deleteConfirmBody(deleteTarget.slug)}
          </p>

          <div className="delete-confirm-summary">
            <div>
              <span>{t.deleteConfirmShortLink}</span>
              <strong>{deleteTarget.shortUrl}</strong>
            </div>
            <div>
              <span>{t.deleteConfirmDestination}</span>
              <strong>{deleteTarget.targetUrl}</strong>
            </div>
          </div>

          {deleteMutation.error ? <p className="form-error">{getErrorMessage(deleteMutation.error, t.fallbackError, t)}</p> : null}

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={closeDeleteModal} disabled={deleteMutation.isPending}>
              {t.cancel}
            </button>
            <button className="btn danger" type="button" onClick={confirmDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 size={17} className="spin" /> : <Trash2 size={17} />}
              {t.confirmDelete}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderDeleteUserModal() {
    if (!deleteUserTarget) {
      return null;
    }

    const isBulk = deleteUserTarget.mode === "bulk";
    const isPending = deleteUserMutation.isPending || bulkDeleteUsersMutation.isPending;
    const error = deleteUserMutation.error ?? bulkDeleteUsersMutation.error;
    const usernames = deleteUserTarget.users.map((user) => user.username);
    const previewUsers = usernames.slice(0, 5);
    const extraCount = Math.max(usernames.length - previewUsers.length, 0);

    return (
      <div className="modal-mask" role="presentation">
        <section
          className="modal delete-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
          aria-describedby="delete-user-description"
        >
          <div className="delete-confirm-hero">
            <div className="delete-confirm-icon" aria-hidden="true">
              <Trash2 size={22} />
            </div>
            <div>
              <p className="card-kicker">{t.delete}</p>
              <h2 id="delete-user-title">{isBulk ? t.deleteUsersTitle(String(usernames.length)) : t.deleteUserTitle}</h2>
            </div>
            <button className="icon-btn" type="button" title={t.close} aria-label={t.close} onClick={closeDeleteUserModal} disabled={isPending}>
              <X size={16} />
            </button>
          </div>

          <p className="delete-confirm-copy" id="delete-user-description">
            {isBulk ? t.deleteUsersBody(String(usernames.length)) : t.deleteUserBody(usernames[0] ?? "")}
          </p>

          <div className="delete-users-list">
            {previewUsers.map((username) => (
              <span key={username}>{username}</span>
            ))}
            {extraCount > 0 ? <span>{t.deleteUsersMore(String(extraCount))}</span> : null}
          </div>

          {error ? <p className="form-error">{getErrorMessage(error, t.fallbackError, t)}</p> : null}

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={closeDeleteUserModal} disabled={isPending}>
              {t.cancel}
            </button>
            <button className="btn danger" type="button" onClick={confirmDeleteUser} disabled={isPending}>
              {isPending ? <Loader2 size={17} className="spin" /> : <Trash2 size={17} />}
              {t.confirmDelete}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderUsersView() {
    const visibleUsers = usersQuery.data?.items ?? [];
    const deletableUsers = isAdmin ? visibleUsers.filter((user) => user.id !== currentUser?.id) : [];
    const selectedVisibleUsers = deletableUsers.filter((user) => selectedUserIds.has(user.id));
    const allVisibleUsersSelected = deletableUsers.length > 0 && selectedVisibleUsers.length === deletableUsers.length;

    return (
      <section className="page">
        <div className="page-head">
          <div>
            <span className="eyebrow">{t.usersEyebrow}</span>
            <h1>{t.usersPageTitle}</h1>
            <p>{isAdmin ? t.usersPageSubtitle : t.userProfileSubtitle}</p>
          </div>
        </div>

        <section className="users-panel">
          <section className="card table-card users-table-card">
            <div className="toolbar users-table-toolbar">
              {isAdmin ? (
                <label className="search-field">
                  <Search size={16} />
                  <input
                    autoComplete="off"
                    name="tokurl-user-search"
                    type="search"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder={t.searchUsers}
                  />
                </label>
              ) : (
                <p className="users-table-note">{t.userProfileOnly}</p>
              )}
              {isAdmin ? (
                <div className="user-toolbar-actions">
                  {selectedVisibleUsers.length > 0 ? (
                    <button className="btn danger" type="button" onClick={() => openBulkDeleteUsersModal(selectedVisibleUsers)}>
                      <Trash2 size={17} />
                      {t.bulkDeleteUsers(String(selectedVisibleUsers.length))}
                    </button>
                  ) : null}
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      createUserMutation.reset();
                      setUserForm(emptyUserForm);
                      setCreateUserModalOpen(true);
                    }}
                  >
                    <UserPlus size={17} />
                    {t.createUserSubmit}
                  </button>
                </div>
              ) : null}
            </div>

            {usersQuery.isLoading ? (
              <div className="empty-state">
                <Loader2 size={20} className="spin" />
                {t.loading}
              </div>
            ) : usersQuery.error ? (
              <div className="empty-state error-state">{getErrorMessage(usersQuery.error, t.fallbackError, t)}</div>
            ) : visibleUsers.length === 0 ? (
              <div className="empty-state">{t.noUsers}</div>
            ) : (
              <div className="table-wrap">
                <table className={`users-table ${isAdmin ? "with-selection" : ""}`}>
                  <thead>
                    <tr>
                      {isAdmin ? (
                        <th className="select-col">
                          <label className="selection-checkbox" title={t.selectAllUsers}>
                            <input
                              type="checkbox"
                              checked={allVisibleUsersSelected}
                              disabled={deletableUsers.length === 0}
                              onChange={(event) => setVisibleUserSelection(deletableUsers, event.target.checked)}
                            />
                            <span>{t.selectAllUsers}</span>
                          </label>
                        </th>
                      ) : null}
                      <th>{t.tableUser}</th>
                      <th>{t.tableRole}</th>
                      <th>{t.tableStatus}</th>
                      <th>{t.tableCreatedAt}</th>
                      <th>{t.tableLastLogin}</th>
                      <th>{t.tableActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => {
                      const canEditProfile = isAdmin || user.id === currentUser?.id;
                      return (
                        <tr key={user.id}>
                          {isAdmin ? (
                            <td className="select-col" data-label={t.selectUser}>
                              {user.id !== currentUser?.id ? (
                                <label className="selection-checkbox" title={t.selectUser}>
                                  <input
                                    type="checkbox"
                                    checked={selectedUserIds.has(user.id)}
                                    onChange={(event) => toggleUserSelection(user.id, event.target.checked)}
                                  />
                                  <span>{t.selectUser}</span>
                                </label>
                              ) : (
                                <span className="current-user-note">{t.currentUser}</span>
                              )}
                            </td>
                          ) : null}
                          <td className="user-cell-wrap" data-label={t.tableUser}>
                            <div className="user-cell">
                              <span className="user-avatar" aria-hidden="true">
                                {user.username.trim().charAt(0).toUpperCase()}
                              </span>
                              <span className="user-identity">
                                <strong title={user.username}>{user.username}</strong>
                              </span>
                            </div>
                          </td>
                          <td data-label={t.tableRole}>
                            <span className={`pill ${user.role === "admin" ? "brand" : "gray"}`}>{user.role === "admin" ? t.roleAdmin : t.roleUser}</span>
                          </td>
                          <td data-label={t.tableStatus}>
                            <span className={`pill ${user.isActive ? "green" : "gray"}`}>{user.isActive ? t.active : t.paused}</span>
                          </td>
                          <td data-label={t.tableCreatedAt}>{formatDate(user.createdAt, locale, t.never)}</td>
                          <td data-label={t.tableLastLogin}>{formatDate(user.lastLoginAt, locale, t.never)}</td>
                          <td className="actions-cell" data-label={t.tableActions}>
                            <div className="user-actions">
                              {canEditProfile ? (
                                <button className="btn ghost compact" type="button" onClick={() => openUserEditor(user)}>
                                  <Edit3 size={15} />
                                  {t.editUserAction}
                                </button>
                              ) : null}
                              {isAdmin && user.id !== currentUser?.id ? (
                                <button className="btn danger compact" type="button" onClick={() => openDeleteUserModal(user)}>
                                  <Trash2 size={15} />
                                  {t.delete}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      </section>
    );
  }

  function renderAnalyticsView() {
    const analyticsSummary = selectedStats ? ("link" in selectedStats ? selectedStats.link : selectedStats.summary) : null;
    const analyticsKicker = selectedStats ? ("link" in selectedStats ? selectedStats.link.slug : t.analyticsAllLinks) : t.analyticsAllLinks;
    const selectedStatsLink = selectedStats && "link" in selectedStats ? selectedStats.link : null;
    const analyticsLinkOptions = analyticsLinksQuery.data?.items ?? links;
    const selectLinks =
      selectedLink && !analyticsLinkOptions.some((link) => link.id === selectedLink.id)
        ? [selectedLink, ...analyticsLinkOptions]
        : selectedStatsLink && !analyticsLinkOptions.some((link) => link.id === selectedStatsLink.id)
          ? [selectedStatsLink, ...analyticsLinkOptions]
          : analyticsLinkOptions;

    return (
      <section className="page">
        <div className="page-head">
          <div>
            <span className="eyebrow">{t.analyticsEyebrow}</span>
            <h1>{t.analyticsPageTitle}</h1>
            <p>{t.analyticsPageSubtitle}</p>
          </div>
          <div className="head-controls">
            <select
              value={analyticsSelection}
              onChange={(event) => setSelectedId(event.target.value === ANALYTICS_ALL_VALUE ? null : event.target.value)}
              disabled={linksQuery.isLoading && !selectedId}
            >
              <option value={ANALYTICS_ALL_VALUE}>{t.analyticsAllLinks}</option>
              {selectLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.slug}
                </option>
              ))}
            </select>
            <div className="segmented">
              {(["7d", "30d", "all"] as RangeFilter[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  className={rangeFilter === range ? "active" : ""}
                  onClick={() => setRangeFilter(range)}
                >
                  {range === "7d" ? t.range7d : range === "30d" ? t.range30d : t.rangeAll}
                </button>
              ))}
            </div>
          </div>
        </div>

        {statsQuery.isLoading ? (
          <div className="card empty-state">
            <Loader2 size={20} className="spin" />
            {t.loading}
          </div>
        ) : statsQuery.error ? (
          <div className="card empty-state error-state">{getErrorMessage(statsQuery.error, t.fallbackError, t)}</div>
        ) : selectedStats && analyticsSummary ? (
          <>
            <section className="kpi-grid">
              <div className="kpi">
                <span>{t.totalClicks}</span>
                <strong>{formatNumber(analyticsSummary.clickCount, locale)}</strong>
              </div>
              <div className="kpi">
                <span>{t.todayClicks}</span>
                <strong>{formatNumber(todayClicks, locale)}</strong>
              </div>
              <div className="kpi">
                <span>{t.referrerCount}</span>
                <strong>{formatNumber(selectedStats.referrers.length, locale)}</strong>
              </div>
              <div className="kpi">
                <span>{t.lastClick}</span>
                <strong>{formatDate(analyticsSummary.lastClickedAt, locale, t.never)}</strong>
              </div>
            </section>

            <section className="analytics-grid">
              <div className="card chart-card">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">{analyticsKicker}</p>
                    <h2>{t.dailyTrend}</h2>
                  </div>
                  <MousePointerClick size={20} />
                </div>
                {visibleDaily.length === 0 ? (
                  <div className="empty-state compact">{t.noClickData}</div>
                ) : (
                  <div className={`bar-chart ${visibleDaily.length <= 3 ? "compact-bars" : ""}`}>
                    {visibleDaily.map((item) => (
                      <div className="bar-column" key={item.day}>
                        <div style={{ height: `${Math.max((item.clicks / dailyMax) * 100, 6)}%` }} />
                        <span>{formatDay(item.day, locale)}</span>
                        <strong>{item.clicks}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card rank-card">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">{t.sourceKicker}</p>
                    <h2>{t.referrers}</h2>
                  </div>
                  <SlidersHorizontal size={20} />
                </div>
                {selectedStats.referrers.length === 0 ? (
                  <div className="empty-state compact">{t.noClickData}</div>
                ) : (
                  <div className="rank-list">
                    {selectedStats.referrers.map((item) => (
                      <div className="rank-row" key={item.referrer}>
                        <span>{item.referrer === "Direct" ? t.direct : item.referrer}</span>
                        <div>
                          <i style={{ width: `${Math.max((item.clicks / Math.max(referrerTotal, 1)) * 100, 5)}%` }} />
                        </div>
                        <strong>{item.clicks}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card rank-card">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">{t.deviceKicker}</p>
                    <h2>{t.devices}</h2>
                  </div>
                  <Activity size={20} />
                </div>
                {selectedStats.devices.length === 0 ? (
                  <div className="empty-state compact">{t.noClickData}</div>
                ) : (
                  <div className="rank-list">
                    {selectedStats.devices.map((item) => (
                      <div className="rank-row" key={item.device}>
                        <span>{item.device}</span>
                        <div>
                          <i style={{ width: `${Math.max((item.clicks / Math.max(deviceTotal, 1)) * 100, 5)}%` }} />
                        </div>
                        <strong>{item.clicks}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card recent-card">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">{t.eventKicker}</p>
                    <h2>{t.recentVisits}</h2>
                  </div>
                  <CalendarClock size={20} />
                </div>
                {selectedStats.recent.length === 0 ? (
                  <div className="empty-state compact">{t.noClickData}</div>
                ) : (
                  <div className="recent-list">
                    {selectedStats.recent.map((click) => (
                      <div key={`${click.clickedAt}-${click.slug ?? ""}-${click.userAgent ?? ""}`}>
                        <span>{formatDate(click.clickedAt, locale, t.never)}</span>
                        <strong>
                          {selectedStats.scope === "all" && click.slug
                            ? `${click.slug} · ${click.referrer || t.direct}`
                            : click.referrer || t.direct}
                        </strong>
                        <small>{click.userAgent || t.unknownDevice}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </section>
    );
  }

  function renderSettingsPanel() {
    const apiBase = configQuery.data?.shortBaseUrl ?? "http://localhost:8080";
    const createExample = `curl -X POST ${apiBase}/api/links \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer <token>' \\
  -d '{"targetUrl":"https://example.com","slug":"go"}'`;
    const composeExample = `WEB_PORT=3000 API_PORT=8080 \\
PUBLIC_SHORT_BASE_URL=${apiBase} \\
docker compose up --build`;

    if (settingsTab === "site") {
      return (
        <form className="settings-panel" onSubmit={handleSiteSettingsSubmit}>
          <div className="panel-title">
            <FileText size={20} />
            <h2>{t.settingsSite}</h2>
          </div>
          <div className="site-settings-form">
            <label className="field block-field" htmlFor="site-settings-name">
              <span>{t.siteNameLabel}</span>
              <input
                id="site-settings-name"
                required
                maxLength={120}
                value={siteSettingsForm.siteName}
                onChange={(event) => setSiteSettingsForm((current) => ({ ...current, siteName: event.target.value }))}
                placeholder={t.siteNamePlaceholder}
              />
            </label>
            <label className="field block-field" htmlFor="site-settings-seo-title">
              <span>{t.seoTitleLabel}</span>
              <input
                id="site-settings-seo-title"
                maxLength={160}
                value={siteSettingsForm.seoTitle}
                onChange={(event) => setSiteSettingsForm((current) => ({ ...current, seoTitle: event.target.value }))}
                placeholder={t.seoTitlePlaceholder}
              />
            </label>
            <label className="field block-field" htmlFor="site-settings-seo-description">
              <span>{t.seoDescriptionLabel}</span>
              <textarea
                id="site-settings-seo-description"
                maxLength={300}
                value={siteSettingsForm.seoDescription}
                onChange={(event) => setSiteSettingsForm((current) => ({ ...current, seoDescription: event.target.value }))}
                placeholder={t.seoDescriptionPlaceholder}
                rows={3}
              />
            </label>
            <label className="field block-field" htmlFor="site-settings-seo-keywords">
              <span>{t.seoKeywordsLabel}</span>
              <textarea
                id="site-settings-seo-keywords"
                maxLength={300}
                value={siteSettingsForm.seoKeywords}
                onChange={(event) => setSiteSettingsForm((current) => ({ ...current, seoKeywords: event.target.value }))}
                placeholder={t.seoKeywordsPlaceholder}
                rows={2}
              />
            </label>
            <label className="field block-field analytics-code-field" htmlFor="site-settings-analytics-code">
              <span>{t.analyticsCodeLabel}</span>
              <textarea
                id="site-settings-analytics-code"
                maxLength={12_000}
                value={siteSettingsForm.analyticsCode}
                onChange={(event) => setSiteSettingsForm((current) => ({ ...current, analyticsCode: event.target.value }))}
                placeholder={t.analyticsCodePlaceholder}
                spellCheck={false}
                rows={7}
              />
              <small>{t.analyticsCodeHelp}</small>
            </label>
          </div>
          {siteSettingsMutation.error ? <p className="form-error">{getErrorMessage(siteSettingsMutation.error, t.fallbackError, t)}</p> : null}
          <div className="settings-actions">
            <button className="btn primary" type="submit" disabled={siteSettingsMutation.isPending}>
              {siteSettingsMutation.isPending ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
              {t.saveSiteSettings}
            </button>
          </div>
        </form>
      );
    }

    if (settingsTab === "api") {
      return (
        <section className="settings-panel">
          <div className="panel-title">
            <KeyRound size={20} />
            <h2>{t.settingsApi}</h2>
          </div>
          <label className="field block-field">
            <span>{t.adminToken}</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={configQuery.data?.adminAuthEnabled ? t.required : t.optional}
            />
          </label>
          <div className="endpoint-list">
            <code>GET /api/links</code>
            <code>POST /api/links</code>
            <code>PATCH /api/links/:id</code>
            <code>GET /api/links/stats</code>
            <code>GET /api/links/:id/stats</code>
          </div>
          <pre className="code-block">{createExample}</pre>
          <button className="btn ghost" type="button" onClick={() => void handleCopy(createExample)}>
            <Copy size={16} />
            {t.copyExample}
          </button>
        </section>
      );
    }

    if (settingsTab === "webhook") {
      return (
        <section className="settings-panel">
          <div className="panel-title">
            <Webhook size={20} />
            <h2>{t.settingsWebhook}</h2>
          </div>
          <div className="setting-rows">
            <div>
              <span>{t.webhookStatus}</span>
              <strong>{t.webhookReserved}</strong>
            </div>
            <div>
              <span>{t.analyticsSwitch}</span>
              <strong>{configQuery.data?.analyticsEnabled ? t.active : t.paused}</strong>
            </div>
          </div>
        </section>
      );
    }

    if (settingsTab === "deploy") {
      return (
        <section className="settings-panel">
          <div className="panel-title">
            <Terminal size={20} />
            <h2>{t.settingsDeploy}</h2>
          </div>
          <div className="setting-rows">
            <div>
              <span>Postgres</span>
              <strong>17-alpine</strong>
            </div>
            <div>
              <span>Redis</span>
              <strong>7-alpine</strong>
            </div>
            <div>
              <span>Node.js</span>
              <strong>&gt;= 22</strong>
            </div>
          </div>
          <pre className="code-block">{composeExample}</pre>
          <button className="btn ghost" type="button" onClick={() => void handleCopy(composeExample)}>
            <Copy size={16} />
            {t.copyDeploy}
          </button>
        </section>
      );
    }

    return (
      <section className="settings-panel">
        <div className="panel-title">
          <Globe2 size={20} />
          <h2>{t.settingsDomain}</h2>
        </div>
        <div className="setting-rows">
          <div>
            <span>{t.runtimeBase}</span>
            <strong>{configQuery.data?.shortBaseUrl ?? "..."}</strong>
          </div>
          <div>
            <span>{t.runtimeSlug}</span>
            <strong>{configQuery.data ? `${configQuery.data.slugLength} ${t.chars}` : "..."}</strong>
          </div>
          <div>
            <span>{t.runtimeRedirect}</span>
            <strong>{configQuery.data?.redirectStatus ?? "..."}</strong>
          </div>
          <div>
            <span>{t.authMode}</span>
            <strong>{configQuery.data?.adminAuthEnabled ? t.sessionAuth : t.localOpen}</strong>
          </div>
        </div>
      </section>
    );
  }

  function renderSettingsView() {
    return (
      <section className="page">
        <div className="page-head">
          <div>
            <span className="eyebrow">{t.settingsEyebrow}</span>
            <h1>{t.settingsPageTitle}</h1>
            <p>{t.settingsPageSubtitle}</p>
          </div>
        </div>

        <section className="settings-grid">
          <aside className="settings-nav">
            {settingsItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={settingsTab === item.id ? "active" : ""}
                  onClick={() => setSettingsTab(item.id)}
                >
                  <Icon size={17} />
                  {item.label}
                </button>
              );
            })}
          </aside>
          <div className="card settings-card">{renderSettingsPanel()}</div>
        </section>
      </section>
    );
  }

  function renderEditModal() {
    if (!editModalOpen || !selectedLink) {
      return null;
    }

    return (
      <div className="modal-mask" role="presentation">
        <form className="modal link-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-link-title" onSubmit={handleUpdate}>
          <div className="modal-head">
            <div>
              <p className="card-kicker">{t.editEyebrow}</p>
              <h2 id="edit-link-title">{selectedLink.slug}</h2>
            </div>
            <button className="icon-btn" type="button" title={t.close} onClick={() => setEditModalOpen(false)}>
              <X size={17} />
            </button>
          </div>

          <div className="modal-body-grid">
            <section className="modal-share-panel" aria-label={t.sharePanelTitle}>
              {renderLinkShareCard(selectedLink)}
            </section>

            <section className="modal-form-panel">
              <label className="field block-field">
                <span>{t.destinationUrl}</span>
                <input
                  required
                  type="url"
                  value={editForm.targetUrl}
                  onChange={(event) => setEditForm((form) => ({ ...form, targetUrl: event.target.value }))}
                />
              </label>

              <label className="field block-field">
                <span>{t.titleLabel}</span>
                <input value={editForm.title} onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))} />
              </label>

              <div className="advanced-grid">
                {isAdmin ? (
                  <label className="field">
                    <span>{t.alias}</span>
                    <input value={editForm.slug} onChange={(event) => setEditForm((form) => ({ ...form, slug: event.target.value }))} />
                  </label>
                ) : (
                  <div className="permission-note">
                    <ShieldCheck size={15} />
                    <span>{t.editSlugAdminOnlyHint}</span>
                  </div>
                )}
                <label className="field">
                  <span>{t.expires}</span>
                  <input
                    type="datetime-local"
                    value={editForm.expiresAt}
                    onChange={(event) => setEditForm((form) => ({ ...form, expiresAt: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>{t.description}</span>
                  <input
                    value={editForm.description}
                    onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))}
                  />
                </label>
              </div>

              <label className="switch-line">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm((form) => ({ ...form, isActive: event.target.checked }))}
                />
                <Power size={16} />
                <span>{editForm.isActive ? t.active : t.paused}</span>
              </label>

              {updateMutation.error ? <p className="form-error">{getErrorMessage(updateMutation.error, t.fallbackError, t)}</p> : null}
            </section>
          </div>

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={() => setEditModalOpen(false)}>
              {t.cancel}
            </button>
            <button className="btn primary" type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
              {t.save}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (meQuery.isLoading && view !== "create") {
    return (
      <main className="tokurl-app">
        <div className="card empty-state app-loading">
          <Loader2 size={20} className="spin" />
          {t.loading}
        </div>
      </main>
    );
  }

  if (!currentUser && view !== "create") {
    return (
      <main className="tokurl-app">
        <div className="auth-topbar">
          <a className="logo" href={VIEW_PATHS.create} aria-label={brandName}>
            <span className="logo-mark">{brandInitial}</span>
            <strong>{brandName}</strong>
          </a>
          <button
            className="icon-btn"
            type="button"
            title={t.languageToggleTitle}
            onClick={() => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"))}
          >
            <Languages size={16} />
            <span>{t.languageToggle}</span>
          </button>
        </div>
        {renderAuthView()}

        <div className={`toast ${toast ? "show" : ""}`} role="status">
          {toast?.message}
        </div>
        {renderAuthModal()}
      </main>
    );
  }

  return (
    <main className="tokurl-app">
      <header className="nav">
        <div className="nav-inner">
          <a
            className="logo"
            href={VIEW_PATHS.create}
            aria-label={brandName}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
              }
              event.preventDefault();
              go("create");
            }}
          >
            <span className="logo-mark">{brandInitial}</span>
            <strong>{brandName}</strong>
          </a>

          <nav className="nav-links" aria-label={t.primaryNav}>
            {navItems.filter((item) => (currentUser ? item.id !== "settings" || isAdmin : item.id === "create")).map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.id}
                  href={getViewUrl(item.id)}
                  className={view === item.id ? "active" : ""}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      return;
                    }
                    event.preventDefault();
                    if (item.id === "analytics") {
                      setSelectedId(null);
                    }
                    go(item.id);
                  }}
                >
                  <Icon size={15} />
                  {item.label}
                </a>
              );
            })}
          </nav>

          <div className="nav-right">
            {renderServiceBadge()}
            {currentUser ? (
              <span
                className="user-badge nav-user-badge"
                title={`${currentUser.username} · ${currentUser.role === "admin" ? t.roleAdmin : t.roleUser}`}
                aria-label={`${currentUser.username} · ${currentUser.role === "admin" ? t.roleAdmin : t.roleUser}`}
              >
                <ShieldCheck size={13} />
                <span className="user-email">{currentUser.username}</span>
                <strong>{currentUser.role === "admin" ? t.roleAdmin : t.roleUser}</strong>
              </span>
            ) : null}
            <button
              className="icon-btn"
              type="button"
              title={t.languageToggleTitle}
              onClick={() => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"))}
            >
              <Languages size={16} />
              <span>{t.languageToggle}</span>
            </button>
            <button className="icon-btn" type="button" title={t.refresh} onClick={() => void queryClient.invalidateQueries()}>
              <RefreshCw size={16} />
            </button>
            {currentUser ? (
              <button className="icon-btn" type="button" title={t.logoutAction} onClick={() => logoutMutation.mutate()}>
                {logoutMutation.isPending ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />}
              </button>
            ) : (
              <div className="guest-auth-actions">
                <button className="btn ghost compact" type="button" onClick={() => openAuthModal("login")}>
                  {t.guestSignIn}
                </button>
                <button className="btn primary compact" type="button" onClick={() => openAuthModal("register")}>
                  {t.guestRegister}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {view === "create" ? renderCreateView() : null}
      {view === "links" ? renderLinksView() : null}
      {view === "analytics" ? renderAnalyticsView() : null}
      {view === "users" ? renderUsersView() : null}
      {view === "settings" && isAdmin ? renderSettingsView() : null}
      {renderEditModal()}
      {renderDeleteModal()}
      {renderCreateUserModal()}
      {renderEditUserModal()}
      {renderDeleteUserModal()}
      {renderAuthModal()}

      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast?.message}
      </div>
    </main>
  );
}
