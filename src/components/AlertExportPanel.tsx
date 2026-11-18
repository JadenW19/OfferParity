"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileCode2, MessageSquareWarning } from "lucide-react";
import type { XRayReport } from "@/lib/schemas";

interface AlertExportPanelProps {
  report: XRayReport;
}

type CopyTarget = "slack" | "markdown" | null;
type PreviewTab = "slack" | "markdown";

async function copyTextWithFallback(text: string): Promise<boolean> {
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

function triggerBlobDownload(content: string, mimeType: string, filename: string): void {
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

export function AlertExportPanel({ report }: AlertExportPanelProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("slack");
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
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
    }, 2500);
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
            Ready-to-paste media-buyer alert card and full client QA audit artifacts.
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
