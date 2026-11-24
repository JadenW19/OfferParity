import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { BILLING_PLANS } from "@/lib/billing/plans";
import type {
  OverallVerdict,
  WatchlistItem,
  WatchlistPlan,
  WatchlistStatus,
  WatchlistWorkspace,
} from "@/lib/schemas";

const WORKSPACE_IDS_KEY = "offerparity:watchlist:workspace_ids";
const WORKSPACE_KEY_PREFIX = "offerparity:watchlist:ws:";
const TOKEN_MAP_KEY_PREFIX = "offerparity:watchlist:token:";
const SESSION_MAP_KEY_PREFIX = "offerparity:watchlist:session:";
const CUSTOMER_MAP_KEY_PREFIX = "offerparity:watchlist:customer:";
const ITEMS_KEY_PREFIX = "offerparity:watchlist:items:";
const EXEC_KEY_PREFIX = "offerparity:schedule:exec:";

const EXECUTION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PILOT_MAX_ITEMS = 25;
const PILOT_DURATION_DAYS = 7;

export interface PublicWatchlistWorkspace {
  id: string;
  email: string;
  brandName: string;
  plan: WatchlistPlan;
  status: WatchlistStatus;
  maxItems: number;
  slackWebhookConfigured: boolean;
  slackWebhookMasked: string | null;
  hasStripeCustomer: boolean;
  pilotExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: WatchlistItem[];
}

interface MemoryStoreState {
  workspaceIds: Set<string>;
  workspaces: Map<string, WatchlistWorkspace>;
  tokenToWorkspaceId: Map<string, string>;
  sessionToWorkspaceId: Map<string, string>;
  customerToWorkspaceId: Map<string, string>;
  itemsByWorkspace: Map<string, WatchlistItem[]>;
  executions: Set<string>;
}

const memoryStore: MemoryStoreState = {
  workspaceIds: new Set(),
  workspaces: new Map(),
  tokenToWorkspaceId: new Map(),
  sessionToWorkspaceId: new Map(),
  customerToWorkspaceId: new Map(),
  itemsByWorkspace: new Map(),
  executions: new Set(),
};

let cachedRedis: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (cachedRedis !== undefined) {
    return cachedRedis;
  }
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    cachedRedis = null;
    return null;
  }

  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}

export function isPersistentWatchlistStoreConfigured(): boolean {
  return getRedisClient() !== null;
}

export function resetInMemoryWatchlistStore(): void {
  memoryStore.workspaceIds.clear();
  memoryStore.workspaces.clear();
  memoryStore.tokenToWorkspaceId.clear();
  memoryStore.sessionToWorkspaceId.clear();
  memoryStore.customerToWorkspaceId.clear();
  memoryStore.itemsByWorkspace.clear();
  memoryStore.executions.clear();
}

export function resolveMaxItemsForPlan(plan: WatchlistPlan): number {
  if (plan === "agency") return BILLING_PLANS.agency.maxWatchlistItems;
  if (plan === "growth") return BILLING_PLANS.growth.maxWatchlistItems;
  return PILOT_MAX_ITEMS;
}

export function maskSlackWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.length <= 42) {
    return "https://hooks.slack.com/services/****";
  }
  return `${trimmed.slice(0, 42)}...${trimmed.slice(-4)}`;
}

export function toPublicWorkspaceView(
  ws: WatchlistWorkspace,
  items: WatchlistItem[]
): PublicWatchlistWorkspace {
  return {
    id: ws.id,
    email: ws.email,
    brandName: ws.brandName,
    plan: ws.plan,
    status: ws.status,
    maxItems: ws.maxItems,
    slackWebhookConfigured: Boolean(ws.slackWebhookUrl),
    slackWebhookMasked: maskSlackWebhookUrl(ws.slackWebhookUrl),
    hasStripeCustomer: Boolean(ws.stripeCustomerId),
    pilotExpiresAt: ws.pilotExpiresAt,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    items,
  };
}

async function saveWorkspaceRecord(ws: WatchlistWorkspace): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    memoryStore.workspaceIds.add(ws.id);
    memoryStore.workspaces.set(ws.id, ws);
    memoryStore.tokenToWorkspaceId.set(ws.managementToken, ws.id);
    if (ws.stripeCheckoutSessionId) {
      memoryStore.sessionToWorkspaceId.set(ws.stripeCheckoutSessionId, ws.id);
    }
    if (ws.stripeCustomerId) {
      memoryStore.customerToWorkspaceId.set(ws.stripeCustomerId, ws.id);
    }
    return;
  }

  await Promise.all([
    redis.sadd(WORKSPACE_IDS_KEY, ws.id),
    redis.set(`${WORKSPACE_KEY_PREFIX}${ws.id}`, JSON.stringify(ws)),
    redis.set(`${TOKEN_MAP_KEY_PREFIX}${ws.managementToken}`, ws.id),
    ws.stripeCheckoutSessionId
      ? redis.set(`${SESSION_MAP_KEY_PREFIX}${ws.stripeCheckoutSessionId}`, ws.id)
      : Promise.resolve(),
    ws.stripeCustomerId
      ? redis.set(`${CUSTOMER_MAP_KEY_PREFIX}${ws.stripeCustomerId}`, ws.id)
      : Promise.resolve(),
  ]);
}

function parseJsonValue<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

export async function getWorkspaceById(
  workspaceId: string
): Promise<WatchlistWorkspace | null> {
  const redis = getRedisClient();
  if (!redis) {
    return memoryStore.workspaces.get(workspaceId) ?? null;
  }
  const raw = await redis.get(`${WORKSPACE_KEY_PREFIX}${workspaceId}`);
  return parseJsonValue<WatchlistWorkspace>(raw);
}

export async function getWorkspaceByToken(
  token: string
): Promise<WatchlistWorkspace | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const redis = getRedisClient();
  if (!redis) {
    const id = memoryStore.tokenToWorkspaceId.get(trimmed);
    return id ? (memoryStore.workspaces.get(id) ?? null) : null;
  }

  const id = await redis.get<string>(`${TOKEN_MAP_KEY_PREFIX}${trimmed}`);
  if (!id) return null;
  return getWorkspaceById(id);
}

export async function getWorkspaceBySessionId(
  sessionId: string
): Promise<WatchlistWorkspace | null> {
  const trimmed = sessionId.trim();
  if (!trimmed) return null;

  const redis = getRedisClient();
  if (!redis) {
    const id = memoryStore.sessionToWorkspaceId.get(trimmed);
    return id ? (memoryStore.workspaces.get(id) ?? null) : null;
  }

  const id = await redis.get<string>(`${SESSION_MAP_KEY_PREFIX}${trimmed}`);
  if (!id) return null;
  return getWorkspaceById(id);
}

export async function getWorkspaceByCustomerId(
  customerId: string
): Promise<WatchlistWorkspace | null> {
  const trimmed = customerId.trim();
  if (!trimmed) return null;

  const redis = getRedisClient();
  if (!redis) {
    const id = memoryStore.customerToWorkspaceId.get(trimmed);
    return id ? (memoryStore.workspaces.get(id) ?? null) : null;
  }

  const id = await redis.get<string>(`${CUSTOMER_MAP_KEY_PREFIX}${trimmed}`);
  if (!id) return null;
  return getWorkspaceById(id);
}

export async function getWorkspaceItems(
  workspaceId: string
): Promise<WatchlistItem[]> {
  const redis = getRedisClient();
  if (!redis) {
    return [...(memoryStore.itemsByWorkspace.get(workspaceId) ?? [])];
  }
  const raw = await redis.get(`${ITEMS_KEY_PREFIX}${workspaceId}`);
  const parsed = parseJsonValue<WatchlistItem[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveWorkspaceItems(
  workspaceId: string,
  items: WatchlistItem[]
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    memoryStore.itemsByWorkspace.set(workspaceId, [...items]);
    return;
  }
  await redis.set(`${ITEMS_KEY_PREFIX}${workspaceId}`, JSON.stringify(items));
}

export async function createPilotWorkspace(input: {
  email: string;
  brandName: string;
  slackWebhookUrl?: string;
}): Promise<WatchlistWorkspace> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + PILOT_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const workspace: WatchlistWorkspace = {
    id: `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    managementToken: crypto.randomBytes(24).toString("hex"),
    email: input.email.trim().toLowerCase(),
    brandName: input.brandName.trim(),
    plan: "pilot",
    status: "active",
    maxItems: PILOT_MAX_ITEMS,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    slackWebhookUrl: input.slackWebhookUrl?.trim() || null,
    pilotExpiresAt: expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await saveWorkspaceRecord(workspace);
  return workspace;
}

export async function provisionPaidWorkspace(input: {
  email: string;
  brandName?: string;
  plan: "growth" | "agency";
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
}): Promise<WatchlistWorkspace> {
  if (input.stripeCheckoutSessionId) {
    const existingBySession = await getWorkspaceBySessionId(
      input.stripeCheckoutSessionId
    );
    if (existingBySession) {
      return existingBySession;
    }
  }

  const existingByCustomer = await getWorkspaceByCustomerId(
    input.stripeCustomerId
  );
  const nowIso = new Date().toISOString();

  if (existingByCustomer) {
    const updated: WatchlistWorkspace = {
      ...existingByCustomer,
      email: input.email.trim().toLowerCase() || existingByCustomer.email,
      plan: input.plan,
      status: "active",
      maxItems: resolveMaxItemsForPlan(input.plan),
      stripeSubscriptionId:
        input.stripeSubscriptionId ?? existingByCustomer.stripeSubscriptionId,
      stripeCheckoutSessionId:
        input.stripeCheckoutSessionId ??
        existingByCustomer.stripeCheckoutSessionId,
      pilotExpiresAt: null,
      updatedAt: nowIso,
    };
    await saveWorkspaceRecord(updated);
    return updated;
  }

  const fallbackBrand =
    input.brandName?.trim() ||
    input.email.split("@")[1]?.split(".")[0] ||
    "OfferParity Workspace";

  const workspace: WatchlistWorkspace = {
    id: `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    managementToken: crypto.randomBytes(24).toString("hex"),
    email: input.email.trim().toLowerCase(),
    brandName: fallbackBrand,
    plan: input.plan,
    status: "active",
    maxItems: resolveMaxItemsForPlan(input.plan),
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    slackWebhookUrl: null,
    pilotExpiresAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await saveWorkspaceRecord(workspace);
  return workspace;
}

export async function updateWorkspaceSettings(
  token: string,
  patch: {
    brandName?: string;
    slackWebhookUrl?: string | null;
  }
): Promise<WatchlistWorkspace | null> {
  const existing = await getWorkspaceByToken(token);
  if (!existing) return null;

  const updated: WatchlistWorkspace = {
    ...existing,
    brandName: patch.brandName?.trim() || existing.brandName,
    slackWebhookUrl:
      patch.slackWebhookUrl !== undefined
        ? patch.slackWebhookUrl
        : existing.slackWebhookUrl,
    updatedAt: new Date().toISOString(),
  };

  await saveWorkspaceRecord(updated);
  return updated;
}

export async function updateWorkspaceSubscriptionState(
  stripeCustomerId: string,
  patch: {
    status: WatchlistStatus;
    plan?: "growth" | "agency";
    stripeSubscriptionId?: string | null;
  }
): Promise<WatchlistWorkspace | null> {
  const existing = await getWorkspaceByCustomerId(stripeCustomerId);
  if (!existing) return null;

  const nextPlan = patch.plan ?? existing.plan;
  const updated: WatchlistWorkspace = {
    ...existing,
    status: patch.status,
    plan: nextPlan,
    maxItems: resolveMaxItemsForPlan(nextPlan),
    stripeSubscriptionId:
      patch.stripeSubscriptionId !== undefined
        ? patch.stripeSubscriptionId
        : existing.stripeSubscriptionId,
    updatedAt: new Date().toISOString(),
  };

  await saveWorkspaceRecord(updated);
  return updated;
}

export async function addWatchlistItems(
  token: string,
  newItems: Array<{
    adName: string;
    adCopy: string;
    landingPageUrl: string;
    dailyBudget: number;
  }>
): Promise<{
  workspace: WatchlistWorkspace;
  items: WatchlistItem[];
  addedCount: number;
}> {
  const workspace = await getWorkspaceByToken(token);
  if (!workspace) {
    throw new Error("WORKSPACE_NOT_FOUND");
  }

  const existing = await getWorkspaceItems(workspace.id);
  const availableSlots = Math.max(0, workspace.maxItems - existing.length);
  if (availableSlots === 0) {
    throw new Error("WATCHLIST_LIMIT_REACHED");
  }

  const toAdd = newItems.slice(0, availableSlots);
  const nowIso = new Date().toISOString();

  const created: WatchlistItem[] = toAdd.map((item) => ({
    id: `wi_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    workspaceId: workspace.id,
    adName: item.adName.trim(),
    adCopy: item.adCopy.trim(),
    landingPageUrl: item.landingPageUrl.trim(),
    dailyBudget: item.dailyBudget,
    enabled: true,
    lastStatus: null,
    lastHttpStatus: null,
    lastDailyWaste: 0,
    lastFailureSummary: null,
    consecutiveFailures: 0,
    lastCheckedAt: null,
    lastAlertedAt: null,
    createdAt: nowIso,
  }));

  const merged = [...existing, ...created];
  await saveWorkspaceItems(workspace.id, merged);

  return {
    workspace,
    items: merged,
    addedCount: created.length,
  };
}

export async function removeWatchlistItem(
  token: string,
  itemId: string
): Promise<{ workspace: WatchlistWorkspace; items: WatchlistItem[] } | null> {
  const workspace = await getWorkspaceByToken(token);
  if (!workspace) return null;

  const existing = await getWorkspaceItems(workspace.id);
  const filtered = existing.filter((item) => item.id !== itemId);
  await saveWorkspaceItems(workspace.id, filtered);
  return { workspace, items: filtered };
}

export async function listActiveWorkspaces(): Promise<WatchlistWorkspace[]> {
  const nowMs = Date.now();
  const isEligible = (ws: WatchlistWorkspace): boolean => {
    if (ws.status !== "active") return false;
    if (ws.plan === "pilot" && ws.pilotExpiresAt) {
      const exp = Date.parse(ws.pilotExpiresAt);
      if (Number.isFinite(exp) && exp < nowMs) {
        return false;
      }
    }
    return true;
  };

  const redis = getRedisClient();
  if (!redis) {
    return Array.from(memoryStore.workspaces.values()).filter(isEligible);
  }

  const ids = await redis.smembers<string[]>(WORKSPACE_IDS_KEY);
  if (!ids || ids.length === 0) return [];

  const fetched = await Promise.all(ids.map((id) => getWorkspaceById(id)));
  return fetched.filter((ws): ws is WatchlistWorkspace => ws !== null && isEligible(ws));
}

export async function updateWatchlistItemStatus(
  workspaceId: string,
  itemId: string,
  update: {
    lastStatus: OverallVerdict;
    lastHttpStatus: number | null;
    lastDailyWaste: number;
    lastFailureSummary: string | null;
    consecutiveFailures: number;
    lastCheckedAt: string;
    lastAlertedAt?: string | null;
  }
): Promise<WatchlistItem | null> {
  const items = await getWorkspaceItems(workspaceId);
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;

  const current = items[idx]!;
  const next: WatchlistItem = {
    ...current,
    lastStatus: update.lastStatus,
    lastHttpStatus: update.lastHttpStatus,
    lastDailyWaste: update.lastDailyWaste,
    lastFailureSummary: update.lastFailureSummary,
    consecutiveFailures: update.consecutiveFailures,
    lastCheckedAt: update.lastCheckedAt,
    lastAlertedAt:
      update.lastAlertedAt !== undefined
        ? update.lastAlertedAt
        : current.lastAlertedAt,
  };
  items[idx] = next;
  await saveWorkspaceItems(workspaceId, items);
  return next;
}

export async function claimScheduleExecution(
  executionId: string
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    if (memoryStore.executions.has(executionId)) {
      return false;
    }
    memoryStore.executions.add(executionId);
    return true;
  }

  const result = await redis.set(`${EXEC_KEY_PREFIX}${executionId}`, "1", {
    nx: true,
    ex: EXECUTION_TTL_SECONDS,
  });
  return result === "OK";
}
