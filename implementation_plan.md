OfferParity — Broken-Offer X-Ray Implementation Plan
Goal Description

Build OfferParity ("Broken-Offer X-Ray") from brief.md as a deterministic, production-ready Next.js + TypeScript web application. Performance marketers and DTC brands can paste ad copy + a landing page URL (or click one of 3 pre-loaded realistic scenarios) to detect price mismatches, out-of-stock hero variants, expired promo codes, discount math exaggerations, and broken tracking parameters in under 15 seconds—complete with a daily wasted ad spend calculator, copyable Slack Burn-Rate Alert, and exportable JSON/Markdown QA reports.

User Review Required

IMPORTANT

Tech Stack & Runtime Selection The workspace currently contains only brief.md on Node v22.22.1 with pnpm 12.21.0. This plan scaffolds a Next.js (App Router) + TypeScript (strict: true) + Tailwind CSS + Zod + Cheerio + Vitest project in /home/hacksday/projects/my-app. Zero external databases, OAuth walls, or headless browsers are required.

NOTE

Honest Promo-Code Verification on Live External URLs ("Beyond Vibes") Unauthenticated HTTP fetches to live third-party Shopify/DTC product pages (/products/<handle>.js or schema.org/Product JSON-LD) expose live product/variant prices and inventory, whereas checkout-only promo codes live behind cart mutations.

Built-in Demo Fixtures: Deterministic promo registry evaluates exact promo states (ACTIVE, EXPIRED, MIN_SPEND_UNMET) producing definitive PASS / FAIL verdicts.
Live External Storefronts: The verifier checks on-page promo banners/meta text (PAGE_BANNER_MATCH -> PASS). When a code is checkout-only and cannot be proven without mutating a live cart, the engine emits WARN (UNVERIFIED_LIVE_STORE) rather than fabricating a false PASS or false FAIL.
Open Questions

TIP

Defaults Ready for Immediate Execution No blocking ambiguities were found in brief.md. Confirm if you want to adjust either of these defaults before implementation begins:

Waste Estimation Model: We use a bounded survival-complement formula (1 - Π(1 - w_i)) across FAIL checks so compounding errors (e.g., OOS hero variant + price hike) never exceed 100% of daily budget, while WARN checks report separately as At-Risk Spend so warnings never inflate hard wasted spend.
Pricing Tier Visibility: Because Section 4 specifies "No user accounts/billing wall blocking the core X-Ray flow" and Section 5 requires "zero dead UI controls", the core X-Ray tool runs immediately at / with zero auth gates, and every UI button performs a real client/server action (no dead "Sign Up" or placeholder links).
System Architecture
Proposed Changes
1. Project Foundation & Tooling

Initialize Next.js with strict TypeScript, Tailwind CSS, Zod, Cheerio, Lucide icons, and Vitest + React Testing Library.

[NEW] package.json
Runtime dependencies: next, react, react-dom, zod, cheerio, lucide-react.
Dev dependencies: typescript, @types/node, @types/react, @types/react-dom, tailwindcss, @tailwindcss/postcss, postcss, eslint, eslint-config-next, vitest, @vitejs/plugin-react, @testing-library/react, @testing-library/jest-dom, jsdom.
Scripts: dev, build, start, typecheck (tsc --noEmit), lint, test (vitest run), test:coverage.
[NEW] tsconfig.json
Enforces "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true, and @/* path alias mapped to ./src/*.
[NEW] vitest.config.ts
Configures path aliases (@/*), jsdom + node test environments, and deterministic test execution.
2. Core Contracts & Schemas (src/lib/schemas.ts)

Single source of truth for API validation, parser outputs, storefront snapshots, parity checks, and export payloads.

[NEW] schemas.ts (src/lib/schemas.ts)
ts
import { z } from 'zod';
export const FixtureScenarioIdSchema = z.enum([
  'healthy-offer',
  'expired-promo',
  'oos-price-mismatch',
]);
export const XRayRequestSchema = z.object({
  adCopy: z.string().trim().min(5, 'Ad copy must be at least 5 characters').max(5000),
  landingPageUrl: z
    .string()
    .trim()
    .url('Enter a valid http:// or https:// landing page URL')
    .refine((u) => /^https?:\/\//i.test(u), 'Only http:// and https:// URLs are supported'),
  dailyBudget: z.number().finite().min(0, 'Daily budget cannot be negative').max(1_000_000),
  fixtureId: FixtureScenarioIdSchema.optional(),
});
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
export type OverallVerdict = 'PASS' | 'WARN' | 'FAIL' | 'WAF_CHALLENGE_MANUAL_CHECK';
3. Deterministic Ad Claim Extractor (src/lib/parser/)

Pure-code parser with zero LLM randomness and full signal provenance.

[NEW] adClaimExtractor.ts (src/lib/parser/adClaimExtractor.ts)
extractAdClaims(adCopy: string, landingPageUrl: string): ExtractedAdClaims:
Price & Currency: Extracts advertisedPrice, optional compareAtPrice ("Now $36 (was $45)", "$199 -> $149.25"), and ISO currency ($/USD, £/GBP, €/EUR, CAD, AUD). Explicitly filters out shipping threshold phrases ("Free shipping on orders over $75", "orders $50+") before selecting the product's advertised price.
Promo Code: Matches contextual patterns (code SAVE20, promo: BFCM25, apply "HYDRATE20" at checkout) with an uppercase/alphanumeric token validator (3–20 chars) and an English stopword blocklist (CHECKOUT, TODAY, HERE, FREE, LINK, NOW) to prevent false-positive promo extraction.
Discount Percentage: Extracts exact percentage claims (25% OFF, Save 20%), distinguishing "Up to X% off" ceilings (isUpToDiscount: true) from flat sitewide/code promises.
Hero Variant: Extracts color, size, pack-count, or flavor claims from ad copy patterns ("in Alpine Olive (Size L)", "Color: Obsidian Black", "Variant: 2-Pack") and URL query hints (?variant=..., ?color=..., ?size=...).
UTM & Click-ID Hygiene: Parses URL query parameters (utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid, gclid).
4. Deterministic Fixtures & Storefront Verifier (src/lib/fixtures/ & src/lib/verifier/)

Offline-first deterministic demo scenarios paired with an SSRF-hardened live storefront fetcher.

[NEW] demoScenarios.ts (src/lib/fixtures/demoScenarios.ts)

Defines the 3 pre-loaded scenarios required by brief.md:

healthy-offer (Healthy Offer): Lumina 32oz Insulated Bottle in Obsidian Black — Ad promises $36.00 (20% OFF $45.00) with code HYDRATE20 and complete Meta UTMs. Fixture confirms variant Obsidian Black in stock at $45.00 base + active HYDRATE20 (20% discount -> $36.00). Verdict: PASS, $0/day waste.
expired-promo (Expired Promo Code): Veloce Recovery Boots — Ad promises 25% OFF ($149.25, reg $199.00) with code BFCM25 ($1,200/day budget). Fixture shows product in stock at $199.00, but BFCM25 status is EXPIRED (expired 2026-11-05). Verdict: FAIL on promo_code and price_parity.
oos-price-mismatch (Out-of-Stock Variant & Price Mismatch): Kova Merino Trail Hoodie in Alpine Olive / L — Ad promises $68.00 ($850/day budget) with missing utm_campaign. Fixture shows base price raised to $84.00, Alpine Olive / L available: false (while Charcoal / S remains available: true), and missing campaign UTM. Verdict: FAIL on variant_stock and price_parity, WARN on utm_hygiene.
[NEW] ssrfGuard.ts (src/lib/verifier/ssrfGuard.ts)
Validates URL protocol (http: or https: only), blocks embedded credentials, localhost, .local/.internal domains, and checks IP literals + dns.lookup(..., { all: true }) results against loopback (127.0.0.0/8, ::1), RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local/cloud metadata (169.254.0.0/16, fe80::/10), and IPv4-mapped IPv6 private ranges.
[NEW] storefrontVerifier.ts (src/lib/verifier/storefrontVerifier.ts)
Resolves fixtures immediately when fixtureId is supplied or URL belongs to demo.offerparity.app.
For live URLs:
Uses a single shared 8,000ms total AbortController deadline across DNS resolution and manual redirect traversal (max 3 hops, re-running ssrfGuard on every hop) plus a 2 MB streamed response byte limit—guaranteeing every diagnostic finishes well under the 15-second SLA.
WAF / Bot-Block Detection: Inspects 403/429/503 responses + Cloudflare/PerimeterX/DataDome headers and challenge markers (cf-mitigated, _cf_chl_opt, Just a moment...), returning wafStatus: 'WAF_CHALLENGE_MANUAL_CHECK' cleanly.
Shopify /products/<handle>.js Strategy: When path matches /products/<handle>, fetches /products/<handle>.js to obtain exact Shopify variant-level availability and cent-accurate pricing.
JSON-LD & OpenGraph Fallback (htmlMetadataParser.ts): Uses cheerio to parse application/ld+json (Product, ProductGroup, Offer, AggregateOffer, @graph) and OpenGraph price/availability tags.
5. Parity Diff Engine, Waste Estimator & Exporters (src/lib/diff/ & src/lib/exporters/)
[NEW] parityEngine.ts (src/lib/diff/parityEngine.ts)

Evaluates 6 structured checks (PASS / WARN / FAIL) with human-readable expected, actual, impactWeight, and remediation:

http_health: HTTP status, redirect chain length (>2 hops -> WARN), or WAF_CHALLENGE_MANUAL_CHECK.
price_parity: First verifies ISO currency parity (ad.currency vs storefront.currency, failing on explicit mismatch such as USD vs GBP and warning if storefront currency metadata is missing), then reconciles advertisedPrice against effective storefront price (base price minus verified active promo discount when applicable, within $0.01 rounding tolerance).
variant_stock: Token-normalized matching (Alpine Olive (Size L) <-> Alpine Olive / L) against variants[] availability and product-level inStock.
promo_code: Evaluates ACTIVE (PASS), EXPIRED/INVALID/MIN_SPEND_UNMET (FAIL), or UNVERIFIED_LIVE_STORE (WARN).
discount_math: Verifies advertised discountPct against (compareAtPrice - effectivePrice) / compareAtPrice (>2% overstated discount -> FAIL).
utm_hygiene: Checks utm_source, utm_medium, and utm_campaign completeness (WARN if incomplete).
[NEW] wasteCalculator.ts (src/lib/diff/wasteCalculator.ts)
effectiveWasteRate
=
1
−
∏
𝑖
∈
FAIL
(
1
−
𝑤
𝑖
)
effectiveWasteRate=1−
i∈FAIL
∏
	​

(1−w
i
	​

)
Weights: Dead HTTP/All-OOS (1.00), Hero Variant OOS (0.75), Expired/Invalid Promo (0.45), Live Price Higher Than Ad (0.40), Exaggerated Discount % (0.25).
Returns estimatedDailyWaste, projectedMonthlyWaste (30x), atRiskDailySpend (from WARN items), and an explicit formula breakdown string.
When overallStatus === 'WAF_CHALLENGE_MANUAL_CHECK', sets estimatedDailyWaste = 0 so bot-challenged pages never report fabricated spend burn.
[NEW] reportFormatters.ts (src/lib/exporters/reportFormatters.ts)
buildSlackAlert(report): Produces a concise Slack-formatted burn-rate alert card (:rotating_light: / :warning: / :large_green_circle:) with URL, daily/monthly burn, failed checks diff, and recommended media-buyer action.
buildMarkdownReport(report): Produces a structured Markdown QA audit artifact for agency client reporting or ticket attachment.
6. API Route & Diagnostic Dashboard UI (src/app/)
[NEW] route.ts (src/app/api/xray/route.ts)
POST /api/xray: Validates request via XRayRequestSchema, orchestrates extraction, storefront verification, diffing, waste calculation, and report generation, returning typed JSON with Cache-Control: no-store.
[NEW] UI Components (src/components/ & src/app/page.tsx)
ScenarioSelector.tsx: One-click buttons for the 3 pre-loaded scenarios + "Custom Live URL" mode indicator. On initial load at /, the UI pre-populates the Out-of-Stock Variant & Price Mismatch scenario so first-time visitors can run the 15-second X-Ray immediately instead of facing a blank form.
XRayForm.tsx: Ad copy input, landing page URL input, daily budget input with quick-select chips ($250, $500, $1,200, $5,000), and instant validation feedback.
WasteSummaryBanner.tsx: High-contrast verdict header (PASS, WARN, FAIL, or WAF_CHALLENGE_MANUAL_CHECK), daily wasted spend, 30-day projected burn, and transparent math tooltip/drawer.
ClaimsComparisonCard.tsx: Side-by-side comparison of extracted ad signals vs. storefront truth (including variant inventory matrix).
ParityDiffTable.tsx: Field-by-field table with status badges, promised vs. observed values, and remediation guidance.
AlertExportPanel.tsx: Live Slack Burn-Rate Alert preview with working Copy Slack Alert, Copy Markdown, Download JSON, and Download Markdown buttons (with accessible copy-state confirmation).
Verification Plan
Automated Tests (Incremental Per-Module Gates)

Tests are written and executed immediately after each module is built—not deferred to the end—so regressions are caught before downstream layers depend on them. All tests run locally offline with zero flaky network calls:

Gate 1 — Ad Claim Extractor (src/__tests__/adClaimExtractor.test.ts):
Multi-currency prices, sale vs. anchor prices, shipping-threshold exclusion ("Free shipping over $75"), promo code extraction + stopword filtering, discount percentages, variant strings, and UTM parsing.
Gate 2 — Storefront Verifier & SSRF Guard (src/__tests__/storefrontVerifier.test.ts):
SSRF blocking (http://127.0.0.1, http://169.254.169.254, file:///etc/passwd, open redirect to 10.0.0.1).
Mocked fetch tests for Shopify .js JSON, Schema.org JSON-LD (Product, @graph, AggregateOffer), missing JSON-LD fallback, HTTP 404/500, shared 8s total timeout handling, and Cloudflare/DataDome 403 -> WAF_CHALLENGE_MANUAL_CHECK.
Gate 3 — Parity Diff & Waste Calculator (src/__tests__/parityAndWaste.test.ts):
All 3 canonical demo scenarios (healthy-offer, expired-promo, oos-price-mismatch), currency mismatch (USD vs GBP), dailyBudget = 0, rounding tolerances (±$0.01), survival-complement waste math bounds ([0, dailyBudget]), and Slack/Markdown exporter output snapshots.
Gate 4 — API Route, Build & UI Integration (src/__tests__/apiAndUi.test.tsx):
POST /api/xray validation (400 on invalid/non-HTTP URLs, empty ad copy, negative budget; 200 on valid fixture & mocked live requests).
React component tests verifying initial pre-loaded scenario state, scenario switching, form submission, parity badge rendering, and clipboard/download controls with zero dead buttons.
bash
pnpm typecheck
pnpm lint
pnpm test -- --coverage
pnpm build
Manual Verification
Start the production server (pnpm build && pnpm start) and open http://localhost:3000.
Click each of the 3 pre-loaded demo scenarios (Healthy Offer, Expired Promo Code, Out-of-Stock Variant & Price Mismatch) and confirm instant (<15s) parity diff updates and accurate burn calculations.
Adjust the Daily Budget input and verify daily/30-day wasted spend updates deterministically.
Test Copy Slack Alert and Download JSON / Markdown buttons to confirm valid exported outputs.