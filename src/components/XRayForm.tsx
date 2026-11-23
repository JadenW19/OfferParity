"use client";

import type { FormEvent } from "react";
import { Loader2, Play, AlertCircle, DollarSign, Link2, FileText } from "lucide-react";
import { XRayRequestSchema, type FixtureScenarioId } from "@/lib/schemas";

const QUICK_BUDGET_PRESETS = [250, 500, 1200, 5000] as const;

interface XRayFormProps {
  adCopy: string;
  landingPageUrl: string;
  dailyBudget: string;
  activeFixtureId: FixtureScenarioId | null;
  isLoading: boolean;
  serverError: string | null;
  onAdCopyChange: (value: string) => void;
  onLandingPageUrlChange: (value: string) => void;
  onDailyBudgetChange: (value: string) => void;
  onSubmit: () => void;
}

interface FieldErrors {
  adCopy?: string;
  landingPageUrl?: string;
  dailyBudget?: string;
}

function validateFields(adCopy: string, landingPageUrl: string, dailyBudget: string): FieldErrors {
  const numericBudget = dailyBudget.trim() === "" ? Number.NaN : Number(dailyBudget);
  const result = XRayRequestSchema.safeParse({
    adCopy,
    landingPageUrl,
    dailyBudget: numericBudget,
  });

  if (result.success) {
    return {};
  }

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === "adCopy" && !errors.adCopy) {
      errors.adCopy = issue.message;
    } else if (field === "landingPageUrl" && !errors.landingPageUrl) {
      errors.landingPageUrl = issue.message;
    } else if (field === "dailyBudget" && !errors.dailyBudget) {
      errors.dailyBudget =
        dailyBudget.trim() === "" || Number.isNaN(numericBudget)
          ? "Enter a valid daily budget amount"
          : issue.message;
    }
  }
  return errors;
}

export function XRayForm({
  adCopy,
  landingPageUrl,
  dailyBudget,
  activeFixtureId,
  isLoading,
  serverError,
  onAdCopyChange,
  onLandingPageUrlChange,
  onDailyBudgetChange,
  onSubmit,
}: XRayFormProps) {
  const fieldErrors = validateFields(adCopy, landingPageUrl, dailyBudget);
  const hasValidationErrors =
    Boolean(fieldErrors.adCopy) ||
    Boolean(fieldErrors.landingPageUrl) ||
    Boolean(fieldErrors.dailyBudget);
  const numericBudget = Number(dailyBudget);

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasValidationErrors || isLoading) {
      return;
    }
    onSubmit();
  }

  return (
    <section
      aria-label="OfferParity X-Ray inputs"
      className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Ad &amp; Landing Page Inspector
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Paste live ad copy and a product URL, or pick a scenario above.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1 font-mono text-[11px] font-medium text-[var(--text-muted)]">
          {activeFixtureId ? `Fixture: ${activeFixtureId}` : "Live Storefront Fetch"}
        </span>
      </div>

      <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label
              htmlFor="xray-ad-copy"
              className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Ad Copy / Script
            </label>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {adCopy.trim().length} / 5,000
            </span>
          </div>
          <textarea
            id="xray-ad-copy"
            name="adCopy"
            rows={3}
            value={adCopy}
            onChange={(e) => onAdCopyChange(e.target.value)}
            aria-invalid={Boolean(fieldErrors.adCopy)}
            aria-describedby={fieldErrors.adCopy ? "xray-ad-copy-error" : undefined}
            placeholder="e.g. Ultralight warmth for cold-weather miles. Kova Merino Trail Hoodie in Alpine Olive (Size L) — just $68.00 today."
            className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
          />
          {fieldErrors.adCopy ? (
            <p id="xray-ad-copy-error" role="alert" className="mt-1 text-xs font-medium text-rose-600">
              {fieldErrors.adCopy}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <label
              htmlFor="xray-landing-url"
              className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Landing Page URL
            </label>
            <input
              id="xray-landing-url"
              name="landingPageUrl"
              type="url"
              value={landingPageUrl}
              onChange={(e) => onLandingPageUrlChange(e.target.value)}
              aria-invalid={Boolean(fieldErrors.landingPageUrl)}
              aria-describedby={fieldErrors.landingPageUrl ? "xray-landing-url-error" : undefined}
              placeholder="https://store.example.com/products/hero-item?utm_source=meta&utm_medium=paid_social&utm_campaign=launch"
              className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2.5 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
            />
            {fieldErrors.landingPageUrl ? (
              <p id="xray-landing-url-error" role="alert" className="mt-1 text-xs font-medium text-rose-600">
                {fieldErrors.landingPageUrl}
              </p>
            ) : null}
          </div>

          <div className="lg:col-span-5">
            <label
              htmlFor="xray-daily-budget"
              className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
              Daily Ad Budget (USD)
            </label>
            <input
              id="xray-daily-budget"
              name="dailyBudget"
              type="number"
              min={0}
              max={1000000}
              step="any"
              value={dailyBudget}
              onChange={(e) => onDailyBudgetChange(e.target.value)}
              aria-invalid={Boolean(fieldErrors.dailyBudget)}
              aria-describedby={fieldErrors.dailyBudget ? "xray-daily-budget-error" : undefined}
              className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2.5 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Quick-select daily budgets">
              {QUICK_BUDGET_PRESETS.map((amount) => {
                const isSelected = Number.isFinite(numericBudget) && numericBudget === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onDailyBudgetChange(String(amount))}
                    className={`rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition ${
                      isSelected
                        ? "border-[var(--text-primary)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    ${amount.toLocaleString("en-US")}
                  </button>
                );
              })}
            </div>
            {fieldErrors.dailyBudget ? (
              <p id="xray-daily-budget-error" role="alert" className="mt-1 text-xs font-medium text-rose-600">
                {fieldErrors.dailyBudget}
              </p>
            ) : null}
          </div>
        </div>

        {serverError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-600"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] pt-4">
          <p className="text-xs text-[var(--text-muted)]">
            100% deterministic audit · SSRF-protected · 8s timeout
          </p>
          <button
            type="submit"
            disabled={isLoading || hasValidationErrors}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-6 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Running X-Ray...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run X-Ray
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
