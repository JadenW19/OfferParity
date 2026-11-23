"use client";

import { CheckCircle2, FileSearch, Store, XCircle } from "lucide-react";
import type { ExtractedAdClaims, StorefrontSnapshot } from "@/lib/schemas";

interface ClaimsComparisonCardProps {
  extractedClaims: ExtractedAdClaims;
  storefront: StorefrontSnapshot;
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null) return "Not detected";
  const code = currency ?? "USD";
  return `${code} ${amount.toFixed(2)}`;
}

export function ClaimsComparisonCard({
  extractedClaims,
  storefront,
}: ClaimsComparisonCardProps) {
  const utmEntries = Object.entries(extractedClaims.utmParams).filter(
    (entry): entry is [string, string] => entry[1] !== null && entry[1].trim() !== ""
  );

  return (
    <section
      aria-label="Ad claims versus storefront truth"
      className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Ad Claims vs. Storefront Ground Truth
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Side-by-side extraction provenance compared against verified storefront data and variant
          inventory.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: Extracted Ad Claims */}
        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-4">
          <div className="mb-3 flex items-center gap-2 border-b border-[var(--border-hairline)] pb-2.5">
            <FileSearch className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Extracted Ad Claims</h3>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div>
              <dt className="text-[var(--text-muted)]">Advertised Price</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                {formatPrice(extractedClaims.advertisedPrice, extractedClaims.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Anchor / Compare-At</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                {formatPrice(extractedClaims.compareAtPrice, extractedClaims.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Promo Code</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                {extractedClaims.promoCode ?? "None"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Discount Claim</dt>
              <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                {extractedClaims.discountPct !== null
                  ? `${extractedClaims.isUpToDiscount ? "Up to " : ""}${extractedClaims.discountPct}% OFF`
                  : "None"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[var(--text-muted)]">Hero Variant Claim</dt>
              <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                {extractedClaims.variantName && extractedClaims.variantId
                  ? `${extractedClaims.variantName} (Variant ID #${extractedClaims.variantId})`
                  : extractedClaims.variantName ??
                    (extractedClaims.variantId
                      ? `Variant ID #${extractedClaims.variantId}`
                      : "No specific variant claimed")}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[var(--text-muted)]">UTM &amp; Click IDs</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {utmEntries.length === 0 ? (
                  <span className="text-[var(--text-muted)]">No tracking parameters found</span>
                ) : (
                  utmEntries.map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
                    >
                      {key}={value}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Provenance Signals ({extractedClaims.signals.length})
            </h4>
            {extractedClaims.signals.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">No structured signals detected.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {extractedClaims.signals.map((signal, idx) => (
                  <li
                    key={`${signal.field}-${signal.source}-${idx}`}
                    className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-mono font-semibold text-[var(--text-primary)]">{signal.field}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {signal.source} · {signal.confidence} confidence
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[var(--text-muted)]" title={signal.rawMatch}>
                      Match: <code className="text-[var(--text-primary)]">{signal.rawMatch}</code>
                    </p>
                    {signal.note ? (
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{signal.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Storefront Ground Truth */}
        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-4">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-2.5">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Storefront Ground Truth</h3>
            </div>
            <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
              {storefront.source}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div className="col-span-2">
              <dt className="text-[var(--text-muted)]">Product Title</dt>
              <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                {storefront.title ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Live Base Price</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                {formatPrice(storefront.basePrice, storefront.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Live Compare-At</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                {formatPrice(storefront.compareAtPrice, storefront.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Product Stock</dt>
              <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                {storefront.inStock === null
                  ? "Unknown"
                  : storefront.inStock
                    ? "In Stock"
                    : "Out of Stock"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">HTTP &amp; Redirects</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                HTTP {storefront.httpStatus} ({storefront.redirectChain.length} hops)
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[var(--text-muted)]">Promo Verification</dt>
              <dd className="mt-0.5 text-[var(--text-primary)]">
                {storefront.promoVerification ? (
                  <span>
                    <span className="font-mono font-semibold">
                      {storefront.promoVerification.code ?? "PROMO"}
                    </span>{" "}
                    —{" "}
                    <span className="font-semibold">{storefront.promoVerification.state}</span>:{" "}
                    {storefront.promoVerification.detail}
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">No promo code evaluated</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Variant Inventory Matrix ({storefront.variants.length})
            </h4>
            {storefront.variants.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                No variant-level inventory matrix exposed by storefront metadata.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border-hairline)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--bg-surface)] text-[11px] uppercase text-[var(--text-muted)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Variant</th>
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {storefront.variants.map((variant) => (
                      <tr key={variant.id} className="bg-[var(--bg-surface)]">
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{variant.title}</td>
                        <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                          {variant.sku ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-primary)]">
                          {formatPrice(variant.price, storefront.currency)}
                        </td>
                        <td className="px-3 py-2">
                          {variant.available ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              Available
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              <XCircle className="h-3 w-3" aria-hidden="true" />
                              Out of Stock
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
