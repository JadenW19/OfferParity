# OfferParity — Broken-Offer X-Ray

100% deterministic pre-flight and live ad-to-checkout parity verification for DTC performance marketing teams and agencies — zero LLM dependencies, zero API keys required.

OfferParity compares what a paid ad promises (price, currency, promo code, discount percentage, hero variant, and UTM tracking) against live storefront ground truth (Shopify `/products/<handle>.js` & `/discount/<code>?redirect=/products/<handle>`, `schema.org/Product` JSON-LD, HTML Microdata, OpenGraph metadata, or built-in offline fixtures), calculates bounded daily and 30-day wasted ad spend, and exports Slack Burn-Rate Alerts, shareable permalinks, and campaign CSV audits.

## Quick Start

```bash
pnpm install && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

For a production build:

```bash
pnpm install && pnpm build && pnpm start
```

## Key Features

- **Deterministic Ad Claim Extractor (`src/lib/parser/adClaimExtractor.ts`):** Extracts `advertisedPrice`, `compareAtPrice`, `currency`, `promoCode` (including `/discount/<code>` share links), `discountPct`, `variantId` (`?variant=<id>`), `variantName`, and `utmParams` with shipping-threshold filtering and signal provenance.
- **SSRF-Hardened Storefront Verifier (`src/lib/verifier/`):** Blocks private/loopback/metadata IPs across DNS and redirects, enforces an 8s total deadline and 2 MB response cap, resolves Shopify `.js` variant matrices, JSON-LD, Microdata, and OpenGraph fallbacks, detects WAF challenges (`WAF_CHALLENGE_MANUAL_CHECK`), and includes 3 offline demo fixtures (`healthy-offer`, `expired-promo`, `oos-price-mismatch`).
- **6-Point Parity Diff & Bounded Waste Estimator (`src/lib/diff/`):** Evaluates `http_health`, `price_parity`, `variant_stock` (exact Shopify `variantId` + token-normalized `variantName`), `promo_code`, `discount_math`, and `utm_hygiene`, computing bounded daily/30-day waste via survival-complement math.
- **Batch Campaign CSV Pre-Flight (`POST /api/xray/batch` & `src/components/BatchAuditPanel.tsx`):** Upload or paste up to 25 ad rows (`ad_name, ad_copy, landing_page_url, daily_budget`) for concurrent campaign pre-flight auditing with per-row error isolation, campaign Slack burn-rate digest, and audit CSV export.
- **Live Slack Incoming Webhook & Shareable Links (`POST /api/alerts/slack` & `src/components/AlertExportPanel.tsx`):** Deliver burn-rate alerts directly to verified `https://hooks.slack.com/services/...` webhooks, copy stateless `?url=&ad=&budget=` QA permalinks, or export JSON/Markdown reports.
- **Production Hardening:** Per-IP sliding-window API rate limiting (`src/lib/security/rateLimiter.ts`), security headers (`next.config.ts`), `GET /api/health` readiness probe, and GitHub Actions CI (`.github/workflows/ci.yml`).

## Optional Environment Configuration

OfferParity works out of the box with zero environment variables. Copy `.env.example` if you want server-side defaults:

- `SLACK_WEBHOOK_URL`: Optional default `https://hooks.slack.com/services/...` endpoint for 1-click Slack alert delivery without pasting a webhook URL in the UI.
- `RATE_LIMIT_RPM`: Optional per-IP single X-Ray requests-per-minute limit (default: `30`).

## Verification & Quality Gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
