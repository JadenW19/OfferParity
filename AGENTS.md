# OfferParity — Agent & Engineering Rules

## Core Architecture & Non-Goals
- Keep OfferParity 100% deterministic and pure-code (`extractAdClaims`, `verifyStorefront`, `evaluateParity`, `calculateWaste`, `parseCampaignCsv`). Do NOT introduce external LLM/AI dependencies or API keys.
- Never commit `.env*.local` files or expose server-side webhook URLs (`SLACK_WEBHOOK_URL`) to client components.
- Respect `brief.md` non-goals: no auth walls blocking `/`, no automated ad-pausing, and zero dead UI controls.

## Error Handling & UI State Rules
1. **Never silently swallow errors in API routes or fallback paths:** Empty `catch {}` blocks in route handlers are forbidden. Log sanitized diagnostics (`console.warn` / `console.error`) or surface structured error codes so failures are observable.
2. **Clear stale server errors on user input edits:** Any form handler that updates `adCopy`, `landingPageUrl`, `dailyBudget`, or switches scenarios/modes must reset `serverError` to `null` so outdated server alerts never stack alongside new inline validation errors.

## Definition of Done
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` must all pass with zero errors before marking any task complete.
