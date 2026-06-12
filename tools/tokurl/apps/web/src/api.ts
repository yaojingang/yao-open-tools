import type {
  AllLinkStats,
  BulkDeleteUsersResponse,
  CurrentUser,
  LinkInput,
  LinkListResponse,
  LinkStats,
  PublicLink,
  PublicUser,
  RuntimeConfig,
  SiteSettings,
  UserListResponse,
  UserRole
} from "./types";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const clientIdStorageKey = "tokurl_client_id";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed with ${response.status}`, response.status, body?.error);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(clientIdStorageKey);
    if (existing) {
      return existing;
    }

    const next = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(clientIdStorageKey, next);
    return next;
  } catch {
    return "storage-unavailable";
  }
}

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  return request<RuntimeConfig>("/api/config", "");
}

export function getCurrentUser(): Promise<{ user: CurrentUser }> {
  return request<{ user: CurrentUser }>("/api/auth/me", "");
}

export function login(input: { username: string; password: string }): Promise<{ user: CurrentUser }> {
  return request<{ user: CurrentUser }>("/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function register(input: { username: string; password: string }): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser }>("/api/auth/register", "", {
    method: "POST",
    headers: {
      "X-TokURL-Client-Id": getClientId()
    },
    body: JSON.stringify(input)
  });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", "", {
    method: "POST"
  });
}

export function listLinks(
  token: string,
  input: { search: string; status: "all" | "active" | "paused"; limit: number; offset: number }
): Promise<LinkListResponse> {
  const params = new URLSearchParams();
  if (input.search.trim()) {
    params.set("search", input.search.trim());
  }
  params.set("status", input.status);
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));

  return request<LinkListResponse>(`/api/links?${params.toString()}`, token);
}

export function createLink(token: string, input: LinkInput): Promise<PublicLink> {
  return request<PublicLink>("/api/links", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateLink(token: string, id: string, input: Partial<LinkInput>): Promise<PublicLink> {
  return request<PublicLink>(`/api/links/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteLink(token: string, id: string): Promise<PublicLink> {
  return request<PublicLink>(`/api/links/${id}`, token, {
    method: "DELETE"
  });
}

export function getAllLinkStats(token: string): Promise<AllLinkStats> {
  return request<AllLinkStats>("/api/links/stats", token);
}

export function getLinkStats(token: string, id: string): Promise<LinkStats> {
  return request<LinkStats>(`/api/links/${id}/stats`, token);
}

export function listUsers(token: string, search = ""): Promise<UserListResponse> {
  const params = new URLSearchParams();
  if (search.trim()) {
    params.set("search", search.trim());
  }
  params.set("limit", "100");

  return request<UserListResponse>(`/api/users?${params.toString()}`, token);
}

export function createUser(
  token: string,
  input: { username: string; password: string; role: UserRole; isActive?: boolean }
): Promise<PublicUser> {
  return request<PublicUser>("/api/users", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateUser(
  token: string,
  id: string,
  input: { username?: string; role?: UserRole; isActive?: boolean }
): Promise<PublicUser> {
  return request<PublicUser>(`/api/users/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteUser(token: string, id: string): Promise<PublicUser> {
  return request<PublicUser>(`/api/users/${id}`, token, {
    method: "DELETE"
  });
}

export function bulkDeleteUsers(token: string, ids: string[]): Promise<BulkDeleteUsersResponse> {
  return request<BulkDeleteUsersResponse>("/api/users/bulk-delete", token, {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function resetUserPassword(token: string, id: string, password: string): Promise<PublicUser> {
  return request<PublicUser>(`/api/users/${id}/password`, token, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function getSiteSettings(token: string): Promise<SiteSettings> {
  return request<SiteSettings>("/api/settings/site", token);
}

export function updateSiteSettings(token: string, input: Partial<Omit<SiteSettings, "updatedAt">>): Promise<SiteSettings> {
  return request<SiteSettings>("/api/settings/site", token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
