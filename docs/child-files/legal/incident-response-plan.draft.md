# Security incident response plan (DRAFT)

**DRAFT for attorney review. Not legal advice.** Fill in the bracketed names and numbers, then run one tabletop
drill before Child Files holds real child data, and once a year after that.

## Why this exists
Once Child Files is live, CareLocal holds children's names, birth dates, health and custody records for each
center. Under G.S. 75-65, a business that only maintains the data must tell the data's owner **immediately after
discovering a breach**; the center (the owner) then notifies families and the Attorney General's Consumer
Protection Division.

## Who does what
| Role | Person | Backup |
|---|---|---|
| Incident lead (decides, owns the clock) | [name, phone] | [name, phone] |
| Technical lead (contain, investigate) | [name, phone] | [name, phone] |
| Communications (centers, families' questions) | [name, phone] | [name, phone] |
| Counsel | [firm, phone] | |

## 1. Detect and report
Anyone who suspects an incident tells the incident lead right away. Sources: an alert from a provider
(Supabase, Cloudflare, Vercel), a center or parent report, an odd entry in the document access log, a leaked key.
Write down the time it was **discovered** (that starts the clock).

## 2. Contain (first hour)
Do what applies, and record what was done and when:
- **Rotate the Supabase service-role key** and database passwords; redeploy.
- **Revoke the storage keys** (Cloudflare R2 access keys) and issue new ones.
- **Sign out all users** (revoke sessions); disable the affected accounts.
- Rotate Stripe, Resend and Twilio keys if they may be exposed.
- Turn off the affected feature (for example, parent upload links) while keeping other features running.
- **Preserve evidence**: export logs, the document access log and database audit data before changing anything else.

## 3. Assess (first day)
Answer, from the access log and database:
1. What data? (children, guardians, files, custody documents)
2. Which centers and **how many children and parents** per center?
3. Was data viewed or copied, or only exposed? Is it still exposed?
4. How did it happen, and is it fixed?

## 4. Tell the centers (immediately after discovery)
Do not wait for the assessment to finish. Email **and** phone each affected center's owner and administrators:
> **Subject: Security incident affecting your child records**
> We discovered on [date, time] that [what happened, in plain words]. It may affect [kinds of records] for
> [number or "an unknown number of"] children at your center. We have [what we did]. You should [what the center
> should do now]. We will update you every [X hours] and will send full details by [time]. Contact [name, phone].

Then give each center, as soon as known: the nature of the incident, the number of children and parents affected,
the date range, the steps taken to investigate and to prevent a repeat. **These are the same items the center must
give the Attorney General's Consumer Protection Division** (nature of the breach, number of consumers affected,
investigation, prevention, and timing, distribution and content of the notice), so send them in a form the center
can reuse. Offer a draft family notice that includes: a description of the incident, the data involved, protective
steps, and FTC and NC Attorney General contact information.

## 5. After
- Written report within [7 days]: timeline, cause, impact, what changed.
- Update this plan, the checklist for new code (every child-data action reviewed), and the tests.
- Counsel decides whether other notices apply (law enforcement hold, insurers, other states).
- Keep all records of the incident for [X years].

## Drill checklist (before launch)
- [ ] Contact list verified by phone, not just email
- [ ] Someone other than the technical lead can rotate every key listed in section 2
- [ ] A sample center notice was sent to yourself and read cold
- [ ] The document access log can answer "who viewed what in the last 30 days" in under an hour
