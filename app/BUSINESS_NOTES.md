# PPK TEX — Business Notes

Running log of business rules, exceptions, and preferences Praveen has told me,
so I don't lose them between sessions. Add new notes at the top with a date.

---

### 2026-07-26 — Sunday shift timing is shorter (10 hrs, not the usual full shift)

Every **Sunday morning shift runs 8:00 AM – 6:00 PM = 10 hours**, instead of the
normal shift length.

**Why this matters for the app:**
- Settings → Loom Rate Target has a single global **Shift hours** value (currently
  used for every day, e.g. 12) that drives the theoretical/target metres in the
  **Loom Efficiency & Cost** report (`app/app/reports/loom-efficiency/page.tsx`,
  config at `app/app/settings/loom-rate-target/page.tsx`). Because Sunday is only
  10 hours, using the normal-day target on Sunday will make Sunday's efficiency %
  look artificially low even when weavers performed normally.
- Not yet fixed in code — noted here so it can be handled when the Loom Efficiency
  report or wage/shift logic is next touched. Options to consider then: a
  per-day-of-week shift-hours override, or a separate Sunday target row.

**Note style example (from Expenses form):** short lowercase notes like
"toilet cleaning" are how Praveen tags misc expense entries — keep suggestions in
that plain, short style rather than formal phrasing.

---
