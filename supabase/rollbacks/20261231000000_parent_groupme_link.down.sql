-- Rollback for 20261231000000_parent_groupme_link.sql (forgets each center's parents' GroupMe link)
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_parent_groupme_url_check;
ALTER TABLE public.centers DROP COLUMN IF EXISTS parent_groupme_url;
