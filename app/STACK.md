# PPK TEX ERP — Stack Choice

**Decision date:** May 2026
**Decided by:** Praveen Kumar (owner) + Claude

This document explains *why* the technology choices below were made, so that if you (or any developer) revisits the decision in 2 years, the reasoning is preserved.

---

## TL;DR

| Layer | Choice | Why |
|---|---|---|
| Database | **PostgreSQL** (managed by **Supabase**) | Relational data, exact decimals for money, Mumbai region for Coimbatore latency |
| Backend logic | **Supabase Edge Functions** + **Postgres functions** | Business formulas live next to data — single source of truth |
| Auth | **Supabase Auth** | Built-in, SMS+email OTP, role claims for RLS |
| Frontend | **Next.js 15** (App Router) + **TypeScript** | Server-rendered = fast even on weak mill WiFi |
| Styling | **TailwindCSS** + **shadcn/ui** | Same design language as the prototypes already built |
| PWA / Mobile | **next-pwa** (service worker, offline cache) | Same codebase serves web + installable mobile |
| Hosting | **Vercel** (frontend) + **Supabase** (backend) | Free tier covers PPK TEX scale; both auto-scale |
| Total starting cost | **₹0/month** | Free tiers comfortably cover a small mill |
| Total cost at scale | **~₹3,800/month** | Vercel Pro $20 + Supabase Pro $25 ≈ ₹3,800 |

---

## Backend / Database — Supabase (managed PostgreSQL)

### Why Postgres specifically

1. **Money math has to be exact.** Your spec has ₹/kg, ₹/mtr, paise/pick — all decimals. Floating-point math (which most NoSQL databases use) silently rounds: `0.1 + 0.2` = `0.30000000000000004`. Postgres `NUMERIC(12,4)` is exact to 4 decimal places — your audit trail will balance to the rupee 100% of the time.

2. **Your data is relational.** A Sales Order links to a Customer, a Costing Master, multiple Production Batches, multiple Yarn Lots, an Invoice, and a Payment. NoSQL forces you to either duplicate data (and update 8 places when a customer changes their GSTIN) or do app-level joins (slow). Postgres joins are what relational databases were invented for.

3. **Your formulas can live in the database.** Per Costing Spec v1.1, things like `PorvaiNeC = 5315 / Denier` and `True Cost = Warp + Weft + LOOMS + Bobbin + Porvai + Commissions` are pure math. Postgres `GENERATED ALWAYS AS` columns or views compute these once, server-side, and every report sees the same number. If you change a constant (say LOOMS goes from ₹5.14 to ₹5.40), every query updates — no chance of stale numbers in some screen you forgot.

4. **Row-Level Security (RLS) is enforced by the database itself.** Per Module 18, you have 5 roles: Owner, Mill Manager, Sales, Accounts, Floor Operator. With RLS, even if a hacker gets a Floor Operator's password and bypasses the frontend entirely, the database refuses to return Owner-only rows. The security boundary is in Postgres, not in JavaScript code that could have a bug.

### Why Supabase specifically (not raw Postgres on a VPS)

- **Mumbai region.** AWS `ap-south-1` is the nearest Supabase region to Coimbatore. Measured latency: 30–50ms. Compare to US-East: 250–300ms. Latency is everything for a "speedy access without lagging" experience.
- **Auth built-in.** Email OTP, phone OTP, Google sign-in — all wired up. No need to build login from scratch.
- **Realtime subscriptions.** When a supervisor marks attendance on the floor tablet, the manager's dashboard updates instantly. No polling.
- **Storage included.** Customer GSTIN copy uploads, fabric swatch photos, signed delivery challans — all in one bucket with the same auth.
- **Backups & PITR.** Daily backups on free tier; Point-In-Time Recovery on Pro. Your spec (Module 18) calls for this.
- **PostgREST API auto-generated.** Every table you create instantly gets a REST API — no manual route writing for basic CRUD.
- **Free tier is generous.** 500MB database, 1GB file storage, 50K monthly active users, 500MB realtime bandwidth. PPK TEX won't hit any of these for years.
- **Pro tier is $25/mo (~₹2,100).** When you scale: 8GB database, daily backups with 7-day retention, PITR, no project pause.

### Alternatives I considered

| Option | Why not |
|---|---|
| Firebase / Firestore | NoSQL — bad fit for relational data. Money math uses doubles. Realtime queries cost money per read; can get expensive fast. |
| MongoDB Atlas | Same NoSQL problem. Joins are awkward. Forces denormalization. |
| MySQL self-hosted | You become the sysadmin. Patches, backups, scaling — all your problem. |
| MariaDB on Hostinger / DigitalOcean | Cheaper (₹500/mo) but no managed backups, no auth, no realtime. You'd write all that yourself. |
| Microsoft SQL Server | Licensing cost. Overkill for a small mill. |
| Oracle | Don't even ask. |
| Custom Postgres on AWS RDS | Possible, but Supabase wraps it with auth + realtime + storage at the same price point. |

---

## Frontend — Next.js 15 + TypeScript + TailwindCSS + shadcn/ui

### Why Next.js (App Router) specifically

1. **Server-side rendering.** Your dashboards run heavy queries (LOOMS allocation, lot tracing, vendor scoreboard). With Next.js App Router, these queries run on Vercel's edge servers in Mumbai, and the user receives plain pre-rendered HTML. The dashboard appears in <500ms even on poor mobile signal in the mill — far better than a single-page React app that downloads 2MB of JS first, then makes 12 separate API calls.

2. **Server Actions = no API layer to write.** A button click can directly call a server-side function that talks to Supabase, instead of you writing `/api/save-costing` endpoints by hand. Less code, fewer bugs.

3. **TypeScript catches typos at compile time.** Supabase auto-generates TypeScript types from your schema. If you write `customer.gtsin` instead of `customer.gstin`, the editor underlines it red before you even save. That single feature has prevented thousands of production bugs across the industry.

4. **PWA support is one plugin.** `next-pwa` enables installable mobile, offline caching, push notifications. Your spec's 5 offline features (wages, customer payment, purchase payment, costing calculator, attendance) become 5 cache rules in one config file.

### Why TailwindCSS + shadcn/ui

- **Tailwind** is what we already used in your prototypes (well, the same utility-first idea). Direct port — no relearning.
- **shadcn/ui** isn't a library you `npm install` — it's a collection of copy-paste React components that you own. You can edit them. No "framework lock-in".
- **The design system you saw in prototypes** (glassmorphism, neumorphism, the indigo→violet→gold palette, JetBrains Mono for numbers) ports directly to Tailwind tokens.

### Why Vercel for hosting

- **Made by the same team as Next.js.** Zero-config deployment.
- **Automatic global CDN** — static assets serve from Mumbai for your users, automatically.
- **Free tier is generous.** 100GB bandwidth, unlimited deployments, automatic HTTPS with custom domain.
- **Pro tier $20/mo (~₹1,700)** when you grow: 1TB bandwidth, advanced analytics, password protection.

### Alternatives I considered

| Option | Why not |
|---|---|
| Plain React (Vite) + custom backend | You'd have to build the API layer, auth flows, deployment, CDN, etc. yourself. 6 weeks of work for what Next.js gives you in a day. |
| Laravel / Django | Server-rendered, mature — but PHP/Python frontend story is dated. You'd still need React for the interactive bits. Complicates hiring. |
| Flutter / React Native | Real native apps. Overkill — your spec wants PWA. Dual codebases to maintain. |
| WordPress + plugins | Possible but the data model is too custom. You'd outgrow it in 3 months. |
| Retool / AppSheet (low-code) | Fast to start but you'd hit walls on the costing calculator, the LOOMS allocation, lot tracing. Not flexible enough for your spec. |
| Frappe / ERPNext | Free, full ERP — but textile-specific customization (Porvai, two-cost model, LOOMS overhead) would mean rewriting their core. More work than starting from scratch. |

---

## Cost projection over 3 years

| Year | Users | Database size | Monthly cost | Annual |
|---|---|---|---|---|
| Year 1 (now) | 5–10 | <500 MB | **₹0** (free tiers) | ₹0 |
| Year 2 | 10–25 | 1–4 GB | **₹3,800** (both Pro) | ₹45,600 |
| Year 3 | 25–50 | 4–8 GB | **₹3,800–6,000** (some add-ons) | ₹50,000–72,000 |

For comparison: a single off-the-shelf textile ERP license costs ₹2–5 lakh upfront plus ₹50,000–₹1 lakh per year in support. We're looking at **<10% of that cost** for a system tailored exactly to PPK TEX.

---

## Decisions you can change later (low cost)

- **Hosting region.** If a Bangalore Vercel region opens (it's planned), switching is one config change.
- **Authentication providers.** Adding WhatsApp OTP, Google sign-in, Apple sign-in — all toggles in Supabase dashboard.
- **Database upgrade.** Free → Pro is a one-click upgrade with no downtime.

## Decisions you should *not* change later (high cost)

- **Database type.** Switching from Postgres to NoSQL later would mean rewriting every query, every formula, every report. Choose right once.
- **Money type.** All money columns must be `NUMERIC` from day one. Switching from `FLOAT` to `NUMERIC` after data exists requires reconciling every record. Will be enforced in the schema.
- **Time zone.** All timestamps stored as UTC, displayed in `Asia/Kolkata`. Standard practice — don't deviate.

---

## What you (Praveen) need to do next

1. **Sign up for Supabase** at https://supabase.com (use your Gmail). Free tier, no card needed.
2. **Create a new project** — name it `ppk-tex-erp`. **Region: ap-south-1 (Mumbai).** This is critical for latency.
3. **Save the database password** somewhere safe (1Password, a notebook). You'll need it later.
4. **Sign up for Vercel** at https://vercel.com (use your Gmail). Free tier, no card needed.

That's all you do manually. Everything else — schema, code, deployment — will be in the `app/` folder I'm building now.
