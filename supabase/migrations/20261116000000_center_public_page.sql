-- Public center page (/centers/<handle>): off until the center turns it on. The page itself is read on the
-- server with an explicit column list (see src/lib/server/public-center.ts), so no anonymous read rules
-- are needed. The handle is separate from centers.slug, which stays as it is for invite links.

ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS public_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_handle          text,
  ADD COLUMN IF NOT EXISTS public_description     text,
  ADD COLUMN IF NOT EXISTS public_show_phone      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_show_email      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_show_license    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_show_care_score boolean NOT NULL DEFAULT true;

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_public_handle_format;
ALTER TABLE public.centers ADD CONSTRAINT centers_public_handle_format
  CHECK (public_handle IS NULL OR (public_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(public_handle) BETWEEN 3 AND 60));

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_public_needs_handle;
ALTER TABLE public.centers ADD CONSTRAINT centers_public_needs_handle
  CHECK (NOT public_enabled OR public_handle IS NOT NULL);

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_public_description_length;
ALTER TABLE public.centers ADD CONSTRAINT centers_public_description_length
  CHECK (public_description IS NULL OR char_length(public_description) <= 1500);

CREATE UNIQUE INDEX IF NOT EXISTS centers_public_handle_key ON public.centers (public_handle) WHERE public_handle IS NOT NULL;
