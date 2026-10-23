-- Work areas (Classrooms, Care Areas ...) get an explicit order, like the other Manage Data lists.
-- Existing areas keep their current alphabetical order until a center rearranges them.
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

UPDATE public.work_areas w
SET sort_order = r.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY center_id ORDER BY lower(name), created_at) - 1 AS rn
  FROM public.work_areas
) r
WHERE w.id = r.id AND w.sort_order = 0;

CREATE INDEX IF NOT EXISTS work_areas_center_sort_idx ON public.work_areas (center_id, sort_order);
