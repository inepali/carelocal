-- Migration: Add file_key to staff_documents for R2 integration
ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS file_key text;
ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS bucket_name text DEFAULT 'employeeuploads';

-- Optional: Update existing records if any, though likely empty in dev
-- UPDATE staff_documents SET bucket_name = 'employeeuploads' WHERE bucket_name IS NULL;
