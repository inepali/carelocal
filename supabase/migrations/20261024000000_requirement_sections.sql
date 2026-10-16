-- Sections are no longer a fixed list:
--  * 'health_safety' becomes a built-in section (Health & Safety Training topics)
--  * centers can create their own sections: section = 'custom:<slug>', named by section_label
ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_section_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_section_check
  CHECK (section IN ('personnel', 'health', 'training', 'health_safety', 'policies', 'evaluations') OR section LIKE 'custom:%');

ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS section_label text;  -- display name for custom sections

-- Topics previously grouped under Training & Certifications move to their own section
UPDATE public.center_document_requirements
SET section = 'health_safety'
WHERE section = 'training' AND group_label = 'Health & Safety Training';
