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
| RLS test harness | **Not started.** Runs against Care Local (dev); must refuse to run against carelocal-prod |
| Close the open rule questions | **Open.** See "Still not verified" in the rules file |

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
