# Terms & Privacy changes for Child Files (DRAFT, do not publish yet)

**DRAFT for attorney review. Not legal advice.** The live pages currently say the opposite of what Child Files
does, so they must change **before any child data is stored**, and not before (the pages must describe what the
product really does). Apply these on the child care site only (`legalVocab(domain).childcare`), in
`src/app/terms/page.tsx` and `src/app/privacy/page.tsx`, then bump `LEGAL_UPDATED` in `src/lib/legal.ts` and
email existing users about the material change.

## What is wrong today
| Live text | Where | Problem |
|---|---|---|
| "Do not upload children's records or other health information about the people you care for." | Terms section 7 | Child Files exists to hold these |
| "We do not knowingly collect personal information directly from children under 13..." followed by tour-request wording only | Privacy section 6 | Still true for children directly, but incomplete: centers will store children's health and custody records |
| Information we collect: staff, centers, visitors, usage, notifications | Privacy section 2 | No children, parents, guardians or pick-up contacts |
| Sharing, retention | Privacy sections 4 and 5 | Nothing about who can see child records or how long they are kept |

## Terms: replace the second paragraph of section 7 (child care site)
> Child Files lets a Center keep its enrolled children's records. The Center decides what to collect and is
> responsible for telling parents, for keeping the records accurate (including custody and pick-up details) and
> for deleting them when the law no longer requires it to keep them. Do not upload more than a rule or the child's
> care requires. Child Records can be opened only by the Center's owner and administrators, and every document
> view is logged. How CareLocal handles Child Records for a Center is set out in the Child Records Data Addendum
> the Center accepts before using Child Files.

## Terms: add to section 3 (For Centers), child care site
> **Child Files.** You are responsible for your parents' notices and any consent you need, for who you promote to
> administrator (administrators can open child records), and for acting on the pick-up list you keep. You may not
> use Child Records for marketing, or share them, except as the law requires or the parent authorizes.

## Privacy: add to section 2, "Information We Collect" (child care site)
> **Children, parents and guardians (Child Files).** When a child care Center uses Child Files, it, or a parent it
> invites, adds information about enrolled or prospective children and their families: the child's name, date of
> birth and enrollment dates; parent, guardian and authorized pick-up contacts (names, phone, email, relationship);
> health, immunization, allergy and medical action plan information; custody or pick-up documents; permissions and
> signed forms; and uploaded files.

## Privacy: add to section 3, "How We Use Your Information"
> **Child Files.** Storing and tracking a Center's required child records, reminding the Center when records are
> due, and, if the Center chooses, letting a parent upload a document by a secure link.

## Privacy: add to section 4, "Sharing Your Information"
> **Child Records.** A Center's child records are visible only to that Center's owner and administrators. We do
> not sell them, share them for advertising, or show them to other centers or to staff who are not
> administrators. A parent who uploads through a secure link sends the file to that Center only. We use the service
> providers listed above to store and process them on the Center's behalf.

## Privacy: replace the child care paragraph of section 6, "Children's Information"
> Accounts on the Platform are for adults. We do not knowingly collect personal information directly from children
> under 13, and we do not allow children to create accounts. Separately, a child care Center that uses Child Files
> stores records about the children it cares for. **For those records the Center decides what is collected and how
> it is used, and we process them on the Center's behalf**; we do not use them for advertising or marketing. A
> parent who wants to see, correct or delete a child's record should ask the Center, which can act on it in the
> Platform; you may also contact us. When a tour request includes a child's name or birth date, it is shared only
> with that Center.

## Privacy: add to section 5, "Security & Data Retention"
> A Center's child records are kept while the child is enrolled and for 1 year afterward, which is the period North
> Carolina's child care rules require a center to keep them. After that, we flag them for deletion and the Center
> confirms it; deleting a record also deletes the stored file.

## Before publishing, confirm
- [ ] The Data Addendum is accepted in-app by the owner before Child Files can be switched on for a center.
- [ ] Every statement above is true on launch day (access limited to owner and admin; view log; the 1-year flag and Center-confirmed deletion job exist; parent upload exists if mentioned).
- [ ] Parent upload sentences are removed if Phase 2 is not live.
- [ ] Counsel has reviewed, including whether any state privacy law needs extra wording for children's data.
