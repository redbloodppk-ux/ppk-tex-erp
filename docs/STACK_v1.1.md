# PPK TEX ERP — Locked Stack v1.1

> Supersedes Build Guide v1.0 §1.2 entirely. Paste a copy of this file at
> the start of every new Claude Code session along with the specific
> Correction Card to be built.

## Frontend

* **Framework**: Next.js 15.x (App Router) with React 19 + TypeScript 5.6.
  Server Components by default; Client Components only when interactivity demands.
* **Styling**: Tailwind CSS 3.4 with tokens in `tailwind.config.ts`. No Material UI / Ant Design.
* **Component primitives**: Radix UI ONLY for modal, dropdown, dialog, popover when accessibility demands it. Add on first need.
* **Forms**: `react-hook-form` + `zod`. Schemas live in `lib/validators/`, importable from both server and client.
* **PWA**: `next-pwa` with manifest + service worker. Cached routes per CORR-H1.

## Backend

* Next.js Server Actions + Route Handlers (`app/api/`). No separate Express server.
* Business logic lives in `lib/` as pure TypeScript, callable from Server Components and Route Handlers.
* All Route Handlers return `{ data, meta?, error? }`. Errors carry HTTP status + code + message.

## Database

* **Engine**: Supabase Postgres.
* **Migrations**: numbered SQL files in `supabase/migrations/` (current repo uses `app/db/migrations/`).
* **Types**: `lib/database.types.ts` regenerated via `npm run typegen` after every migration.
* **Money columns**: `numeric(15,2)` (or wider). NEVER `float8 / double precision / real`.
* **Weight columns**: `numeric(10,3)` (or wider).
* **Pick rate**: `numeric(8,4)` (paise to 4 decimals).
* **Soft-delete**: every master has `status ('active'|'inactive')`. Hard delete only by owner role, only on 90+ day inactive rows.
* **Audit**: every transactional table has `created_at/by`, `updated_at/by`. Plus an `audit_log` table.

## Authentication & Authorisation

* **Auth**: Supabase Auth, email OTP (passwordless). `@supabase/ssr` cookies.
  Server Components → `createServerClient`. Client Components → `createBrowserClient`.
  **Never** ship the Supabase service role key to the client.
* **Authz**: Row-Level Security on every table. 6 application roles:
  `owner, mill_manager, sales_manager, accounts, floor_operator, auditor`.
  Resolved in RLS policies via `auth.uid()` ↔ `app_user`. New users default
  to `floor_operator`; only `owner` can change roles. Owner-decision D13
  (16-May-2026) locked in these names — see CORRECTION_GUIDE_v1.1.md.

## State & Data

* Server Components for most data fetching.
* Zustand for cross-component client state (add when first needed).
* TanStack Query only when client-side caching of API data is unavoidable (default: refetch via server).

## Date & Money

* **Dates**: `date-fns`. Store UTC in `timestamptz`, display in `Asia/Kolkata`.
  ISO 8601 in API, `dd-MMM-yyyy` in UI (`formatDate` from `lib/date.ts`).
* **Money**: `decimal.js`. **Never** JavaScript Number for currency. All
  currency math through `lib/money.ts` helpers. Display via `formatINR()`.

## Icons & Charts

* Icons: `lucide-react`.
* Charts: `recharts`.

## Testing

* **Unit**: `vitest` (with `@vitest/coverage-v8`, `@testing-library/react`, `jsdom`).
  `lib/formulas/**` coverage must be ≥ 95%.
* **E2E**: `playwright` (`@playwright/test`). 15 must-have scenarios in CORR-H9.

## Hosting & CI

* Vercel for the Next.js app (free → Pro before production rollout to staff).
* Supabase free → Pro before production rollout.
* GitHub auto-deploy on push to `main`.

## Forbidden

Prisma, Sequelize, TypeORM, Mongoose, raw JWT handling, bcrypt, any
separate Express servers, Material UI, Ant Design, any database other than
Supabase Postgres.

---

### Operational rules (from §1.7 Definition of Done)

* `typescript.ignoreBuildErrors = false` and `eslint.ignoreDuringBuilds = false` in `next.config.mjs`.
* No `any` without a `// reason:` comment above the line.
* Zod validation on every input (Server Action arg, Route Handler body, form input).
* RLS policy for every new table, tested for each of the 6 roles.
* Unit tests for any non-trivial business logic (formulas, validation, edge cases).
* Error states, loading states, empty states all implemented in UI.
* Responsive: desktop 1280+, tablet 768+, mobile 375+.
* Keyboard navigable. Focus rings visible. ARIA labels on icon-only buttons.
* Audit trail row created on every insert/update/delete on a transactional table.
