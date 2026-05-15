# PPK TEX ERP

Cloud ERP for PPK Tex Industries — orders, production, costing, attendance, payments.

This guide is written for someone who has **never deployed a web app before**. Follow it step by step. If anything is unclear, stop and ask.

---

## What you are about to set up

| Piece | What it does | Cost |
|---|---|---|
| **Supabase** | Cloud database + login system (Mumbai region, ~30 ms latency from Coimbatore) | Free to start, ₹2,000/mo at scale |
| **Vercel** | Hosts the website you and your team open in the browser | Free to start, ₹1,800/mo at scale |
| **GitHub** | Stores the code so Vercel can rebuild it automatically | Free |

Total starting cost: **₹0/month**. You only pay if/when traffic outgrows the free tiers.

---

## Step 1 — Install the tools on your computer (one time)

You need three free tools. Install them in this order:

1. **Node.js 20** — https://nodejs.org → download the LTS installer → next-next-finish.
   Verify in Command Prompt: `node --version` should print `v20.x` or higher.

2. **Git** — https://git-scm.com/download/win → install with default options.
   Verify: `git --version`.

3. **Supabase CLI** (optional but recommended for type generation):
   In Command Prompt:
   ```
   npm install -g supabase
   ```

---

## Step 2 — Create a Supabase project (15 minutes)

1. Go to **https://supabase.com** → click **Start your project** → sign up with the email `redbloodppk@gmail.com`.
2. Click **New project**.
   - **Name:** `ppk-tex-erp`
   - **Database password:** make a strong one, copy it to a notepad — you'll need it later.
   - **Region:** choose **Mumbai (ap-south-1)**. This is critical for speed.
   - **Pricing plan:** Free.
3. Wait ~2 minutes for the project to be created.
4. On the project dashboard, click the gear icon (Settings) on the left → **API**.
   Copy these three values to your notepad — you'll paste them into Step 4:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ…`)
   - **service_role** key (another long string — **keep this secret, never commit it**)
5. Also note the **Project ID** (the `abcdefgh` part of your URL).

---

## Step 3 — Load the database schema into Supabase

The folder `db/` next to this README contains three SQL files that build the entire database.

1. In your Supabase project, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `db/schema.sql` in Notepad (or any editor), copy **all of it**, paste into the SQL Editor, click **Run**.
   - Expected: "Success. No rows returned." If you see an error, screenshot it and ask for help.
4. Repeat the paste-and-Run with `db/rls.sql` (security policies).
5. Repeat with `db/seed.sql` (your master data — yarn counts, mills, customers, employees, looms).
6. Click **Table Editor** in the sidebar — you should now see 33 tables filled with seed data. Open the `customer` table to confirm you can see SKM Garments, Arul Textiles, etc.

---

## Step 4 — Configure the app

1. Open the `app/` folder (the one this README is in) in your file explorer.
2. Find the file called `.env.example`. Copy it and rename the copy to `.env.local`.
3. Open `.env.local` in Notepad and fill in the values you copied in Step 2:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…(your anon key)…
   SUPABASE_SERVICE_ROLE_KEY=eyJ…(your service role key)…
   SUPABASE_PROJECT_ID=abcdefgh
   ```

4. Save the file. **Never share this file** — the service_role key bypasses all security.

---

## Step 5 — Run it locally to make sure it works

Open Command Prompt **inside the app/ folder** (Shift+Right-click in the folder → "Open PowerShell window here").

```
npm install
npm run dev
```

The first command takes 1–2 minutes (downloads dependencies). The second starts the website. When you see `Ready in …`, open **http://localhost:3000** in your browser.

You should see the **Sign in** screen.

### First-time login

You can't sign in yet because no user accounts exist. Go back to Supabase:

1. **Authentication** → **Users** → **Add user** → **Create new user**
   - Email: `redbloodppk@gmail.com`
   - Tick **Auto Confirm Email**
   - Click **Create user**.
2. Now link that auth user to an `app_user` row. The easiest way is via **SQL Editor** (one query, no UUID typing):

   ```sql
   INSERT INTO app_user (id, email, full_name, role, status)
   SELECT id, email, 'Praveen Kumar', 'owner', 'active'
   FROM auth.users
   WHERE email = 'redbloodppk@gmail.com';
   ```

   (Why SQL and not Table Editor? `app_user.id` must equal the UUID Supabase generated for the auth user — the query above copies it across automatically. Also note: the column is `status` with value `active`, not a true/false `is_active` field.)
3. Back in your browser at http://localhost:3000, type `redbloodppk@gmail.com`, click **Send code**. A 6-digit code arrives in your inbox. Paste it. You're in.

---

## Step 6 — Put it on the internet (deploy to Vercel)

So your phone, your manager's laptop, and the floor supervisor's tablet can all use it.

1. Sign up at **https://github.com** (free) using `redbloodppk@gmail.com`.
2. Create a new private repository called `ppk-tex-erp`.
3. In Command Prompt inside the `app/` folder:
   ```
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/<your-username>/ppk-tex-erp.git
   git push -u origin main
   ```
   (GitHub will ask for a Personal Access Token instead of your password — create one at https://github.com/settings/tokens.)
4. Sign up at **https://vercel.com** (free) using your GitHub account.
5. Click **Add New** → **Project** → import your `ppk-tex-erp` repo.
6. **Environment Variables**: paste the same four lines from your `.env.local` file.
7. Click **Deploy**.
8. After ~2 minutes you'll get a URL like `ppk-tex-erp.vercel.app`. Open it on your phone.

To use a custom domain like `erp.ppktex.in`, click **Settings** → **Domains** in Vercel and follow the DNS instructions.

---

## Step 7 — Add your team

For each team member:

1. Supabase → **Authentication** → **Users** → **Add user** → enter their email, tick Auto Confirm.
2. Supabase → **Table Editor** → `app_user` → Insert row with their email and pick a role:
   - `owner` — you, full access
   - `mill_manager` — production, costing, outsourcing
   - `sales_manager` — orders, customers, prices
   - `accounts` — payments, invoices, reports
   - `floor_operator` — attendance, daily production
   - `auditor` — read-only across everything

Tell them to open the deployed URL and sign in with their email.

---

## Daily use

- **Updating the app**: edit code locally, `git push`, Vercel rebuilds automatically in ~30 seconds.
- **Updating data**: through the app screens, or directly in Supabase Table Editor for masters.
- **Backups**: Supabase backs up the database daily on the free tier. Upgrade to Pro for point-in-time recovery once you're storing real money.
- **Costs to watch**: Supabase free tier = 500 MB database + 1 GB file storage. You'll be far below that for the first year.

---

## Folder layout

```
app/
├── README.md           ← this file
├── STACK.md            ← why we chose Supabase + Next.js
├── package.json        ← list of dependencies
├── .env.example        ← copy → .env.local and fill in
├── db/
│   ├── schema.sql      ← 33 tables, 6 views, audit triggers
│   ├── rls.sql         ← role-based security policies
│   └── seed.sql        ← PPK Tex master data
├── app/                ← Next.js pages (one folder per screen)
│   ├── login/
│   ├── app/
│   │   ├── dashboard/
│   │   ├── customers/
│   │   ├── costing/
│   │   ├── costing-calc/
│   │   └── …          (one folder per module)
│   └── components/     ← shared UI: sidebar, topbar, page header
├── lib/
│   ├── utils.ts        ← formatRupee, warpMetresPerGram, etc.
│   └── supabase/       ← three Supabase clients (browser, server, middleware)
└── public/             ← icon, manifest for installable PWA

The original HTML prototype mockups live one folder up at `../02_dashboard/`,
`../03_mill_master/`, etc. — kept for design reference.
```

---

## Useful commands

| Command | Does |
|---|---|
| `npm run dev` | Run the app locally on http://localhost:3000 |
| `npm run build` | Production build (Vercel runs this on deploy) |
| `npm start` | Serve a built app locally |
| `npm run typegen` | Regenerate `lib/database.types.ts` from your live Supabase schema |
| `npm run lint` | Check for code issues |

After you change the database schema (added a column, etc.), always run:
```
set SUPABASE_PROJECT_ID=abcdefgh
npm run typegen
```
This updates the TypeScript types so the app sees the new columns.

---

## Getting help

If something breaks:

1. Open browser DevTools (F12) → Console tab → screenshot any red errors.
2. Open Supabase → **Logs** → check the latest entries.
3. The error message usually points to the exact file and line number.

---

Built with: Next.js 15 · TypeScript · Tailwind CSS · Supabase (Postgres) · Vercel.
