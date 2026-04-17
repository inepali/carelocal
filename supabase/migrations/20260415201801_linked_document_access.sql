-- Migration: Linked Document Access
-- Path: supabase/migrations/20260415201801_linked_document_access.sql

-- 1. Staff can manage their own documents (Vault)
drop policy if exists "Staff can manage their own documents" on public.staff_documents;
create policy "Staff can manage their own documents"
on public.staff_documents for all
using (staff_id = get_my_staff_id());

-- 2. Center admins can view documents assigned/linked to their center
drop policy if exists "Center admins can view linked staff documents" on public.staff_documents;
create policy "Center admins can view linked staff documents"
on public.staff_documents for select
using (
  exists (
    select 1
    from public.center_staff_document_status csds
    where csds.matched_document_id = public.staff_documents.id
    and csds.center_id in (select get_my_admin_centers())
  )
);
