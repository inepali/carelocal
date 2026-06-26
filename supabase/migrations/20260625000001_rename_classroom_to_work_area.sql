-- Rename classrooms table to work_areas if classrooms exists
ALTER TABLE IF EXISTS public.classrooms RENAME TO work_areas;

-- Rename foreign key column classroom_id to work_area_id in public.shifts if classroom_id exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'shifts' 
          AND column_name = 'classroom_id'
    ) THEN
        ALTER TABLE public.shifts RENAME COLUMN classroom_id TO work_area_id;
    END IF;
END $$;

-- Rename classroom_term to work_area_term in public.centers if classroom_term exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'centers' 
          AND column_name = 'classroom_term'
    ) THEN
        ALTER TABLE public.centers RENAME COLUMN classroom_term TO work_area_term;
    END IF;
END $$;
