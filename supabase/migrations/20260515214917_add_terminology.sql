ALTER TABLE centers ADD COLUMN IF NOT EXISTS staff_term text DEFAULT 'Staff';
ALTER TABLE centers ADD COLUMN IF NOT EXISTS classroom_term text DEFAULT 'Classrooms';