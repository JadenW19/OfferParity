# OfferParity — Broken-Offer X-Ray (Product Brief)

## 1. Problem & Market Gap

Performance marketing teams and DTC e-commerce brands routinely burn paid ad budget sending clicks to broken landing pages—out-of-stock hero variants, expired promo codes, or price mismatches between the ad and checkout. Industry research (ShoppingIQ / The Drum, June 2025) reports 99% of retailers waste 5%–12% of retail media spend on out-of-stock clicks due to feed/site sync lags.

## 2. Target Customer & Business Model

- **Primary Buyer:** DTC Performance Marketing Agencies managing 5–20 e-commerce ad accounts (`$249/mo` Agency plan for up to 10 brands).
- **Secondary Buyer:** Mid-market DTC E-commerce Brands (`$99/mo` Growth plan).
- **Acquisition Hook:** Free instant **"Broken-Offer X-Ray"** diagnostic that proves live wasted spend in under 15 seconds.

## 3. MVP Scope (2.5-Hour Production Build)

A deterministic web app that compares what an ad promises against the live (or fixture) product/checkout state and produces an actionable parity report:

1. **Ad Claim Extractor (Deterministic Parser):**
   - User pastes ad copy/script + target landing page URL (or selects from 3 realistic pre-loaded demo scenarios: _Healthy Offer_, _Expired Promo Code_, _Out-of-Stock Variant & Price Mismatch_).
   - Pure-code parser extracts structured claims: `advertised_price`, `currency`, `promo_code`, `discount_pct`, `variant_name`, and `utm_params`.
2. **Storefront Parity Verifier (Server-Side Fetch + Safe Fallback):**
   - Server route fetches target URL metadata (Shopify `/products/<handle>.js` or `schema.org/Product` JSON-LD + HTTP status/redirect check) with timeouts and strict input validation.
   - Clean error handling for WAF/403 blocks (`WAF_CHALLENGE_MANUAL_CHECK` instead of false failure) and built-in deterministic store fixtures so demos work 100% offline/under firewall restrictions.
3. **Parity Diff Dashboard, Waste Estimator & Alert Preview:**
   - Computes exact field-by-field mismatches (`PASS` / `WARN` / `FAIL`), calculates estimated daily wasted ad spend from user-entered daily budget, and generates a copyable **Slack Burn-Rate Alert** card + exportable JSON/Markdown QA report.

## 4. Explicit Non-Goals (Out of Scope for MVP)

- No automated ad-pausing (avoids resetting ad platform learning phases and removes write-OAuth risk).
- No Meta/TikTok OAuth App Review integrations or live Shopify webhooks.
- No residential proxy fleets or heavy headless browser scraping.
- No user accounts/billing wall blocking the core X-Ray flow.

## 5. Production-Readiness & Test Plan ("Beyond Vibes")

- **Unit Tests:** 100% deterministic coverage on the Ad Claim Parser, Price/Stock/Promo Parity Diff Engine, Waste Calculator, and edge cases (malformed URLs, empty inputs, missing JSON-LD, WAF 403 responses).
- **Integration / Build Gates:** Type-check, production build, and API route validation tests passing with zero warnings or dead UI controls.
