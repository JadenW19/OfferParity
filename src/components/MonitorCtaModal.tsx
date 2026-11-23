"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import type { LeadPlanInterest, OverallVerdict } from "@/lib/schemas";

export interface MonitorCtaContext {
  scannedUrl?: string;
  dailyBudget?: number;
  dailyWaste?: number;
  verdict?: OverallVerdict;
  totalRows?: number;
  sourceCta: string;
  defaultPlan?: LeadPlanInterest;
}

interface MonitorCtaModalProps {
  isOpen: boolean;
  context: MonitorCtaContext | null;
  onClose: () => void;
}

const GROWTH_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_GROWTH_LINK?.trim() || "";
const AGENCY_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_AGENCY_LINK?.trim() || "";

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function MonitorCtaModal({
  isOpen,
  context,
  onClose,
}: MonitorCtaModalProps) {
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [planInterest, setPlanInterest] = useState<LeadPlanInterest>(
    context?.defaultPlan ?? "growth"
  );
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen || !context) {
    return null;
  }

  const activeStripeLink =
    planInterest === "agency" ? AGENCY_STRIPE_LINK : GROWTH_STRIPE_LINK;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !context) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setServerError("Enter a valid work email address.");
      return;
    }

    setIsSubmitting(true);
    setServerError(null);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
          ...(context.scannedUrl ? { scannedUrl: context.scannedUrl } : {}),
          ...(typeof context.dailyBudget === "number"
            ? { dailyBudget: context.dailyBudget }
            : {}),
          ...(typeof context.dailyWaste === "number"
            ? { dailyWaste: context.dailyWaste }
            : {}),
          ...(context.verdict ? { verdict: context.verdict } : {}),
          planInterest,
          sourceCta: context.sourceCta,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const msg =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : `Request failed with HTTP ${response.status}`;
        setServerError(msg);
        return;
      }

      setSubmitted(true);
      trackEvent("lead_captured", {
        planInterest,
        sourceCta: context.sourceCta,
        verdict: context.verdict ?? null,
      });
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : "Network error while submitting monitoring request."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="monitor-cta-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close monitoring modal"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-surface-subtle)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="monitor-cta-title"
              className="text-lg font-bold text-[var(--text-primary)]"
            >
              Monitor Offers Hourly in Slack
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              Get alerted in Slack the moment a hero variant sells out, a promo
              code expires, or landing page pricing drifts from your ad copy.
            </p>
          </div>
        </div>

        {context.scannedUrl || typeof context.totalRows === "number" ? (
          <div className="mt-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
            {typeof context.totalRows === "number" ? (
              <p>
                <strong className="text-[var(--text-primary)]">
                  {context.totalRows} campaign ads
                </strong>{" "}
                queued ·{" "}
                <span className="font-mono text-[var(--status-fail-text)]">
                  {formatUsd(context.dailyWaste ?? 0)}/day detected waste
                </span>
              </p>
            ) : (
              <p className="truncate">
                <strong className="text-[var(--text-primary)]">Target:</strong>{" "}
                <span>{context.scannedUrl}</span>
                {typeof context.dailyWaste === "number" &&
                context.dailyWaste > 0 ? (
                  <span className="ml-2 font-mono font-semibold text-[var(--status-fail-text)]">
                    ({formatUsd(context.dailyWaste)}/day waste)
                  </span>
                ) : null}
              </p>
            )}
          </div>
        ) : null}

        {submitted ? (
          <div
            data-testid="monitor-cta-success"
            className="mt-5 space-y-4 rounded-xl border border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] p-4 text-xs text-[var(--text-primary)]"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-pass-text)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">
                  Monitoring request received for {email}
                </p>
                <p className="mt-1 text-[var(--text-muted)]">
                  We&apos;ll reach out shortly to connect your Slack channel and
                  import your Watchlist.
                </p>
              </div>
            </div>

            {activeStripeLink ? (
              <a
                href={activeStripeLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2.5 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)]"
              >
                <span>
                  Skip the wait — Activate{" "}
                  {planInterest === "agency" ? "Agency ($249/mo)" : "Growth ($99/mo)"}
                </span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={planInterest === "growth"}
                onClick={() => {
                  setPlanInterest("growth");
                  setServerError(null);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  planInterest === "growth"
                    ? "border-[var(--text-primary)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                <p className="text-xs font-bold">Growth · $99/mo</p>
                <p className="mt-0.5 text-[11px] opacity-80">
                  1 brand · 25 hourly URLs
                </p>
              </button>
              <button
                type="button"
                aria-pressed={planInterest === "agency"}
                onClick={() => {
                  setPlanInterest("agency");
                  setServerError(null);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  planInterest === "agency"
                    ? "border-[var(--text-primary)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                <p className="text-xs font-bold">Agency · $249/mo</p>
                <p className="mt-0.5 text-[11px] opacity-80">
                  10 brands · 250 hourly URLs
                </p>
              </button>
            </div>

            <div>
              <label
                htmlFor="monitor-lead-email"
                className="mb-1 block text-xs font-medium text-[var(--text-primary)]"
              >
                Work Email *
              </label>
              <input
                id="monitor-lead-email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setServerError(null);
                }}
                placeholder="you@brandoragency.com"
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="monitor-lead-company"
                className="mb-1 block text-xs font-medium text-[var(--text-primary)]"
              >
                Brand or Agency Name (optional)
              </label>
              <input
                id="monitor-lead-company"
                type="text"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setServerError(null);
                }}
                placeholder="e.g., Ridgewood Media / Lumina Goods"
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="monitor-lead-notes"
                className="mb-1 block text-xs font-medium text-[var(--text-primary)]"
              >
                Active Ad Count or Slack Channel Note (optional)
              </label>
              <input
                id="monitor-lead-notes"
                type="text"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setServerError(null);
                }}
                placeholder="e.g., 40 active Meta ads across 3 Shopify stores"
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
              />
            </div>

            {serverError ? (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--status-fail-text)]"
              >
                <AlertCircle
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{serverError}</span>
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href="/pricing"
                onClick={() => trackEvent("pricing_cta_clicked", { from: "modal" })}
                className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline"
              >
                Compare plans &amp; FAQ →
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2.5 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Requesting...
                  </>
                ) : (
                  <>
                    <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                    Request Hourly Slack Alerts
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
