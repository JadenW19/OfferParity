# OfferParity — Agency & DTC Go-To-Market Playbook

## 1. Ideal Customer Profile (ICP)

- **Primary Buyer ($249/mo Agency Plan):** DTC Performance Marketing Agencies managing 5–20 Shopify e-commerce ad accounts (`$50k–$1M+/mo` in managed Meta/TikTok spend).
- **Secondary Buyer ($99/mo Growth Plan):** In-house Growth Leads / Paid Media Managers at mid-market DTC brands running 20+ active ads across seasonal promos or size/color variants.

---

## 2. The 15-Minute Meta Ad Library -> Shareable X-Ray Play

Use the public **Meta Ad Library** (`facebook.com/ads/library`) to find live, provable wasted spend before sending a single outreach message:

1. **Filter for High-Risk Ads:**
   - Country: US/UK/CA/AU · Category: All Ads · Status: Active
   - Search keywords: `"use code"`, `"20% off"`, `"30% off"`, `"size"`, `"restocked"`, `"limited stock"`, `"today only"`
   - Target Shopify brands running **30+ active creatives** (high likelihood of merchandiser/ad-team sync lag).
2. **Run the Live X-Ray:**
   - Copy the active ad text + click the CTA link to grab the final destination URL (with UTMs).
   - Paste both into OfferParity (`/`), set a conservative `$500/day` budget if unknown, and click **Run X-Ray**.
3. **Spot a `FAIL` Verdict:**
   - Best triggers: **Out-of-Stock Hero Variant** (`variant_stock: FAIL`), **Expired / Missing Promo Code** (`promo_code: FAIL`), or **Price Mismatch** (`price_parity: FAIL`).
4. **Grab the Proof Permalink:**
   - Click **Copy Shareable Link** (`/?url=...&ad=...&budget=500`) in `AlertExportPanel`.
   - When the prospect opens that link, OfferParity automatically hydrates and runs the live parity audit in their browser.

---

## 3. Three-Touch Cold Outreach Templates

### Touch 1 — Cold Email / LinkedIn DM (Lead with Proof, Zero Pitch Deck)

> **Subject:** Found a broken offer on {{Brand}}'s active Meta ad
>
> Hey {{FirstName}} — I was checking {{Brand}}'s active ads in the Meta Ad Library and noticed your **{{Product/Promo Name}}** ad is sending paid clicks to a page with **{{Specific Failure, e.g., Size L out of stock / promo code CODE20 not applying / $10 price mismatch}}**.
>
> Here's the live diagnostic link showing the exact parity diff:
> {{Shareable_OfferParity_Link}}
>
> We built OfferParity to catch these 2 AM inventory/promo breaks before they burn budget (no Meta OAuth or ad-pausing required). Want me to run a free 25-ad CSV pre-flight check on the rest of {{Brand}}'s active URLs?

### Touch 2 — Day 3 Follow-Up (Quantify 30-Day Burn)

> Hey {{FirstName}} — quick bump on this. Even at a conservative `$500/day`, a broken hero variant or promo code burns **~$12k+/mo** in wasted clicks.
>
> Happy to drop your top 25 active ad URLs into an hourly Slack monitor for a 7-day pilot—if it catches even one leak, it pays for a full year. Worth a look?

### Touch 3 — Day 7 Breakup

> Hey {{FirstName}} — won't clog your inbox. Feel free to bookmark the free Broken-Offer X-Ray (`https://offerparity.app`) anytime your team launches a BFCM/promo sprint.

---

## 4. Pilot Onboarding Checklist ($99/mo or $249/mo)

1. Send the Stripe Payment Link (`$99/mo Growth` or `$249/mo Agency`).
2. Collect the agency/brand's **Campaign CSV** (`ad_name, ad_copy, landing_page_url, daily_budget`) and their **Slack Incoming Webhook URL** (`https://hooks.slack.com/services/...`).
3. If the brand uses strict Cloudflare/DataDome bot rules, send them `/bot` (`https://offerparity.app/bot`) to allowlist `OfferParityBot/1.0`.
4. Deliver a **25-ad Batch CSV Pre-Flight** baseline report in Slack within 24 hours.
