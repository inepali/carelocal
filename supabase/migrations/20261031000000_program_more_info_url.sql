-- A link on each program that sends families to the center's own website or a specific page.
ALTER TABLE public.center_programs ADD COLUMN IF NOT EXISTS more_info_url text;

-- Only web links: the value is rendered as a clickable link
ALTER TABLE public.center_programs DROP CONSTRAINT IF EXISTS center_programs_more_info_url_check;
ALTER TABLE public.center_programs ADD CONSTRAINT center_programs_more_info_url_check
  CHECK (more_info_url IS NULL OR more_info_url ~* '^https?://');
