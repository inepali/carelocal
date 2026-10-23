# Child Files

Planned module: NC licensing-ready child records (application, emergency care, medical report, immunizations,
action plans, parent-signed policies) tracked like staff files, built on the existing compliance engine.
Decision source: "CareLocal Child Compliance - Due Diligence" PDF (2026-10-22), checked against the repo and the
primary sources. **Where the PDF and these files disagree, these files win.**

## Phase 0 status (foundations, gate: counsel sign-off and passing RLS tests)

| Item | Status |
|---|---|
| Verify NC rules against primary sources | **Done**, with gaps: [nc-rules-verification.md](nc-rules-verification.md) |
| Staff/child split of requirement rules (`audience` column, 8 list queries filtered) | **Done.** Migration `20261119000000` applied; `npm run check:audience` guards it |
| Repo cleanup (service-role scripts out of git) | **Done.** Moved to ignored `scripts/local/` |
| FAQ and marketing fee wording | **Done** (free to join; fee at check-in) |
| Child records data addendum | Draft: [legal/center-data-addendum.draft.md](legal/center-data-addendum.draft.md). Needs attorney |
| Incident response plan | Draft: [legal/incident-response-plan.draft.md](legal/incident-response-plan.draft.md). Needs names, numbers and a drill |
| Terms and Privacy changes | Draft: [legal/terms-privacy-changes.draft.md](legal/terms-privacy-changes.draft.md). **Do not publish until launch** |
| RLS test harness | **Done** (Phase 1a): `npm run test:rls`, 120 checks, dev only |
| Close the open rule questions | **Open.** See "Still not verified" in the rules file |

## Phase 1a status (data model, access rules, storage, template)

| Item | Status |
|---|---|
| Tables: `children`, `child_guardians`, `child_documents`, `child_files`, `child_audit_log` | **Done.** Migration `20261120000000`, applied to Care Local (dev) |
| Access rules: owner and admin of the child's own center only (`can_view_confidential`) | **Done and tested.** No staff, substitute, `staff_admin`, other-center or signed-out access |
| Audit trail (who changed pick-up, custody, status, files; never health values) | **Done.** Written by triggers; cannot be forged, edited or deleted from the app |
| Database rules (cross-center links, file key folder, staff vs child rules, plan limit, cascade) | **Done and tested** |
| Function grants fix (advisor findings) | **Done.** Migration `20261121000000`; advisor reports nothing for the child tables |
| NC template (17 rules in 3 sections, verified timings only) | **Done.** `src/lib/child-template.ts` |
| Storage actions (upload, register, open, delete; fail-closed access log) | **Written, type-checked, NOT yet exercised against storage** (needs the bucket below) |
| Center purge removes child data deliberately | **Done** (`ON DELETE RESTRICT` protects against accidents) |
| Screens (child list, child file, Review panel, tour conversion) | **Phase 1b: built**, see below |

### Setup you need to do
Create a **separate** storage bucket for children's files and set `R2_CHILD_BUCKET` (in `.env.local` for dev, and in the host settings for preview and production). There is deliberately **no fallback** to the staff buckets: with the variable missing, child uploads fail with an error.

### Running the access-rule tests
`npm run test:rls` creates clearly marked fixtures in the dev database, checks every child table as nine kinds of user, and removes them. It **refuses to run against carelocal-prod or any project it does not recognize.** Run it after any change to the child tables or their policies. It was also proven able to fail: a deliberately weakened policy turned exactly the right check red.

## Phase 1b status (screens)

| Item | Status |
|---|---|
| Per-center **Child Files switch** (`centers.child_files_enabled`, default off, super admin only) | **Done and tested.** Migration `20261122000000`. Every child policy now requires it, so a center cannot store child data (even through the API) until a super admin turns it on |
| Super admin toggle: Admin, then Centers, then the **Children on/off** button (childcare centers only) | **Done** |
| **Children** list (`/center/children`): search, status and classroom filters, records progress, overdue, immunization status | **Built, compiles, serves.** Not yet checked by eye in a browser |
| **Child file** (`/center/children/[id]`): header with custody warning, immunization status, Records, Contacts & pick-up, Activity | **Built, compiles, serves.** Same caveat |
| Records tab: due date, completed date, comments, accept, reject, not applicable, upload and open files | **Built.** Uses the staff rules engine. File upload and open need `R2_CHILD_BUCKET` (untested against storage) |
| Pick-up: nobody authorized by default; authorizing asks for confirmation; every change audited | **Done and tested** |
| Tour request to child (**Enroll** on the Tours screen) | **Done and tested** (data layer); screen not checked by eye |
| NC checklist loader ("Add the NC checklist" on the Children list when no rules exist) | **Done and tested** |
| Nav item **Children** (childcare, owner or admin only, switch on) | **Done** |

### Turning it on for the pilot center
1. Create the child storage bucket and set `R2_CHILD_BUCKET` (see Phase 1a setup).
2. Sign in as a super admin, open Admin, then Centers, and click **Children off** on the pilot center (it becomes **Children on**).
3. The center's owner sees **Children** in the sidebar. Open it and choose **Add the NC checklist**.
Do this only after the Terms and Privacy Policy describe child records (see `legal/terms-privacy-changes.draft.md`).

### Known limits and follow-ups
- The Records review panel is a copy of the staff panel's logic, not shared code. Extract one shared component once both are stable (the staff panel was not touched, to avoid a regression there).
- Not built yet (Phase 1c): daily reminders for children, the day-30 immunization alert, the inspection PDF, the annual immunization counts report, retention flagging 1 year after withdrawal.
- Parent upload links are Phase 2.
- Advisor note: `can_use_child_files()` is callable by signed-in users on purpose (row-level security runs as the caller). It returns a plain true or false about the caller's own access and reveals nothing about other centers. It matches the existing `can_view_confidential()`.
- Access rules: `npm run test:rls` now has 120 checks (switch, data layer, template and purge protection included).

## Environments
- **Development and testing: "Care Local"** (Supabase project `kfjpsucszngvsnacjscq`, the one linked in the CLI). Migrations and access-rule tests go here first.
- **Production: "carelocal-prod"** (`euwuynvcfrosoerhmyaj`). Never run experiments or tests against it. It needs the full migration history applied before launch.
- Child Files work happens on branch `child-file-tracker`.

## Rules for anyone adding code
1. Any query that lists `center_document_requirements` must filter on `audience`. Run `npm run check:audience`.
2. Child tables get row-level security gated on `can_view_confidential()` (owner and admin only). Test that a
   substitute, a regular employee and a non-admin get **zero rows** before shipping.
3. Never reuse staff storage prefixes. Child files go in their own bucket and key namespace.
4. Do not write child data anywhere until the Terms and Privacy Policy describe it.
