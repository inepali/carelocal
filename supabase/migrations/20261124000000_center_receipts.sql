-- ============================================================
-- Purchase receipts: a center's owner and administrators keep a photo or PDF of each receipt,
-- optionally against a vendor, with the date and amount typed in by hand.
--  * Files live in the private receipts bucket (R2_RECEIPT_BUCKET) under receipts/<center id>/…,
--    opened only through short-lived signed links, and every open is written to document_access_log.
--  * Only the center's owner and administrators (can_view_confidential) can read or write them.
--  * Deleting a vendor keeps its receipts (the vendor link is cleared).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.center_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id    uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  vendor_id    uuid REFERENCES public.center_vendors(id) ON DELETE SET NULL,
  receipt_date date NOT NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount >= 0),
  notes        text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  file_key     text NOT NULL,
  bucket_name  text NOT NULL,
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  content_type text,
  size_bytes   integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_center_receipts_center_date ON public.center_receipts (center_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_center_receipts_vendor ON public.center_receipts (vendor_id) WHERE vendor_id IS NOT NULL;

ALTER TABLE public.center_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.center_receipts FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Owners and admins manage receipts" ON public.center_receipts;
CREATE POLICY "Owners and admins manage receipts"
  ON public.center_receipts FOR ALL TO authenticated
  USING (public.can_view_confidential(center_id))
  WITH CHECK (public.can_view_confidential(center_id));

-- A receipt's vendor must belong to the same center, and its file must sit in this center's receipts folder
CREATE OR REPLACE FUNCTION public.check_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prefix text := 'receipts/' || NEW.center_id || '/';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.center_id <> OLD.center_id THEN
    RAISE EXCEPTION 'A receipt cannot move to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM center_vendors v WHERE v.id = NEW.vendor_id AND v.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That vendor belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.file_key IS DISTINCT FROM OLD.file_key)
     AND left(NEW.file_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.check_receipt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_receipt ON public.center_receipts;
CREATE TRIGGER trg_check_receipt
  BEFORE INSERT OR UPDATE ON public.center_receipts
  FOR EACH ROW EXECUTE FUNCTION public.check_receipt();

DROP TRIGGER IF EXISTS set_updated_at ON public.center_receipts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.center_receipts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Phone uploads and the access log accept receipts
ALTER TABLE public.upload_handoffs DROP CONSTRAINT IF EXISTS upload_handoffs_kind_check;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT upload_handoffs_kind_check
  CHECK (kind IN ('internal', 'inspection', 'template', 'vault', 'receipt'));

ALTER TABLE public.document_access_log DROP CONSTRAINT IF EXISTS document_access_log_document_kind_check;
ALTER TABLE public.document_access_log ADD CONSTRAINT document_access_log_document_kind_check
  CHECK (document_kind IN ('vault', 'internal', 'template', 'inspection', 'offer_letter', 'child', 'receipt'));
