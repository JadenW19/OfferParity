"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { AlertCircle, CheckCircle2, Loader2, Lock, X } from "lucide-react";
import { BILLING_PLANS } from "@/lib/billing/plans";
import type { LeadPlanInterest } from "@/lib/schemas";

interface EmbeddedCheckoutModalProps {
  plan: LeadPlanInterest | null;
  onClose: () => void;
}

const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || "";

let cachedStripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  if (!PUBLISHABLE_KEY) return null;
  if (!cachedStripePromise) {
    cachedStripePromise = loadStripe(PUBLISHABLE_KEY);
  }
  return cachedStripePromise;
}

function readActiveColorScheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]'
  );
  return meta?.content === "light" ? "light" : "dark";
}

function buildStripeAppearance(scheme: "dark" | "light"): Appearance {
  if (scheme === "light") {
    return {
      theme: "flat",
      variables: {
        colorPrimary: "#1a1a18",
        colorBackground: "#f2f1ed",
        colorText: "#1a1a18",
        colorTextSecondary: "#6e6e69",
        colorDanger: "#be123c",
        fontFamily: "Instrument Sans, system-ui, sans-serif",
        borderRadius: "10px",
        spacingUnit: "4px",
      },
      rules: {
        ".Input": {
          border: "1px solid #e2e0d8",
          backgroundColor: "#ffffff",
          boxShadow: "none",
        },
        ".Input:focus": {
          border: "1px solid #1a1a18",
          boxShadow: "none",
        },
      },
    };
  }

  return {
    theme: "night",
    variables: {
      colorPrimary: "#d8ff8f",
      colorBackground: "#262625",
      colorText: "#f1eee7",
      colorTextSecondary: "#a8a8a2",
      colorDanger: "#fda4af",
      fontFamily: "Instrument Sans, system-ui, sans-serif",
      borderRadius: "10px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": {
        border: "1px solid #3d3d3b",
        backgroundColor: "#222221",
        boxShadow: "none",
      },
      ".Input:focus": {
        border: "1px solid #d8ff8f",
        boxShadow: "none",
      },
    },
  };
}

function CheckoutInnerForm({ planId }: { planId: LeadPlanInterest }) {
  const result = useCheckoutElements();
  const plan = BILLING_PLANS[planId];
  const [email, setEmail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  if (result.type === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading secure checkout...</span>
      </div>
    );
  }

  if (result.type === "error") {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] p-3.5 text-xs text-[var(--status-fail-text)]"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{result.error.message}</span>
      </div>
    );
  }

  const { checkout } = result;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isConfirming) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setSubmitError("Enter a valid billing email address.");
      return;
    }

    setIsConfirming(true);
    setSubmitError(null);

    try {
      const emailRes = await checkout.updateEmail(trimmedEmail);
      if (emailRes.type === "error") {
        setSubmitError(emailRes.error.message);
        return;
      }

      const confirmRes = await checkout.confirm();
      if (confirmRes.type === "error") {
        setSubmitError(confirmRes.error.message);
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Payment confirmation failed."
      );
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="checkout-billing-email"
          className="mb-1.5 block text-xs font-medium text-[var(--text-primary)]"
        >
          Billing Email *
        </label>
        <input
          id="checkout-billing-email"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSubmitError(null);
          }}
          placeholder="billing@brandoragency.com"
          className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
        />
      </div>

      <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3">
        <PaymentElement />
      </div>

      {submitError ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--status-fail-text)]"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{submitError}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isConfirming}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isConfirming ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Confirming Subscription...
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              Subscribe to {plan.name} — ${plan.priceUsd}
              {plan.intervalLabel}
            </span>
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-[var(--text-muted)]">
        Powered by Stripe · Cancel anytime · Promo codes &amp; VAT/Tax ID
        supported
      </p>
    </form>
  );
}

export function EmbeddedCheckoutModal({
  plan,
  onClose,
}: EmbeddedCheckoutModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const scheme = readActiveColorScheme();
  const appearance = useMemo(() => buildStripeAppearance(scheme), [scheme]);
  const stripePromise = useMemo(() => getStripePromise(), []);

  useEffect(() => {
    if (!plan) {
      return;
    }

    let cancelled = false;

    fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    })
      .then(async (res) => {
        const body = (await res.json()) as {
          clientSecret?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.clientSecret) {
          setSessionError(
            body.error ?? `Checkout initialization failed (HTTP ${res.status}).`
          );
          return;
        }
        setClientSecret(body.clientSecret);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSessionError(
          err instanceof Error
            ? err.message
            : "Network error initializing checkout."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [plan]);

  if (!plan) {
    return null;
  }

  const isLoadingSession = !clientSecret && !sessionError;
  const planInfo = BILLING_PLANS[plan];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="embedded-checkout-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="relative my-8 w-full max-w-lg rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close checkout modal"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-surface-subtle)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="mb-4 border-b border-[var(--border-hairline)] pb-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-soft-text)]">
            On-Site Checkout
          </p>
          <h2
            id="embedded-checkout-title"
            className="mt-1 text-lg font-bold text-[var(--text-primary)]"
          >
            {planInfo.name} — ${planInfo.priceUsd}
            <span className="text-sm font-normal text-[var(--text-muted)]">
              {planInfo.intervalLabel}
            </span>
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-[var(--status-pass-text)]"
              aria-hidden="true"
            />
            <span>{planInfo.summary}</span>
          </p>
        </div>

        {isLoadingSession ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Initializing Stripe Checkout...</span>
          </div>
        ) : sessionError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] p-3.5 text-xs text-[var(--status-fail-text)]"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>{sessionError}</span>
          </div>
        ) : clientSecret && stripePromise ? (
          <CheckoutElementsProvider
            stripe={stripePromise}
            options={{
              clientSecret,
              elementsOptions: { appearance },
            }}
          >
            <CheckoutInnerForm planId={plan} />
          </CheckoutElementsProvider>
        ) : null}
      </div>
    </div>
  );
}
