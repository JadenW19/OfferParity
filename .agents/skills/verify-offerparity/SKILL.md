---
name: verify-offerparity
description: Run this after making changes to the OfferParity UI, parser, parity engine, or POST /api/xray route to verify end-to-end runtime behavior.
---

## OfferParity Runtime Verification

1. Build and start the local server (`pnpm build && pnpm start`) and verify `http://localhost:3000` returns HTTP 200 with zero console/runtime errors and no dead UI controls.
2. Exercise all 3 pre-loaded demo scenarios (`healthy-offer`, `expired-promo`, `oos-price-mismatch`), adjust the Daily Budget input, and confirm deterministic parity diffs, waste estimates, and working `AlertExportPanel` actions (Copy Slack Alert, Download JSON/Markdown).
3. Hit `POST /api/xray` with edge-case payloads (malformed URL, missing `schema.org/Product` JSON-LD, and simulated WAF 403 returning `WAF_CHALLENGE_MANUAL_CHECK` with `estimatedDailyWaste: 0`) and confirm structured JSON responses instead of unhandled 500s.
