-- Add 'interested' status to shift claims
-- This enables a two-step flow: Express Interest → Claim Shift → Assigned

ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'interested';
