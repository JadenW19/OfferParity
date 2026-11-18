"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  MessageSquareWarning,
  Send,
  Share2,
} from "lucide-react";
import { SLACK_WEBHOOK_PREFIX, type XRayReport } from "@/lib/schemas";

interface AlertExportPanelProps {
  report: XRayReport;
}

type CopyTarget = "slack" | "markdown" | "share" | null;
type PreviewTab = "slack" | "markdown";

export async function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}

export function triggerBlobDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function buildShareableXRayUrl(report: XRayReport): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const params = new URLSearchParams();
  params.set("url", report.request.landingPageUrl);
  params.set("ad", report.request.adCopy);
  params.set("budget", String(report.request.dailyBudget));
  if (report.request.fixtureId) {
    params.set("fixture", report.request.fixtureId);
  }
  return `${origin}/?${params.toString()}`;
}

export function AlertExportPanel({ report }: AlertExportPanelProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("slack");
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [showSlackWebhookBar, setShowSlackWebhookBar] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [isSendingWebhook, setIsSendingWebhook] = useState<boolean>(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function announceStatus(target: CopyTarget, message: string) {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setCopiedTarget(target);
    setStatusMessage(message);
    timerRef.current = setTimeout(() => {
      setCopiedTarget(null);
      setStatusMessage("");
    }, 3000);
  }

  async function handleCopySlack() {
    const ok = await copyTextWithFallback(report.slackAlert);
    announceStatus(
      ok ? "slack" : null,
      ok ? "Copied Slack alert to clipboard!" : "Unable to copy Slack alert to clipboard."
    );
  }

  async function handleCopyMarkdown() {
    const ok = await copyTextWithFallback(report.markdownReport);
    announceStatus(
      ok ? "markdown" : null,
      ok ? "Copied Markdown report to clipboard!" : "Unable to copy Markdown report to clipboard."
    );
  }

  async function handleCopyShareLink() {
    const link = buildShareableXRayUrl(report);
    const ok = await copyTextWithFallback(link);
    announceStatus(
      ok ? "share" : null,
      ok ? "Copied shareable X-Ray link to clipboard!" : "Unable to copy shareable link."
    );
  }

  function handleDownloadJson() {
    triggerBlobDownload(
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
      "offerparity-xray-report.json"
    );
    announceStatus(null, "Downloaded JSON report.");
  }

  function handleDownloadMarkdown() {
    triggerBlobDownload(
      report.markdownReport,
      "text/markdown;charset=utf-8",
      "offerparity-xray-report.md"
    );
    announceStatus(null, "Downloaded Markdown report.");
  }

  async function handleSendSlackWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSendingWebhook) return;

    const trimmedWebhook = webhookUrl.trim();
    if (trimmedWebhook && !trimmedWebhook.startsWith(SLACK_WEBHOOK_PREFIX)) {
      setWebhookError(`Slack webhook URL must start with ${SLACK_WEBHOOK_PREFIX}`);
      return;
    }

    setIsSendingWebhook(true);
    setWebhookError(null);

    try {
      const response = await fetch("/api/alerts/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: report.slackAlert,
          ...(trimmedWebhook ? { webhookUrl: trimmedWebhook } : {}),
        }),
      });
      const body = (await response.json()) as unknown;

      if (!response.ok) {
        const errMsg =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : `Slack webhook failed with HTTP ${response.status}`;
        setWebhookError(errMsg);
        return;
      }

      announceStatus(null, "Delivered burn-rate alert to Slack!");
    } catch (err) {
      setWebhookError(
        err instanceof Error ? err.message : "Network error while sending Slack webhook."
      );
    } finally {
      setIsSendingWebhook(false);
    }
  }

  return (
    <section
      aria-label="Slack alert preview and QA report exports"
      className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Slack Burn-Rate Alert &amp; QA Exports
          </h2>
          <p className="text-xs text-slate-400">
            Ready-to-paste media-buyer alert card, live Slack webhook delivery, and shareable QA
            permalinks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopySlack}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            {copiedTarget === "slack" ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Slack Alert
              </>
            )}
          </button>

          <button
            type="button"
            aria-expanded={showSlackWebhookBar}
            onClick={() => {
              setShowSlackWebhookBar((prev) => !prev);
              setWebhookError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Send to Slack Webhook
          </button>

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {copiedTarget === "share" ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Link Copied!
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Shareable Link
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {copiedTarget === "markdown" ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Markdown
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download JSON
          </button>

          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download Markdown
          </button>
        </div>
      </div>

      {showSlackWebhookBar ? (
        <form
          onSubmit={handleSendSlackWebhook}
          className="mt-3 rounded-xl border border-slate-800 bg-slate-950/90 p-3.5"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="slack-webhook-url" className="sr-only">
              Slack Incoming Webhook URL
            </label>
            <input
              id="slack-webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                setWebhookError(null);
              }}
              placeholder="Optional: https://hooks.slack.com/services/... (leave blank to use server SLACK_WEBHOOK_URL)"
              className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            />
            <button
              type="submit"
              disabled={isSendingWebhook}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isSendingWebhook ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Send Alert
                </>
              )}
            </button>
          </div>
          {webhookError ? (
            <p
              role="alert"
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-300"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
              <span>{webhookError}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-slate-400">
              Restricted strictly to verified <code>https://hooks.slack.com/services/...</code>{" "}
              endpoints.
            </p>
          )}
        </form>
      ) : null}

      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs font-medium text-emerald-300">
        {statusMessage}
      </p>

      <div className="mt-2 flex items-center gap-2 border-b border-slate-800 pb-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "slack"}
          onClick={() => setActiveTab("slack")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
            activeTab === "slack"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
          }`}
        >
          <MessageSquareWarning className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          Slack Burn-Rate Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "markdown"}
          onClick={() => setActiveTab("markdown")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
            activeTab === "markdown"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
          }`}
        >
          <FileCode2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          Markdown QA Preview
        </button>
      </div>

      <pre
        data-testid="export-preview-content"
        className="mt-3 max-h-80 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200"
      >
        {activeTab === "slack" ? report.slackAlert : report.markdownReport}
      </pre>
    </section>
  );
}
