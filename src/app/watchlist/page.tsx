"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { PublicWatchlistWorkspace } from "@/lib/storage/watchlistStore";

interface RunNowSummary {
  checkedCount: number;
  failCount: number;
  warnCount: number;
  passCount: number;
  regressionCount: number;
  recoveryCount: number;
  slackAlertSent: boolean;
  totalDailyWaste: number;
}

export default function WatchlistPage() {
  const [token, setToken] = useState<string>("");
  const [workspace, setWorkspace] = useState<PublicWatchlistWorkspace | null>(
    null
  );
  const [persistentStore, setPersistentStore] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Pilot workspace creation
  const [pilotEmail, setPilotEmail] = useState("");
  const [pilotBrand, setPilotBrand] = useState("");
  const [pilotWebhook, setPilotWebhook] = useState("");

  // Settings
  const [slackWebhookInput, setSlackWebhookInput] = useState("");

  // Add single URL
  const [adName, setAdName] = useState("");
  const [adCopy, setAdCopy] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [dailyBudget, setDailyBudget] = useState("500");

  // CSV bulk import
  const [csvText, setCsvText] = useState("");
  const [showCsvImport, setShowCsvImport] = useState(false);

  // Run now summary + link copy
  const [lastRunSummary, setLastRunSummary] = useState<RunNowSummary | null>(
    null
  );
  const [copiedLink, setCopiedLink] = useState(false);

  const loadWorkspace = useCallback(async (targetToken: string) => {
    const trimmed = targetToken.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/watchlist?token=${encodeURIComponent(trimmed)}`
      );
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        persistentStore?: boolean;
        error?: string;
      };
      if (!res.ok || !data.workspace) {
        setErrorMsg(data.error ?? "Unable to load watchlist workspace.");
        return;
      }
      setWorkspace(data.workspace);
      setToken(trimmed);
      if (typeof data.persistentStore === "boolean") {
        setPersistentStore(data.persistentStore);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to load workspace."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token")?.trim();
      if (urlToken) {
        void loadWorkspace(urlToken);
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [loadWorkspace]);

  async function handleCreatePilot(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_pilot",
          email: pilotEmail,
          brandName: pilotBrand,
          ...(pilotWebhook.trim()
            ? { slackWebhookUrl: pilotWebhook.trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        managementToken?: string;
        workspace?: PublicWatchlistWorkspace;
        persistentStore?: boolean;
        error?: string;
      };
      if (!res.ok || !data.workspace || !data.managementToken) {
        setErrorMsg(data.error ?? "Could not create pilot workspace.");
        return;
      }
      setWorkspace(data.workspace);
      setToken(data.managementToken);
      if (typeof data.persistentStore === "boolean") {
        setPersistentStore(data.persistentStore);
      }
      window.history.replaceState(
        null,
        "",
        `/watchlist?token=${encodeURIComponent(data.managementToken)}`
      );
      setNoticeMsg(
        "7-day pilot watchlist created. Bookmark this URL to return anytime."
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to create workspace."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveSlackWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          token,
          slackWebhookUrl: slackWebhookInput.trim(),
        }),
      });
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        error?: string;
      };
      if (!res.ok || !data.workspace) {
        setErrorMsg(data.error ?? "Failed to update Slack webhook.");
        return;
      }
      setWorkspace(data.workspace);
      setSlackWebhookInput("");
      setNoticeMsg("Slack Incoming Webhook updated.");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to update webhook."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddSingleItem(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_items",
          token,
          items: [
            {
              adName: adName.trim(),
              adCopy: adCopy.trim(),
              landingPageUrl: landingPageUrl.trim(),
              dailyBudget: Number(dailyBudget) || 0,
            },
          ],
        }),
      });
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        addedCount?: number;
        error?: string;
      };
      if (!res.ok || !data.workspace) {
        setErrorMsg(data.error ?? "Could not add URL to watchlist.");
        return;
      }
      setWorkspace(data.workspace);
      setAdName("");
      setAdCopy("");
      setLandingPageUrl("");
      setNoticeMsg(`Added ${data.addedCount ?? 1} ad to hourly watchlist.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleImportCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_csv",
          token,
          csvText,
        }),
      });
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        addedCount?: number;
        error?: string;
      };
      if (!res.ok || !data.workspace) {
        setErrorMsg(data.error ?? "CSV import failed.");
        return;
      }
      setWorkspace(data.workspace);
      setCsvText("");
      setShowCsvImport(false);
      setNoticeMsg(
        `Imported ${data.addedCount ?? 0} ads into your hourly watchlist.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "CSV import failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemoveItem(itemId: string) {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_item", token, itemId }),
      });
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        error?: string;
      };
      if (res.ok && data.workspace) {
        setWorkspace(data.workspace);
      } else {
        setErrorMsg(data.error ?? "Failed to remove item.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to remove item."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRunNow() {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_now",
          token,
          sendSlackAlerts: true,
        }),
      });
      const data = (await res.json()) as {
        workspace?: PublicWatchlistWorkspace;
        summary?: RunNowSummary;
        error?: string;
      };
      if (!res.ok || !data.workspace) {
        setErrorMsg(data.error ?? "Watchlist scan failed.");
        return;
      }
      setWorkspace(data.workspace);
      setLastRunSummary(data.summary ?? null);
      setNoticeMsg(
        `Checked ${data.summary?.checkedCount ?? 0} URLs · ${data.summary?.failCount ?? 0} confirmed breaks.${data.summary?.slackAlertSent ? " Slack regression alert sent." : ""}`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Watchlist scan failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenPortal() {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceToken: token }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setErrorMsg(data.error ?? "Unable to open Stripe Billing Portal.");
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Billing portal request failed."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleCopyWorkspaceLink() {
    if (!token) return;
    const shareUrl = `${window.location.origin}/watchlist?token=${encodeURIComponent(token)}`;
    void navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 px-4 py-2 backdrop-blur">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-ink)]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
              OfferParity
            </span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-3 text-xs font-semibold"
          >
            <Link
              href="/"
              className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            >
              Free X-Ray
            </Link>
            <Link
              href="/watchlist"
              className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent-soft-text)]"
            >
              Watchlist
            </Link>
            <Link
              href="/bot"
              className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            >
              Bot Allowlist
            </Link>
            <Link
              href="/pricing"
              className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            >
              Pricing
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <section className="space-y-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-soft-text)]">
            Automated Hourly Regression Monitor
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Watchlist &amp; Slack Alert Workspace
          </h1>
          <p className="max-w-2xl text-sm text-[var(--text-muted)]">
            Every active URL in your watchlist is checked deterministically
            every hour. Slack only pings when an offer transitions into a
            confirmed break (or recovers)—zero alert fatigue.
          </p>
        </section>

        {!persistentStore ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-4 py-3 text-xs text-[var(--status-warn-text)]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Running in ephemeral in-memory mode (no{" "}
              <code>UPSTASH_REDIS_REST_URL</code> configured). Connect Upstash
              Redis on Vercel to persist watchlists across hourly cron runs.
            </span>
          </div>
        ) : null}

        {errorMsg ? (
          <div
            role="alert"
            className="rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] px-4 py-3 text-xs font-medium text-[var(--status-fail-text)]"
          >
            {errorMsg}
          </div>
        ) : null}

        {noticeMsg ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] px-4 py-3 text-xs font-medium text-[var(--status-pass-text)]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        ) : null}

        {!workspace ? (
          <div className="grid gap-6 md:grid-cols-2">
            <form
              onSubmit={handleCreatePilot}
              className="space-y-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6"
            >
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Start Free 7-Day Pilot Watchlist
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Monitor up to 25 active ad URLs hourly with Slack regression
                  alerts—no credit card required.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="pilot-brand"
                    className="block text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Brand or Agency Name
                  </label>
                  <input
                    id="pilot-brand"
                    type="text"
                    required
                    value={pilotBrand}
                    onChange={(e) => {
                      setPilotBrand(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder="e.g. TALA / Nest Commerce"
                    className="mt-1 w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pilot-email"
                    className="block text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Work Email
                  </label>
                  <input
                    id="pilot-email"
                    type="email"
                    required
                    value={pilotEmail}
                    onChange={(e) => {
                      setPilotEmail(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder="growth@brand.com"
                    className="mt-1 w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pilot-webhook"
                    className="block text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Slack Incoming Webhook URL (optional)
                  </label>
                  <input
                    id="pilot-webhook"
                    type="url"
                    value={pilotWebhook}
                    onChange={(e) => {
                      setPilotWebhook(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder="https://hooks.slack.com/services/..."
                    className="mt-1 w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                <span>Create 7-Day Pilot Workspace</span>
              </button>
            </form>

            <div className="space-y-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Open Existing Workspace
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Paste your private workspace token from checkout or onboarding.
                </p>
              </div>
              <div className="space-y-3">
                <label
                  htmlFor="existing-token"
                  className="block text-xs font-semibold text-[var(--text-primary)]"
                >
                  Workspace Token
                </label>
                <input
                  id="existing-token"
                  type="text"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder="Paste workspace token..."
                  className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  disabled={isLoading || !token.trim()}
                  onClick={() => void loadWorkspace(token)}
                  className="inline-flex w-full items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  Load Workspace
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Workspace Header */}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">
                    {workspace.brandName}
                  </h2>
                  <span className="rounded-full border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-[var(--accent-soft-text)]">
                    {workspace.plan} · {workspace.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {workspace.email} · {workspace.items.length} /{" "}
                  {workspace.maxItems} monitored URLs
                  {workspace.pilotExpiresAt
                    ? ` · Pilot ends ${new Date(workspace.pilotExpiresAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyWorkspaceLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  {copiedLink ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{copiedLink ? "Copied Link" : "Copy Workspace Link"}</span>
                </button>

                {workspace.hasStripeCustomer ? (
                  <button
                    type="button"
                    onClick={handleOpenPortal}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  >
                    <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Manage Billing</span>
                  </button>
                ) : (
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  >
                    <span>Upgrade Plan</span>
                  </Link>
                )}

                <button
                  type="button"
                  onClick={handleRunNow}
                  disabled={isLoading || workspace.items.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-4 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>Run Audit Now</span>
                </button>
              </div>
            </section>

            {/* Slack Alert Settings */}
            <form
              onSubmit={handleSaveSlackWebhook}
              className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5"
            >
              <div className="min-w-[260px] flex-1">
                <label
                  htmlFor="slack-webhook"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"
                >
                  <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Slack Incoming Webhook{" "}
                    {workspace.slackWebhookConfigured
                      ? `(Active: ${workspace.slackWebhookMasked})`
                      : "(Not set)"}
                  </span>
                </label>
                <input
                  id="slack-webhook"
                  type="url"
                  value={slackWebhookInput}
                  onChange={(e) => {
                    setSlackWebhookInput(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                Save Webhook
              </button>
            </form>

            {/* Add URL or CSV */}
            <section className="space-y-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Add Active Ads to Watchlist
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCsvImport((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-soft-text)] hover:underline"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {showCsvImport ? "Single Ad Form" : "Bulk Import CSV"}
                  </span>
                </button>
              </div>

              {showCsvImport ? (
                <form onSubmit={handleImportCsv} className="space-y-3">
                  <textarea
                    rows={5}
                    required
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={`ad_name,ad_copy,landing_page_url,daily_budget\n"TALA Puffer","Loved by 20,000+ people","https://www.wearetala.com/products/storm-puffer-jacket-americano-1",500`}
                    className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] p-3 font-mono text-xs text-[var(--text-primary)]"
                  />
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)]"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import CSV Rows</span>
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleAddSingleItem}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <input
                    type="text"
                    required
                    value={adName}
                    onChange={(e) => setAdName(e.target.value)}
                    placeholder="Ad Name (e.g. Storm Puffer - UK)"
                    className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                  <input
                    type="number"
                    min={0}
                    required
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    placeholder="Daily Budget ($)"
                    className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                  <input
                    type="url"
                    required
                    value={landingPageUrl}
                    onChange={(e) => setLandingPageUrl(e.target.value)}
                    placeholder="https://store.com/products/..."
                    className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] sm:col-span-2"
                  />
                  <textarea
                    rows={2}
                    required
                    value={adCopy}
                    onChange={(e) => setAdCopy(e.target.value)}
                    placeholder="Exact ad copy ($ price, promo code, % off, or hero variant)..."
                    className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-input)] p-3 text-xs text-[var(--text-primary)] sm:col-span-2"
                  />
                  <div>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add to Hourly Monitor</span>
                    </button>
                  </div>
                </form>
              )}
            </section>

            {lastRunSummary ? (
              <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-3 text-xs text-[var(--text-muted)]">
                Last manual run: <strong className="text-[var(--text-primary)]">{lastRunSummary.checkedCount}</strong> checked ·{" "}
                <strong className="text-[var(--status-fail-text)]">{lastRunSummary.failCount} FAIL</strong> ·{" "}
                <strong className="text-[var(--status-warn-text)]">{lastRunSummary.warnCount} WARN</strong> ·{" "}
                <strong className="text-[var(--status-pass-text)]">{lastRunSummary.passCount} PASS</strong> · Total waste:{" "}
                <strong className="text-[var(--text-primary)]">${lastRunSummary.totalDailyWaste.toFixed(2)}/day</strong>
              </div>
            ) : null}

            {/* Monitored Items Table */}
            <section className="overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
              <div className="border-b border-[var(--border-hairline)] px-5 py-3">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Monitored Ads ({workspace.items.length})
                </h3>
              </div>
              {workspace.items.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-[var(--text-muted)]">
                  No ads added yet. Add your first URL above or bulk-import a
                  Campaign CSV.
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-hairline)]">
                  {workspace.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs"
                    >
                      <div className="min-w-[220px] flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {item.adName}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">
                            ${item.dailyBudget}/day
                          </span>
                          {item.lastStatus ? (
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                item.lastStatus === "FAIL"
                                  ? "bg-[var(--status-fail-bg)] text-[var(--status-fail-text)]"
                                  : item.lastStatus === "PASS"
                                    ? "bg-[var(--status-pass-bg)] text-[var(--status-pass-text)]"
                                    : "bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]"
                              }`}
                            >
                              {item.lastStatus}
                            </span>
                          ) : (
                            <span className="rounded-full bg-[var(--bg-surface-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                              PENDING
                            </span>
                          )}
                        </div>
                        <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                          {item.landingPageUrl}
                        </p>
                        {item.lastFailureSummary ? (
                          <p className="text-[11px] text-[var(--status-fail-text)]">
                            {item.lastFailureSummary}
                          </p>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleRemoveItem(item.id)}
                        aria-label={`Remove ${item.adName}`}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-subtle)] hover:text-[var(--status-fail-text)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
