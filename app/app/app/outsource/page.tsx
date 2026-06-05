// /app/outsource — Outsource Weaving command centre.
//
// The previous outsource_order list page was retired (the workflow
// used to be a vendor-PO board for issuing yarn). It now mirrors the
// Job Work page exactly, but filters every jobwork_party row to
// kind='outsource' instead of 'jobwork' (see migration 113).
//
// We re-export the JobworkPage component verbatim — it detects the
// route via usePathname() and switches its title, subtitle, manage
// link, and the kind it queries.
'use client';
import JobworkPage from '../jobwork/page';

export default JobworkPage;
