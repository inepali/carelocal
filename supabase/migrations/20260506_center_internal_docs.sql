ALTER TABLE public.center_document_requirements ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS public.center_internal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES public.center_document_requirements(id) ON DELETE SET NULL,
  document_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_key TEXT,
  bucket_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.center_internal_documents ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'center_internal_documents' AND policyname = 'Centers can manage their internal docs'
  ) THEN
    CREATE POLICY "Centers can manage their internal docs"
    ON public.center_internal_documents
    FOR ALL
    USING (
      center_id IN (
        SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()
      )
    )
    WITH CHECK (
      center_id IN (
        SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()
      )
    );
  END IF;
END $$;
