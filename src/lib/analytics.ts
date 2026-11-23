"use client";

export type OfferParityAnalyticsEvent =
  | "xray_completed"
  | "batch_audit_completed"
  | "share_link_copied"
  | "slack_webhook_sent"
  | "monitor_cta_opened"
  | "lead_captured"
  | "pricing_cta_clicked";

interface PostHogLike {
  capture: (event: string, properties?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    posthog?: PostHogLike;
  }
}

/**
 * Fires a lightweight client-side funnel event when PostHog is loaded on window.
 * Safely no-ops during SSR, unit tests, and zero-env local development.
 */
export function trackEvent(
  event: OfferParityAnalyticsEvent,
  properties?: Record<string, string | number | boolean | null | undefined>
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(event, properties);
    }
  } catch (err) {
    console.warn(
      "[OfferParity] Analytics tracking failed:",
      err instanceof Error ? err.message : "unknown error"
    );
  }
}
