# OfferParity — Agent & Engineering Rules

## Core Architecture & Non-Goals
- Keep the core OfferParity X-Ray pipeline (`extractAdClaims`, `verifyStorefront`, `evaluateParity`, `calculateWaste`) 100% deterministic by default. Any AI/Gemini integration must remain strictly opt-in and server-side only.
- Never expose `GEMINI_API_KEY` or other secrets to client components or commit `.env*.local` files.
- Respect `brief.md` non-goals: no auth walls blocking `/`, no automated ad-pausing, and zero dead UI controls.

## Error Handling & UI State Rules
1. **Never silently swallow errors in API routes or fallback paths:** Empty `catch {}` blocks are forbidden. Even when degrading gracefully (such as optional `useGeminiFallback` in `POST /api/xray`), log a sanitized diagnostic (`console.warn`) or surface a structured status note so failures are observable.
2. **Clear stale server errors on user input edits:** Any form handler that updates `adCopy`, `landingPageUrl`, `dailyBudget`, or switches scenarios must reset `serverError` to `null` so outdated server alerts never stack alongside new inline validation errors.

## Definition of Done
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` must all pass with zero errors before marking any task complete.
