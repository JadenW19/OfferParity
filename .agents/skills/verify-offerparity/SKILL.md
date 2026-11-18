---
name: verify-offerparity
description: Run this after making changes to the OfferParity UI, parser, parity engine, or POST /api/xray route to verify end-to-end runtime behavior.
---

## OfferParity Runtime Verification

1. Build and start the local server (`pnpm build && pnpm start`) and verify `http://localhost:3000` and `GET /api/health` return HTTP 200 (`deterministicOnly: true`) with zero console/runtime errors and no dead UI controls.
2. Exercise all 3 pre-loaded demo scenarios (`healthy-offer`, `expired-promo`, `oos-price-mismatch`), adjust the Daily Budget input, switch to **Batch CSV Pre-Flight** to run the sample 4-ad BFCM campaign (`POST /api/xray/batch`), and confirm deterministic parity diffs, waste estimates, shareable permalinks, and working `AlertExportPanel` actions.
3. Hit `POST /api/xray` and `POST /api/alerts/slack` with edge-case payloads (malformed URL, SSRF loopback/non-Slack webhook block, missing `schema.org/Product` JSON-LD, and simulated WAF 403 returning `WAF_CHALLENGE_MANUAL_CHECK` with `estimatedDailyWaste: 0`) and confirm structured JSON responses instead of unhandled 500s.
