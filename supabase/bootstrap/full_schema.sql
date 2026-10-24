-- CareLocal full schema, rebuilt from the "postgres" database with scripts/local/extract-schema.cjs
-- Applied once to a brand-new project, after which every file in supabase/migrations is marked as applied.
-- Generated 2026-10-23. Do not edit by hand; regenerate instead.

SET check_function_bodies = off;
SET client_min_messages = warning;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- Enum types
CREATE TYPE public."center_staff_status" AS ENUM ('invited', 'active', 'inactive', 'removed', 'applying');
CREATE TYPE public."claim_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'interested');
CREATE TYPE public."doc_review_status" AS ENUM ('missing', 'pending_review', 'accepted', 'rejected', 'expired');
CREATE TYPE public."document_category" AS ENUM ('identity', 'certification', 'background', 'training', 'medical', 'other', 'documentation', 'academic_qualification');
CREATE TYPE public."notification_channel" AS ENUM ('sms', 'email', 'push');
CREATE TYPE public."notification_status" AS ENUM ('sent', 'delivered', 'failed', 'bounced');
CREATE TYPE public."shift_status" AS ENUM ('open', 'filled', 'cancelled', 'unfilled');
CREATE TYPE public."staff_type" AS ENUM ('teacher', 'floater', 'support', 'cook');
CREATE TYPE public."subscription_status" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');
CREATE TYPE public."subscription_tier" AS ENUM ('starter', 'growth', 'network', 'enterprise');

-- Tables
CREATE TABLE public."app_notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "type" text NOT NULL,
  "reference_id" uuid,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."center_about_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "title" text NOT NULL,
  "content" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_admins" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'admin'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_document_requirements" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "document_name" text NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL,
  "applies_to" text[],
  "notes" text,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "document_category" text DEFAULT 'other'::document_category NOT NULL,
  "template_file_key" text,
  "template_bucket_name" text DEFAULT 'centeruploads'::text,
  "template_file_name" text,
  "is_internal" boolean DEFAULT false,
  "applies_to_class" text[],
  "is_confidential" boolean DEFAULT false NOT NULL,
  "section" text DEFAULT 'personnel'::text NOT NULL,
  "evidence_type" text DEFAULT 'staff_document'::text NOT NULL,
  "due_within_days" integer,
  "renewal_type" text DEFAULT 'none'::text NOT NULL,
  "renewal_months" integer,
  "is_conditional" boolean DEFAULT false NOT NULL,
  "group_label" text,
  "template_key" text,
  "policy_version" integer DEFAULT 1 NOT NULL,
  "policy_updated_at" timestamp with time zone,
  "section_label" text,
  "audience" text DEFAULT 'staff'::text NOT NULL
);

CREATE TABLE public."center_inspection_files" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "inspection_id" uuid NOT NULL,
  "log_id" uuid,
  "file_name" text NOT NULL,
  "file_key" text NOT NULL,
  "bucket_name" text NOT NULL,
  "content_type" text,
  "size_bytes" integer,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_inspection_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "inspection_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "performed_on" date NOT NULL,
  "result" text,
  "vendor_id" uuid,
  "inspector_name" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_inspections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "inspection_type" text NOT NULL,
  "title" text,
  "interval_value" integer,
  "interval_unit" text,
  "last_inspection_date" date,
  "next_due_date" date,
  "last_result" text,
  "vendor_id" uuid,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_internal_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "requirement_id" uuid,
  "document_name" text NOT NULL,
  "file_url" text NOT NULL,
  "file_key" text,
  "bucket_name" text,
  "uploaded_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  "future_review_date" date,
  "source_document_id" uuid,
  "is_confidential" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."center_lookups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid,
  "group_name" character varying NOT NULL,
  "label" character varying NOT NULL,
  "value" character varying,
  "is_active" boolean DEFAULT true,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "domain_key" text DEFAULT 'childcare'::text NOT NULL
);

CREATE TABLE public."center_programs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "name" text NOT NULL,
  "age_range" text,
  "schedule" text,
  "capacity" integer,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "more_info_url" text
);

CREATE TABLE public."center_staff" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "status" center_staff_status DEFAULT 'invited'::center_staff_status NOT NULL,
  "is_preferred" boolean DEFAULT false,
  "invite_token" text,
  "invite_expires_at" timestamp with time zone,
  "added_by" uuid,
  "notes" text,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "employment_class" text DEFAULT 'substitute'::text NOT NULL,
  "employment_start_date" date,
  "requested_employment_class" text
);

CREATE TABLE public."center_staff_document_status" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "requirement_id" uuid NOT NULL,
  "matched_document_id" uuid,
  "status" doc_review_status DEFAULT 'missing'::doc_review_status NOT NULL,
  "center_reviewed" boolean DEFAULT false,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_on" date,
  "hours" numeric(5,1),
  "expires_on" date,
  "not_applicable" boolean DEFAULT false NOT NULL,
  "not_applicable_reason" text,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_version" integer,
  "acknowledged_signature" text,
  "due_on" date
);

CREATE TABLE public."center_team_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "name" text NOT NULL,
  "title" text,
  "bio" text,
  "email" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "role" text
);

CREATE TABLE public."center_tour_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "contact_time" text,
  "tour_type" text DEFAULT 'in_person'::text NOT NULL,
  "preferred_date" date,
  "preferred_time" text,
  "alternate_times" text,
  "children" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "start_date" date,
  "first_group_care" boolean,
  "topics" text[] DEFAULT '{}'::text[] NOT NULL,
  "message" text,
  "status" text DEFAULT 'new'::text NOT NULL,
  "confirmed_date" date,
  "confirmed_time" text,
  "center_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."center_vendors" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "name" text NOT NULL,
  "service_type" text,
  "contact_name" text,
  "phone" text,
  "email" text,
  "website" text,
  "address" text,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."centers" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "city" text DEFAULT 'Charlotte'::text NOT NULL,
  "state" text DEFAULT 'NC'::text NOT NULL,
  "zip" text,
  "phone" text,
  "email" text,
  "director_name" text,
  "license_number" text,
  "max_capacity" integer,
  "logo_url" text,
  "subscription_tier" subscription_tier DEFAULT 'starter'::subscription_tier NOT NULL,
  "subscription_status" subscription_status DEFAULT 'trialing'::subscription_status NOT NULL,
  "stripe_customer_id" text,
  "trial_ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metro_area_id" uuid,
  "timezone" text,
  "trial_months" integer DEFAULT 3,
  "staff_term" text DEFAULT 'Staff'::text,
  "work_area_term" text DEFAULT 'Classrooms'::text,
  "domain_key" text DEFAULT 'childcare'::text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "jobs_enabled" boolean DEFAULT false NOT NULL,
  "public_enabled" boolean DEFAULT false NOT NULL,
  "public_handle" text,
  "public_description" text,
  "public_show_phone" boolean DEFAULT true NOT NULL,
  "public_show_email" boolean DEFAULT true NOT NULL,
  "public_show_license" boolean DEFAULT true NOT NULL,
  "public_show_care_score" boolean DEFAULT true NOT NULL,
  "public_tours_enabled" boolean DEFAULT true NOT NULL,
  "public_show_capacity" boolean DEFAULT true NOT NULL,
  "child_files_enabled" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."child_audit_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "table_name" text NOT NULL,
  "row_id" uuid,
  "action" text NOT NULL,
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
  "summary" text
);

CREATE TABLE public."child_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "requirement_id" uuid NOT NULL,
  "status" doc_review_status DEFAULT 'missing'::doc_review_status NOT NULL,
  "completed_on" date,
  "expires_on" date,
  "due_on" date,
  "not_applicable" boolean DEFAULT false NOT NULL,
  "not_applicable_reason" text,
  "acknowledged_version" integer,
  "review_notes" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."child_files" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "requirement_id" uuid,
  "file_key" text NOT NULL,
  "bucket_name" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text,
  "size_bytes" integer,
  "source" text DEFAULT 'center'::text NOT NULL,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."child_guardians" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "name" text NOT NULL,
  "relationship" text,
  "phone" text,
  "email" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "is_emergency_contact" boolean DEFAULT false NOT NULL,
  "can_pick_up" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."children" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "preferred_name" text,
  "date_of_birth" date NOT NULL,
  "classroom_id" uuid,
  "status" text DEFAULT 'enrolled'::text NOT NULL,
  "enrolled_on" date DEFAULT CURRENT_DATE NOT NULL,
  "first_attended_on" date,
  "withdrawn_on" date,
  "immunization_status" text DEFAULT 'missing'::text NOT NULL,
  "custody_restriction" boolean DEFAULT false NOT NULL,
  "custody_note" text,
  "source_tour_request_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."document_access_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_kind" text NOT NULL,
  "document_id" uuid NOT NULL,
  "center_id" uuid,
  "staff_id" uuid,
  "is_confidential" boolean DEFAULT false NOT NULL,
  "action" text DEFAULT 'view'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "child_id" uuid
);

CREATE TABLE public."document_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "requirement_id" uuid,
  "title" text NOT NULL,
  "message" text,
  "due_date" date,
  "is_confidential" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "submitted_document_id" uuid,
  "submitted_at" timestamp with time zone,
  "staff_note" text,
  "center_note" text,
  "requested_by" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."job_alerts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL,
  "city" text,
  "state" text,
  "role_value" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."job_application_documents" (
  "application_id" uuid NOT NULL,
  "requirement_id" uuid NOT NULL,
  "document_id" uuid,
  "expiry_at_apply" date,
  "shared_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."job_application_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "actor_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."job_applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "center_staff_id" uuid NOT NULL,
  "stage" text DEFAULT 'applied'::text NOT NULL,
  "cover_note" text,
  "resume_document_id" uuid,
  "readiness" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "offer_start_date" date,
  "offer_pay" numeric(8,2),
  "offer_note" text,
  "offer_sent_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "interview_at" timestamp with time zone,
  "interview_location" text,
  "interview_note" text,
  "offer_letter_file_key" text,
  "offer_letter_bucket_name" text,
  "offer_letter_file_name" text,
  "offer_letter_viewed_at" timestamp with time zone
);

CREATE TABLE public."job_posting_requirements" (
  "job_id" uuid NOT NULL,
  "requirement_id" uuid NOT NULL,
  "needed_at" text DEFAULT 'apply'::text NOT NULL
);

CREATE TABLE public."job_postings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "domain_key" text DEFAULT 'childcare'::text NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "role_value" text,
  "employment_type" text NOT NULL,
  "description" text NOT NULL,
  "schedule_summary" text,
  "hours_per_week" numeric(4,1),
  "pay_min" numeric(8,2),
  "pay_max" numeric(8,2),
  "pay_unit" text DEFAULT 'hour'::text NOT NULL,
  "benefits" text[] DEFAULT '{}'::text[] NOT NULL,
  "start_date" date,
  "openings" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "published_at" timestamp with time zone,
  "closes_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "alerts_sent_at" timestamp with time zone
);

CREATE TABLE public."metro_areas" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "state_code" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "timezone" text,
  "city" text,
  "staff_maintenance_fee" numeric(10,2) DEFAULT 0.00 NOT NULL
);

CREATE TABLE public."native_push_tokens" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token" text NOT NULL,
  "platform" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."notification_preferences" (
  "user_id" uuid NOT NULL,
  "email_enabled" boolean DEFAULT true NOT NULL,
  "sms_enabled" boolean DEFAULT false NOT NULL,
  "app_enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."notifications" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid,
  "shift_id" uuid,
  "staff_id" uuid,
  "channel" notification_channel NOT NULL,
  "subject" text,
  "body" text,
  "status" notification_status DEFAULT 'sent'::notification_status NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone,
  "error_message" text
);

CREATE TABLE public."push_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."requirement_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "domain_key" text DEFAULT 'childcare'::text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_center_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."shift_claims" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "shift_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "status" claim_status DEFAULT 'pending'::claim_status NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_by" uuid,
  "confirmed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "check_in_time" timestamp with time zone,
  "check_out_time" timestamp with time zone
);

CREATE TABLE public."shift_reviews" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "shift_id" uuid NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "reviewee_id" uuid NOT NULL,
  "reviewer_type" text NOT NULL,
  "rating" integer NOT NULL,
  "punctual" boolean,
  "tags" text[] DEFAULT '{}'::text[],
  "public_comment" text,
  "private_feedback" text,
  "do_not_return" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."shifts" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "work_area_id" uuid,
  "shift_date" date NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "staff_type_needed" text,
  "require_docs_complete" boolean DEFAULT false,
  "status" shift_status DEFAULT 'open'::shift_status NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "hourly_rate" numeric(10,2),
  "payment_mode" text,
  "is_archived" boolean DEFAULT false
);

CREATE TABLE public."staff_credentials" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL,
  "credential_name" text NOT NULL,
  "issuing_body" text,
  "credential_number" text,
  "issue_date" date,
  "expiry_date" date,
  "linked_document_id" uuid,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."staff_documents" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "staff_id" uuid NOT NULL,
  "document_name" text NOT NULL,
  "document_category" text DEFAULT 'other'::document_category NOT NULL,
  "issued_date" date,
  "expiry_date" date,
  "file_url" text NOT NULL,
  "file_name" text,
  "file_size_bytes" bigint,
  "notes" text,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "file_key" text,
  "bucket_name" text DEFAULT 'employeeuploads'::text
);

CREATE TABLE public."staff_experiences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL,
  "employer" text NOT NULL,
  "role" text NOT NULL,
  "age_group" text,
  "start_month" integer,
  "start_year" integer,
  "end_month" integer,
  "end_year" integer,
  "is_current" boolean DEFAULT false,
  "description" text,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."staff_profiles" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "user_id" uuid NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "phone" text,
  "email" text NOT NULL,
  "city" text,
  "state" text,
  "zip" text,
  "staff_type" text,
  "bio" text,
  "available_days" text[] DEFAULT '{}'::text[],
  "available_from" time without time zone,
  "available_to" time without time zone,
  "avatar_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metro_area_id" uuid,
  "availability_notes" text,
  "preferred_payment_methods" text[] DEFAULT '{}'::text[] NOT NULL,
  "balance_due" numeric(10,2) DEFAULT 0.00 NOT NULL,
  "domain_key" text DEFAULT 'childcare'::text NOT NULL,
  "requested_employment_class" text
);

CREATE TABLE public."staff_references" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "business" text NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."staff_role_types" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."subscriptions" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "tier" subscription_tier NOT NULL,
  "status" subscription_status NOT NULL,
  "stripe_subscription_id" text,
  "stripe_price_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."support_tickets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "created_by" uuid,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."upload_handoffs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "center_id" uuid,
  "staff_id" uuid,
  "requirement_id" uuid,
  "created_by" uuid,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "file_key" text,
  "file_name" text,
  "content_type" text,
  "size_bytes" integer,
  "upload_attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "kind" text DEFAULT 'internal'::text NOT NULL,
  "label" text
);

CREATE TABLE public."user_notification_settings" (
  "user_id" uuid NOT NULL,
  "email_enabled" boolean DEFAULT true NOT NULL,
  "sms_enabled" boolean DEFAULT false NOT NULL,
  "app_enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public."work_areas" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "center_id" uuid NOT NULL,
  "name" text NOT NULL,
  "age_group" text,
  "capacity" integer,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);

-- Functions
CREATE OR REPLACE FUNCTION public.accept_job_offer(p_app_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
  v_job job_postings%ROWTYPE;
  v_other_centers text;
  v_hired integer;
  v_filled boolean := false;
  v_withdrawn uuid[];
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage <> 'offer' THEN
    RAISE EXCEPTION 'There is no open offer on this application' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_job FROM job_postings WHERE id = v_app.job_id FOR UPDATE;

  -- A regular works at one center: active links elsewhere must end first
  SELECT string_agg(c.name, ', ') INTO v_other_centers
  FROM center_staff cs JOIN centers c ON c.id = cs.center_id
  WHERE cs.staff_id = v_app.staff_id AND cs.center_id <> v_app.center_id AND cs.status::text IN ('active', 'inactive');
  IF v_other_centers IS NOT NULL THEN
    RAISE EXCEPTION 'Before accepting, leave your other center(s) from My Centers: %', v_other_centers
      USING ERRCODE = 'check_violation';
  END IF;

  -- The hire (the guards honour this flag for the rest of the transaction only)
  PERFORM set_config('carelocal.hiring', 'on', true);
  UPDATE center_staff
  SET status = 'active', employment_class = 'regular', requested_employment_class = 'regular',
      employment_start_date = COALESCE(v_app.offer_start_date, v_job.start_date, current_date)
  WHERE id = v_app.center_staff_id;

  PERFORM set_config('carelocal.stage_note', 'Offer accepted', true);
  UPDATE job_applications SET stage = 'hired', decided_at = now() WHERE id = p_app_id;

  -- Other open applications close; their applying links end on the usual 30-day rule
  PERFORM set_config('carelocal.stage_note', 'Withdrawn automatically: hired elsewhere', true);
  WITH closed AS (
    UPDATE job_applications SET stage = 'withdrawn', decided_at = now()
    WHERE staff_id = v_app.staff_id AND id <> p_app_id AND stage IN ('applied', 'reviewing', 'interview', 'offer')
    RETURNING id
  )
  SELECT array_agg(id) INTO v_withdrawn FROM closed;

  -- Start-stage items become requests
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, is_confidential, requested_by)
  SELECT v_app.center_id, v_app.staff_id, r.id, r.document_name, r.is_confidential, v_job.created_by
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'start'
    AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = r.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable))
    AND NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = v_app.staff_id AND dr.requirement_id = r.id AND dr.status IN ('open', 'submitted'));

  -- Fill the job when its openings are hired
  SELECT count(*) INTO v_hired FROM job_applications WHERE job_id = v_app.job_id AND stage = 'hired';
  IF v_hired >= v_job.openings AND v_job.status <> 'filled' THEN
    UPDATE job_postings SET status = 'filled' WHERE id = v_job.id;
    v_filled := true;
  END IF;

  RETURN jsonb_build_object(
    'center_id', v_app.center_id, 'staff_id', v_app.staff_id, 'job_id', v_app.job_id,
    'filled', v_filled, 'withdrawn_application_ids', COALESCE(to_jsonb(v_withdrawn), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_requirement(p_requirement_id uuid, p_signature text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req record;
  v_staff_id uuid;
BEGIN
  IF coalesce(trim(p_signature), '') = '' THEN
    RAISE EXCEPTION 'Type your full name to sign' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, center_id, evidence_type, policy_version INTO v_req
  FROM center_document_requirements WHERE id = p_requirement_id;
  IF v_req.id IS NULL OR v_req.evidence_type <> 'acknowledgement' THEN
    RAISE EXCEPTION 'This item cannot be acknowledged' USING ERRCODE = 'check_violation';
  END IF;

  SELECT cs.staff_id INTO v_staff_id
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE cs.center_id = v_req.center_id AND sp.user_id = auth.uid() AND cs.status::text <> 'removed';
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You are not an employee of this center' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('app.trusted_status_write', 'on', true);

  INSERT INTO center_staff_document_status AS s (
    center_id, staff_id, requirement_id, status, center_reviewed, completed_on,
    acknowledged_at, acknowledged_version, acknowledged_signature
  ) VALUES (
    v_req.center_id, v_staff_id, v_req.id, 'accepted', false, current_date,
    now(), v_req.policy_version, trim(p_signature)
  )
  ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE SET
    status = 'accepted',
    completed_on = current_date,
    acknowledged_at = now(),
    acknowledged_version = EXCLUDED.acknowledged_version,
    acknowledged_signature = EXCLUDED.acknowledged_signature,
    not_applicable = false;

  PERFORM set_config('app.trusted_status_write', 'off', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_can_see_staff(p_staff_id uuid, p_active_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.center_staff cs
    JOIN public.center_admins ca ON ca.center_id = cs.center_id
    WHERE cs.staff_id = p_staff_id
      AND ca.user_id = auth.uid()
      AND (cs.status::text = 'active' OR (NOT p_active_only AND cs.status::text IN ('invited', 'applying')))
  );
$function$;

CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_cover_note text, p_items jsonb, p_resume_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id uuid;
  v_job job_postings%ROWTYPE;
  v_cs center_staff%ROWTYPE;
  v_app_id uuid;
  v_existing job_applications%ROWTYPE;
  v_req record;
  v_doc_id uuid;
  v_missing text[] := '{}';
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Only staff members can apply' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_job FROM job_postings WHERE id = p_job_id;
  IF v_job.id IS NULL OR v_job.status <> 'published' THEN
    RAISE EXCEPTION 'This job is not accepting applications' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.job_center_in_my_metro(v_job.center_id) THEN
    RAISE EXCEPTION 'This job is not available in your metro area' USING ERRCODE = 'check_violation';
  END IF;

  IF p_resume_document_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM staff_documents WHERE id = p_resume_document_id AND staff_id = v_staff_id AND document_category = 'resume'
  ) THEN
    RAISE EXCEPTION 'Add your resume to apply' USING ERRCODE = 'check_violation';
  END IF;

  -- Every "apply" item needs a document from the applicant's vault, or a record the center already has
  FOR v_req IN
    SELECT r.id, r.document_name FROM job_posting_requirements jr
    JOIN center_document_requirements r ON r.id = jr.requirement_id
    WHERE jr.job_id = p_job_id AND jr.needed_at = 'apply'
  LOOP
    v_doc_id := NULL;
    SELECT (i ->> 'document_id')::uuid INTO v_doc_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
    WHERE (i ->> 'requirement_id')::uuid = v_req.id LIMIT 1;

    IF v_doc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_documents WHERE id = v_doc_id AND staff_id = v_staff_id) THEN
      RAISE EXCEPTION 'Choose documents from your own library' USING ERRCODE = 'check_violation';
    END IF;

    IF v_doc_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable)
    ) THEN
      v_missing := v_missing || v_req.document_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Still needed to apply: %', array_to_string(v_missing, ', ') USING ERRCODE = 'check_violation';
  END IF;

  -- The applicant's link to the center: reuse it (never downgrade an active row) or create it
  SELECT * INTO v_cs FROM center_staff WHERE center_id = v_job.center_id AND staff_id = v_staff_id;
  IF v_cs.id IS NULL THEN
    INSERT INTO center_staff (center_id, staff_id, status, requested_employment_class)
    VALUES (v_job.center_id, v_staff_id, 'applying', 'regular')
    RETURNING * INTO v_cs;
  ELSIF v_cs.status::text IN ('removed', 'inactive') THEN
    UPDATE center_staff SET status = 'applying', requested_employment_class = 'regular' WHERE id = v_cs.id RETURNING * INTO v_cs;
  ELSIF v_cs.status::text IN ('applying', 'invited') THEN
    UPDATE center_staff SET requested_employment_class = 'regular' WHERE id = v_cs.id RETURNING * INTO v_cs;
  END IF;

  -- One application per job; a withdrawn one can be submitted again
  SELECT * INTO v_existing FROM job_applications WHERE job_id = p_job_id AND staff_id = v_staff_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.stage <> 'withdrawn' THEN
      RAISE EXCEPTION 'You have already applied for this job' USING ERRCODE = 'unique_violation';
    END IF;
    DELETE FROM job_application_documents WHERE application_id = v_existing.id;
    PERFORM set_config('carelocal.stage_note', 'Applied again', true);
    UPDATE job_applications SET stage = 'applied', cover_note = NULLIF(trim(COALESCE(p_cover_note, '')), ''),
      resume_document_id = p_resume_document_id, center_staff_id = v_cs.id, applied_at = now(), decided_at = NULL,
      offer_start_date = NULL, offer_pay = NULL, offer_note = NULL, offer_sent_at = NULL, readiness = '{}'
    WHERE id = v_existing.id;
    v_app_id := v_existing.id;
  ELSE
    INSERT INTO job_applications (job_id, center_id, staff_id, center_staff_id, cover_note, resume_document_id)
    VALUES (p_job_id, v_job.center_id, v_staff_id, v_cs.id, NULLIF(trim(COALESCE(p_cover_note, '')), ''), p_resume_document_id)
    RETURNING id INTO v_app_id;
  END IF;

  -- Share documents for the job's items only; never relink an item already accepted or in review
  FOR v_req IN
    SELECT jr.requirement_id, (i ->> 'document_id')::uuid AS document_id
    FROM job_posting_requirements jr
    LEFT JOIN LATERAL (
      SELECT i FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
      WHERE (i ->> 'requirement_id')::uuid = jr.requirement_id LIMIT 1
    ) x ON true
    WHERE jr.job_id = p_job_id
  LOOP
    IF v_req.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM staff_documents WHERE id = v_req.document_id AND staff_id = v_staff_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM center_staff_document_status s
        WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.requirement_id
          AND s.status::text IN ('accepted', 'pending_review')
      ) THEN
        INSERT INTO center_staff_document_status (center_id, staff_id, requirement_id, matched_document_id, status, center_reviewed)
        VALUES (v_job.center_id, v_staff_id, v_req.requirement_id, v_req.document_id, 'pending_review', false)
        ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE
          SET matched_document_id = EXCLUDED.matched_document_id, status = 'pending_review', center_reviewed = false;
      END IF;
      INSERT INTO job_application_documents (application_id, requirement_id, document_id, expiry_at_apply)
      SELECT v_app_id, v_req.requirement_id, d.id, d.expiry_date FROM staff_documents d WHERE d.id = v_req.document_id
      ON CONFLICT (application_id, requirement_id) DO NOTHING;
    ELSE
      -- Already on file at this center: record what was used
      INSERT INTO job_application_documents (application_id, requirement_id, document_id, expiry_at_apply)
      SELECT v_app_id, v_req.requirement_id, s.matched_document_id, d.expiry_date
      FROM center_staff_document_status s LEFT JOIN staff_documents d ON d.id = s.matched_document_id
      WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.requirement_id
        AND s.matched_document_id IS NOT NULL
      ON CONFLICT (application_id, requirement_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_app_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_unfilled_shifts()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  updated_count integer;
BEGIN
  WITH updated AS (
    UPDATE shifts
    SET status = 'unfilled', is_archived = true
    WHERE status = 'open'
      AND (
        -- If the shift_date was before today (in Eastern Time)
        shift_date < (timezone('America/New_York', now())::date)
        OR
        -- If the shift_date is today, and the current time is 12:00 PM or later in Eastern Time
        (
          shift_date = (timezone('America/New_York', now())::date)
          AND
          extract(hour from timezone('America/New_York', now())) >= 12
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO updated_count FROM updated;
  
  RETURN updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_use_child_files(p_center_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.can_view_confidential(p_center_id)
     AND COALESCE((SELECT c.child_files_enabled FROM centers c WHERE c.id = p_center_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_view_confidential(p_center_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM center_admins
    WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.cancel_claims_on_regular_employment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.employment_class = 'regular' AND OLD.employment_class IS DISTINCT FROM 'regular' THEN
    UPDATE shift_claims sc
    SET status = 'cancelled'
    FROM shifts s
    WHERE sc.shift_id = s.id
      AND s.center_id = NEW.center_id
      AND sc.staff_id = NEW.staff_id
      AND sc.status::text IN ('pending', 'interested');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_child_file_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prefix text := 'child/' || NEW.center_id || '/' || NEW.child_id || '/';
BEGIN
  IF left(NEW.file_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.check_child_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_audience text; v_center uuid;
BEGIN
  IF NEW.requirement_id IS NULL THEN RETURN NEW; END IF;
  SELECT audience, center_id INTO v_audience, v_center FROM center_document_requirements WHERE id = NEW.requirement_id;
  IF v_audience IS DISTINCT FROM 'child' OR v_center IS DISTINCT FROM NEW.center_id THEN
    RAISE EXCEPTION 'That is not a child requirement of this center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.check_inspection_center_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.center_vendors v WHERE v.id = NEW.vendor_id AND v.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'Vendor does not belong to this center';
  END IF;

  IF TG_TABLE_NAME = 'center_inspection_logs' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.center_inspections i WHERE i.id = NEW.inspection_id AND i.center_id = NEW.center_id
    ) THEN
      RAISE EXCEPTION 'Inspection does not belong to this center';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_inspection_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM center_inspections WHERE id = NEW.inspection_id AND center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'Inspection does not belong to this center';
  END IF;
  IF NEW.log_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM center_inspection_logs WHERE id = NEW.log_id AND inspection_id = NEW.inspection_id
  ) THEN
    RAISE EXCEPTION 'History entry does not belong to this inspection';
  END IF;
  IF auth.uid() IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.file_key IS DISTINCT FROM OLD.file_key)
     AND left(NEW.file_key, length('inspection/' || NEW.center_id || '/')) <> 'inspection/' || NEW.center_id || '/' THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.child_limit(p_center_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN c.subscription_status::text = 'trialing' THEN NULL
    WHEN c.subscription_tier::text = 'starter' THEN 25
    ELSE NULL
  END FROM centers c WHERE c.id = p_center_id;
$function$;

CREATE OR REPLACE FUNCTION public.create_document_requests(p_center_id uuid, p_staff_ids uuid[], p_requirement_id uuid, p_title text, p_message text, p_due_date date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_confidential boolean := false;
BEGIN
  IF NOT public.is_center_admin(p_center_id) THEN
    RAISE EXCEPTION 'Only center admins can request documents' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_requirement_id IS NOT NULL THEN
    SELECT coalesce(v_title, document_name), is_confidential INTO v_title, v_confidential
    FROM center_document_requirements WHERE id = p_requirement_id AND center_id = p_center_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checklist item not found' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Describe the document you are requesting' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, message, due_date, is_confidential, requested_by)
  SELECT p_center_id, cs.staff_id, p_requirement_id, v_title, nullif(trim(coalesce(p_message, '')), ''), p_due_date, v_confidential, auth.uid()
  FROM center_staff cs
  WHERE cs.center_id = p_center_id
    AND cs.staff_id = ANY (p_staff_ids)
    AND cs.status::text NOT IN ('removed', 'inactive')
    AND NOT public.is_own_staff(cs.staff_id)
    AND (p_requirement_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = cs.staff_id AND dr.requirement_id = p_requirement_id AND dr.status IN ('open', 'submitted')
    ))
  RETURNING id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_job_offer(p_app_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage <> 'offer' THEN
    RAISE EXCEPTION 'There is no open offer on this application' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('carelocal.stage_note', COALESCE('Offer declined: ' || NULLIF(trim(COALESCE(p_note, '')), ''), 'Offer declined'), true);
  UPDATE job_applications SET stage = 'withdrawn', decided_at = now() WHERE id = p_app_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_child_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_limit integer;
BEGIN
  IF NEW.status = 'enrolled' AND (TG_OP = 'INSERT' OR OLD.status <> 'enrolled') THEN
    v_limit := public.child_limit(NEW.center_id);
    IF v_limit IS NOT NULL AND (
      SELECT count(*) FROM children WHERE center_id = NEW.center_id AND status = 'enrolled' AND id <> NEW.id
    ) >= v_limit THEN
      RAISE EXCEPTION 'Your plan includes up to % enrolled children. Upgrade to enroll more.', v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_document_key_namespace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_prefix text;
  v_alt_prefix text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / server jobs

  IF TG_TABLE_NAME = 'staff_documents' THEN
    v_key := NEW.file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.file_key THEN RETURN NEW; END IF;
    SELECT 'vault/' || user_id || '/' INTO v_prefix FROM staff_profiles WHERE id = NEW.staff_id;
  ELSIF TG_TABLE_NAME = 'center_internal_documents' THEN
    v_key := NEW.file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.file_key THEN RETURN NEW; END IF;
    v_prefix := 'internal/' || NEW.center_id || '/';
    v_alt_prefix := 'employee_files/' || NEW.center_id || '/';
  ELSE -- center_document_requirements
    v_key := NEW.template_file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.template_file_key THEN RETURN NEW; END IF;
    v_prefix := 'template/' || NEW.center_id || '/';
  END IF;

  IF v_key IS NOT NULL
     AND (v_prefix IS NULL OR left(v_key, length(v_prefix)) <> v_prefix)
     AND (v_alt_prefix IS NULL OR left(v_key, length(v_alt_prefix)) <> v_alt_prefix) THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_regular_single_center()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'removed' THEN
    RETURN NEW;
  END IF;

  -- Joining (becoming active or inactive) while a regular employee elsewhere
  IF NEW.status::text IN ('active', 'inactive')
     AND (TG_OP = 'INSERT' OR OLD.status::text NOT IN ('active', 'inactive'))
     AND EXISTS (
       SELECT 1 FROM center_staff
       WHERE staff_id = NEW.staff_id
         AND center_id <> NEW.center_id
         AND employment_class = 'regular'
         AND status::text IN ('active', 'inactive')
     ) THEN
    RAISE EXCEPTION 'This staff member is a regular employee at another center and must leave it before joining another one'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Becoming regular while associated with another center
  IF NEW.employment_class = 'regular'
     AND (TG_OP = 'INSERT' OR OLD.employment_class IS DISTINCT FROM 'regular')
     AND EXISTS (
       SELECT 1 FROM center_staff
       WHERE staff_id = NEW.staff_id
         AND center_id <> NEW.center_id
         AND status::text NOT IN ('removed', 'applying', 'invited')
     ) THEN
    RAISE EXCEPTION 'This staff member is associated with other centers and cannot become a regular employee here until they leave them'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_centers()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select center_id from center_admins where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_claimed_shift_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sc.shift_id
  FROM public.shift_claims sc
  JOIN public.staff_profiles sp ON sc.staff_id = sp.id
  WHERE sp.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_staff_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from staff_profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_user_assigned_shifts(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT shift_id 
  FROM shift_claims 
  WHERE staff_id = (SELECT id FROM staff_profiles WHERE user_id = p_user_id LIMIT 1)
    AND status = 'confirmed';
$function$;

CREATE OR REPLACE FUNCTION public.get_user_claimed_shifts(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT shift_id 
  FROM shift_claims 
  WHERE staff_id = (SELECT id FROM staff_profiles WHERE user_id = p_user_id LIMIT 1);
$function$;

CREATE OR REPLACE FUNCTION public.get_user_regular_centers(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT cs.center_id
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE sp.user_id = p_user_id
    AND cs.employment_class = 'regular';
$function$;

CREATE OR REPLACE FUNCTION public.guard_account_active_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / server-side jobs
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.is_active := OLD.is_active;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_center_staff_employment_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.hiring_in_progress() THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id)
     AND NOT public.is_own_staff(NEW.staff_id) THEN
    IF TG_OP = 'INSERT' AND NEW.employment_start_date IS NULL THEN
      NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.employment_class := 'substitute';
    NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
  ELSE
    NEW.employment_class := OLD.employment_class;
    NEW.employment_start_date := OLD.employment_start_date;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_center_staff_self_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.hiring_in_progress() THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text NOT IN ('invited', 'applying') THEN
      NEW.status := 'applying';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'active' THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_child_files_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.child_files_enabled IS NOT DISTINCT FROM OLD.child_files_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.child_files_enabled := OLD.child_files_enabled;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_child_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.center_id <> OLD.center_id THEN
    RAISE EXCEPTION 'A child cannot move to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.classroom_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_areas w WHERE w.id = NEW.classroom_id AND w.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That classroom belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_document_status_admin_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('app.trusted_status_write', true) = 'on'
     OR (public.is_center_admin(NEW.center_id) AND NOT public.is_own_staff(NEW.staff_id)) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending_review';
  NEW.center_reviewed := false;

  IF TG_OP = 'INSERT' THEN
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_notes := NULL;
    NEW.completed_on := NULL;
    NEW.hours := NULL;
    NEW.expires_on := NULL;
    NEW.due_on := NULL;
    NEW.not_applicable := false;
    NEW.not_applicable_reason := NULL;
    NEW.acknowledged_at := NULL;
    NEW.acknowledged_version := NULL;
    NEW.acknowledged_signature := NULL;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_notes := OLD.review_notes;
    NEW.completed_on := OLD.completed_on;
    NEW.hours := OLD.hours;
    NEW.expires_on := OLD.expires_on;
    NEW.due_on := OLD.due_on;
    NEW.not_applicable := OLD.not_applicable;
    NEW.not_applicable_reason := OLD.not_applicable_reason;
    NEW.acknowledged_at := OLD.acknowledged_at;
    NEW.acknowledged_version := OLD.acknowledged_version;
    NEW.acknowledged_signature := OLD.acknowledged_signature;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_job_offer_letter()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stage = 'hired' AND OLD.stage = 'offer'
     AND NEW.offer_letter_file_key IS NOT NULL AND NEW.offer_letter_viewed_at IS NULL THEN
    RAISE EXCEPTION 'Open and review the offer letter before accepting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.stage = 'applied' AND OLD.stage <> 'applied' THEN
    NEW.offer_letter_file_key := NULL;
    NEW.offer_letter_bucket_name := NULL;
    NEW.offer_letter_file_name := NULL;
    NEW.offer_letter_viewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_job_posting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_center centers%ROWTYPE;
  v_limit integer;
  v_active integer;
BEGIN
  SELECT * INTO v_center FROM centers WHERE id = NEW.center_id;
  IF TG_OP = 'INSERT' THEN
    NEW.domain_key := COALESCE(v_center.domain_key, NEW.domain_key);
    IF NOT COALESCE(v_center.jobs_enabled, false) THEN
      RAISE EXCEPTION 'Job postings are not enabled for this center yet' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.center_id := OLD.center_id;                  -- a posting never moves between centers
  END IF;

  -- "filled" only comes from a hire
  IF NEW.status = 'filled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'filled') AND NOT public.hiring_in_progress() THEN
    RAISE EXCEPTION 'A job is marked filled automatically when its openings are hired' USING ERRCODE = 'check_violation';
  END IF;

  -- Publishing (paused -> published does not add an active posting)
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('published', 'paused')) THEN
    IF v_center.subscription_status::text = 'past_due' THEN
      RAISE EXCEPTION 'Your subscription is past due. Update billing to publish new jobs.' USING ERRCODE = 'check_violation';
    END IF;
    v_limit := public.job_post_limit(NEW.center_id);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_active FROM job_postings
      WHERE center_id = NEW.center_id AND status IN ('published', 'paused') AND id <> NEW.id;
      IF v_active >= v_limit THEN
        RAISE EXCEPTION 'Your plan allows % active job posting%. Close or fill one, or upgrade, to publish another.',
          v_limit, CASE WHEN v_limit = 1 THEN '' ELSE 's' END USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_jobs_enabled_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.jobs_enabled IS NOT DISTINCT FROM OLD.jobs_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.jobs_enabled := OLD.jobs_enabled;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_shift_claim_employment_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM shifts s
    JOIN center_staff cs ON cs.center_id = s.center_id AND cs.staff_id = NEW.staff_id
    WHERE s.id = NEW.shift_id
      AND cs.employment_class = 'regular'
  ) THEN
    RAISE EXCEPTION 'Regular employees cannot claim shifts at their own center'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_notification_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.user_notification_settings (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hiring_in_progress()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT COALESCE(current_setting('carelocal.hiring', true), '') = 'on' $function$;

CREATE OR REPLACE FUNCTION public.is_center_admin(p_center_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_own_staff(p_staff_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_staff_id AND user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_own_staff_profile(p_staff_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id = p_staff_id AND user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false);
$function$;

CREATE OR REPLACE FUNCTION public.job_center_in_my_metro(p_center_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM staff_profiles sp
    JOIN centers c ON c.id = p_center_id
    WHERE sp.user_id = auth.uid()
      AND sp.metro_area_id IS NOT NULL
      AND sp.metro_area_id = c.metro_area_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.job_post_limit(p_center_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN c.subscription_status::text = 'trialing' THEN 1
    WHEN c.subscription_tier::text = 'starter' THEN 2
    WHEN c.subscription_tier::text = 'growth' THEN 5
    ELSE NULL                                        -- network / enterprise: unlimited
  END
  FROM centers c WHERE c.id = p_center_id;
$function$;

CREATE OR REPLACE FUNCTION public.leave_center(p_center_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id uuid;
  v_link center_staff%ROWTYPE;
  v_center centers%ROWTYPE;
  v_today date;
  v_shifts text;
  v_cancelled integer := 0;
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  SELECT * INTO v_link FROM center_staff
  WHERE staff_id = v_staff_id AND center_id = p_center_id AND status::text IN ('active', 'inactive')
  FOR UPDATE;
  IF v_staff_id IS NULL OR v_link.id IS NULL THEN
    RAISE EXCEPTION 'You are not part of this center' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_center FROM centers WHERE id = p_center_id;

  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'You are an admin at %. Ask another admin to remove your admin access before you leave', v_center.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM job_applications
    WHERE staff_id = v_staff_id AND center_id = p_center_id AND stage IN ('applied', 'reviewing', 'interview', 'offer')
  ) THEN
    RAISE EXCEPTION 'You have an open job application at %. Withdraw it from Applications before you leave', v_center.name
      USING ERRCODE = 'check_violation';
  END IF;

  -- "Upcoming" in the center's own time zone
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(v_center.timezone, ''), 'America/New_York'))::date;
  SELECT string_agg(to_char(s.shift_date, 'Mon FMDD'), ', ' ORDER BY s.shift_date) INTO v_shifts
  FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
  WHERE sc.staff_id = v_staff_id AND s.center_id = p_center_id
    AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled' AND s.shift_date >= v_today;
  IF v_shifts IS NOT NULL THEN
    RAISE EXCEPTION 'You are booked for shifts at % (%). Ask the center to reassign them before you leave', v_center.name, v_shifts
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pending shift requests there are withdrawn
  UPDATE shift_claims sc
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Left the center'
  FROM shifts s
  WHERE sc.shift_id = s.id AND s.center_id = p_center_id AND sc.staff_id = v_staff_id
    AND sc.status::text IN ('pending', 'interested');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE center_staff SET status = 'removed' WHERE id = v_link.id;

  RETURN jsonb_build_object('center_name', v_center.name, 'domain_key', v_center.domain_key, 'cancelled_claims', v_cancelled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_active_metros()
 RETURNS TABLE(id uuid, name text, state_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.name, m.state_code
  FROM public.metro_areas m
  WHERE m.is_active
  ORDER BY m.name;
$function$;

CREATE OR REPLACE FUNCTION public.log_child_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old jsonb; v_new jsonb; v_child uuid; v_center uuid; v_row uuid;
  v_fields text[] := '{}'; v_summary text; v_req text; k text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW);
  ELSE v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_child := COALESCE(v_new, v_old)->>'id';
  ELSE
    v_child := COALESCE(v_new, v_old)->>'child_id';
  END IF;
  v_center := COALESCE(v_new, v_old)->>'center_id';
  v_row := COALESCE(v_new, v_old)->>'id';

  IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_child) THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k <> 'updated_at' AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN v_fields := v_fields || k; END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_summary := CASE WHEN TG_OP = 'INSERT' THEN 'Child added' ELSE 'Changed: ' || array_to_string(v_fields, ', ') END;
  ELSIF TG_TABLE_NAME = 'child_guardians' THEN
    v_summary := CASE TG_OP
      WHEN 'INSERT' THEN 'Added ' || (v_new->>'name') || CASE WHEN (v_new->>'can_pick_up')::boolean THEN ', authorized to pick up' ELSE '' END
      WHEN 'DELETE' THEN 'Removed ' || (v_old->>'name')
      ELSE (v_new->>'name') || ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'can_pick_up' = ANY (v_fields)
                   THEN CASE WHEN (v_new->>'can_pick_up')::boolean THEN ' (pick-up authorized)' ELSE ' (pick-up removed)' END
                   ELSE '' END
    END;
  ELSIF TG_TABLE_NAME = 'child_documents' THEN
    SELECT document_name INTO v_req FROM center_document_requirements WHERE id = (COALESCE(v_new, v_old)->>'requirement_id')::uuid;
    v_summary := COALESCE(v_req, 'Record') || CASE TG_OP
      WHEN 'INSERT' THEN ': record created'
      WHEN 'DELETE' THEN ': record removed'
      ELSE ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'status' = ANY (v_fields) THEN ' (' || (v_old->>'status') || ' to ' || (v_new->>'status') || ')' ELSE '' END
    END;
  ELSE  -- child_files
    v_summary := CASE TG_OP WHEN 'INSERT' THEN 'File added: ' WHEN 'DELETE' THEN 'File removed: ' ELSE 'File changed: ' END
                 || COALESCE(v_new->>'file_name', v_old->>'file_name');
  END IF;

  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, changed_fields, summary)
  VALUES (v_center, v_child, TG_TABLE_NAME, v_row, lower(TG_OP), auth.uid(), v_fields, left(v_summary, 300));
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.log_job_application_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
  INSERT INTO job_application_events (application_id, from_stage, to_stage, actor_id, note)
  VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage END, NEW.stage, auth.uid(),
          NULLIF(current_setting('carelocal.stage_note', true), ''));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_offer_letter_viewed(p_app_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE job_applications
  SET offer_letter_viewed_at = COALESCE(offer_letter_viewed_at, now())
  WHERE id = p_app_id AND public.is_own_staff(staff_id) AND offer_letter_file_key IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_application_stage(p_app_id uuid, p_stage text, p_note text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_center_admin(v_app.center_id) OR public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_stage = 'interview' THEN
    RAISE EXCEPTION 'Schedule the interview (date, time and place) to move an applicant to Interview' USING ERRCODE = 'check_violation';
  END IF;
  IF p_stage NOT IN ('applied', 'reviewing', 'rejected') THEN
    RAISE EXCEPTION 'Use Send offer to make an offer; a hire happens when the applicant accepts' USING ERRCODE = 'check_violation';
  END IF;
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application can no longer be moved' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note',
    NULLIF(trim(concat_ws(' · ', NULLIF(trim(COALESCE(p_note, '')), ''),
      CASE WHEN p_stage = 'rejected' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NOT NULL THEN 'Reason: ' || trim(p_reason) END)), ''),
    true);
  UPDATE job_applications
  SET stage = p_stage, decided_at = CASE WHEN p_stage = 'rejected' THEN now() ELSE decided_at END
  WHERE id = p_app_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_accepted_document_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR (public.is_center_admin(OLD.center_id) AND NOT public.is_own_staff(OLD.staff_id)) THEN
    RETURN OLD;
  END IF;
  IF OLD.status::text = 'accepted' THEN
    RAISE EXCEPTION 'An accepted document can only be removed by the center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_accepted_staff_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM center_staff_document_status WHERE matched_document_id = OLD.id AND status::text = 'accepted')
     OR EXISTS (SELECT 1 FROM document_requests WHERE submitted_document_id = OLD.id AND status = 'completed') THEN
    RAISE EXCEPTION 'This document was accepted by a center and is part of its records, so it cannot be deleted. Link a newer document to replace it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_policy_update(p_requirement_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_version integer;
BEGIN
  UPDATE center_document_requirements
  SET policy_version = policy_version + 1, policy_updated_at = now()
  WHERE id = p_requirement_id
    AND evidence_type = 'acknowledgement'
    AND public.is_center_admin(center_id)
  RETURNING policy_version INTO v_version;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Requirement not found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reapply_to_center(p_center_id uuid, p_class text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id uuid;
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  UPDATE center_staff
  SET status = 'applying',
      requested_employment_class = CASE WHEN p_class IN ('regular', 'substitute') THEN p_class ELSE requested_employment_class END
  WHERE staff_id = v_staff_id AND center_id = p_center_id AND status::text = 'removed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no earlier link with this center to reopen' USING ERRCODE = 'no_data_found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_document_request(p_request_id uuid, p_action text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req document_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM document_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR NOT public.is_center_admin(v_req.center_id) OR public.is_own_staff(v_req.staff_id) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_action = 'accept' THEN
    IF v_req.status <> 'submitted' THEN
      RAISE EXCEPTION 'Nothing has been submitted yet' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE document_requests SET status = 'completed', center_note = nullif(trim(coalesce(p_note, '')), ''),
      resolved_by = auth.uid(), resolved_at = now()
    WHERE id = p_request_id;
  ELSIF p_action = 'reject' THEN
    IF coalesce(trim(p_note), '') = '' THEN
      RAISE EXCEPTION 'Add a note so the employee knows what to send instead' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE document_requests SET status = 'open', center_note = trim(p_note), submitted_document_id = NULL, submitted_at = NULL
    WHERE id = p_request_id;
  ELSIF p_action = 'cancel' THEN
    UPDATE document_requests SET status = 'cancelled', resolved_by = auth.uid(), resolved_at = now()
    WHERE id = p_request_id AND status IN ('open', 'submitted');
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_admin_when_not_regular()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.employment_class <> 'regular' OR NEW.status::text = 'removed' THEN
    DELETE FROM center_admins ca
    USING staff_profiles sp
    WHERE sp.id = NEW.staff_id AND ca.user_id = sp.user_id
      AND ca.center_id = NEW.center_id AND ca.role = 'admin';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_job_interview(p_app_id uuid, p_at timestamp with time zone, p_location text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_center_admin(v_app.center_id) OR public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application can no longer be moved to Interview' USING ERRCODE = 'check_violation';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'Choose the interview date and time' USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(trim(COALESCE(p_location, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add where the interview takes place' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note',
    CASE WHEN v_app.stage = 'interview' THEN 'Interview rescheduled' ELSE 'Interview scheduled' END, true);
  UPDATE job_applications
  SET stage = 'interview', interview_at = p_at, interview_location = trim(p_location),
      interview_note = NULLIF(trim(COALESCE(p_note, '')), '')
  WHERE id = p_app_id;

  -- A reschedule keeps the stage, so record it in the history explicitly
  IF v_app.stage = 'interview' THEN
    INSERT INTO job_application_events (application_id, from_stage, to_stage, actor_id, note)
    VALUES (p_app_id, 'interview', 'interview', auth.uid(), 'Interview rescheduled');
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_job_offer(p_app_id uuid, p_start_date date, p_pay numeric, p_note text, p_letter_key text DEFAULT NULL::text, p_letter_bucket text DEFAULT NULL::text, p_letter_name text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
  v_missing text[];
  v_count integer := 0;
  v_prefix text;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_center_admin(v_app.center_id) OR public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application has already moved on' USING ERRCODE = 'check_violation';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'Choose a start date for the offer' USING ERRCODE = 'check_violation';
  END IF;

  -- The letter must sit in this center's offer_letter/ folder
  v_prefix := 'offer_letter/' || v_app.center_id || '/';
  IF p_letter_key IS NOT NULL AND left(p_letter_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(r.document_name ORDER BY r.document_name) INTO v_missing
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  LEFT JOIN center_staff_document_status s
    ON s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'apply'
    AND NOT (COALESCE(s.status::text, '') IN ('accepted', 'pending_review') OR COALESCE(s.not_applicable, false));
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Before an offer, these need to be accepted or in review: %', array_to_string(v_missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note', NULLIF(trim(COALESCE(p_note, '')), ''), true);
  UPDATE job_applications
  SET stage = 'offer', offer_start_date = p_start_date, offer_pay = p_pay,
      offer_note = NULLIF(trim(COALESCE(p_note, '')), ''), offer_sent_at = now(),
      offer_letter_file_key = p_letter_key,
      offer_letter_bucket_name = CASE WHEN p_letter_key IS NULL THEN NULL ELSE p_letter_bucket END,
      offer_letter_file_name = CASE WHEN p_letter_key IS NULL THEN NULL ELSE NULLIF(trim(COALESCE(p_letter_name, '')), '') END,
      offer_letter_viewed_at = NULL
  WHERE id = p_app_id;

  -- Offer-stage items the person does not have yet become document requests
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, is_confidential, requested_by)
  SELECT v_app.center_id, v_app.staff_id, r.id, r.document_name, r.is_confidential, auth.uid()
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'offer'
    AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = r.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable))
    AND NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = v_app.staff_id AND dr.requirement_id = r.id AND dr.status IN ('open', 'submitted'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_center_admin_access(p_center_id uuid, p_staff_id uuid, p_is_admin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_class text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the center owner can change admin access' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT sp.user_id, cs.employment_class INTO v_user_id, v_class
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE cs.center_id = p_center_id AND cs.staff_id = p_staff_id AND cs.status::text <> 'removed';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This person is not an employee of the center' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own access' USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_admin THEN
    IF v_class <> 'regular' THEN
      RAISE EXCEPTION 'Only Regular employees can be made Admin' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id) THEN
      INSERT INTO center_admins (center_id, user_id, role) VALUES (p_center_id, v_user_id, 'admin');
    END IF;
    UPDATE staff_profiles SET staff_type = 'admin' WHERE id = p_staff_id;
  ELSE
    -- Never removes an owner
    DELETE FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id AND role = 'admin';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_domain_key(p_user_id uuid, p_domain_key text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('domain_key', p_domain_key)
  WHERE id = p_user_id
    AND p_domain_key IS NOT NULL
    -- First vertical wins: never move an existing account to another vertical.
    AND (raw_app_meta_data ->> 'domain_key') IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.staff_center_role(p_center_id uuid, p_staff_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ca.role
  FROM center_admins ca
  JOIN staff_profiles sp ON sp.user_id = ca.user_id
  WHERE ca.center_id = p_center_id
    AND sp.id = p_staff_id
    AND public.is_center_admin(p_center_id)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.submit_document_request(p_request_id uuid, p_document_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req document_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM document_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR NOT public.is_own_staff(v_req.staff_id) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.status NOT IN ('open', 'submitted') THEN
    RAISE EXCEPTION 'This request is already closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_documents WHERE id = p_document_id AND staff_id = v_req.staff_id) THEN
    RAISE EXCEPTION 'Choose a document from your own library' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE document_requests
  SET status = 'submitted', submitted_document_id = p_document_id, submitted_at = now(),
      staff_note = nullif(trim(coalesce(p_note, '')), '')
  WHERE id = p_request_id;

  -- Checklist item: link the document for the normal review (status forced to pending_review)
  IF v_req.requirement_id IS NOT NULL THEN
    INSERT INTO center_staff_document_status (center_id, staff_id, requirement_id, matched_document_id, status, center_reviewed)
    VALUES (v_req.center_id, v_req.staff_id, v_req.requirement_id, p_document_id, 'pending_review', false)
    ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE
      SET matched_document_id = EXCLUDED.matched_document_id, status = 'pending_review', center_reviewed = false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_center_admin_domain_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.set_user_domain_key(
    NEW.user_id,
    (SELECT domain_key FROM public.centers WHERE id = NEW.center_id)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_requests_with_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'accepted' OR NEW.not_applicable THEN
    UPDATE document_requests
    SET status = 'completed', resolved_by = auth.uid(), resolved_at = now()
    WHERE staff_id = NEW.staff_id AND requirement_id = NEW.requirement_id AND status IN ('open', 'submitted');
  ELSIF NEW.status::text = 'rejected' THEN
    UPDATE document_requests
    SET status = 'open', center_note = NEW.review_notes, submitted_document_id = NULL, submitted_at = NULL
    WHERE staff_id = NEW.staff_id AND requirement_id = NEW.requirement_id AND status = 'submitted';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_staff_profile_domain_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.set_user_domain_key(NEW.user_id, NEW.domain_key);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_job_application(p_app_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage IN ('hired', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'This application is already closed' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE job_applications SET stage = 'withdrawn', decided_at = now() WHERE id = p_app_id;
END;
$function$;

-- Constraints
ALTER TABLE public.app_notifications ADD CONSTRAINT "app_notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_about_items ADD CONSTRAINT "center_about_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_admins ADD CONSTRAINT "center_admins_center_id_user_id_key" UNIQUE (center_id, user_id);
ALTER TABLE public.center_admins ADD CONSTRAINT "center_admins_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_audience_check" CHECK ((audience = ANY (ARRAY['staff'::text, 'child'::text])));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_audience_section_check" CHECK (((audience = 'child'::text) = (section ~~ like_escape('child\_%'::text, '\'::text))));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_due_check" CHECK (((due_within_days IS NULL) OR (due_within_days >= 0)));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_evidence_type_check" CHECK ((evidence_type = ANY (ARRAY['staff_document'::text, 'center_record'::text, 'acknowledgement'::text, 'training'::text])));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_renewal_check" CHECK (((renewal_type = ANY (ARRAY['none'::text, 'interval'::text, 'document_expiry'::text, 'policy_change'::text])) AND ((renewal_type <> 'interval'::text) OR ((renewal_months IS NOT NULL) AND (renewal_months > 0)))));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "cdr_section_check" CHECK (((section = ANY (ARRAY['personnel'::text, 'health'::text, 'training'::text, 'health_safety'::text, 'policies'::text, 'evaluations'::text])) OR (section ~~ 'custom:%'::text) OR (section ~~ like_escape('child\_%'::text, '\'::text))));
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "center_document_requirements_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_inspection_files ADD CONSTRAINT "center_inspection_files_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_result_check" CHECK (((result IS NULL) OR (result = ANY (ARRAY['passed'::text, 'passed_with_conditions'::text, 'failed'::text]))));
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_interval_unit_check" CHECK (((interval_unit IS NULL) OR (interval_unit = ANY (ARRAY['days'::text, 'weeks'::text, 'months'::text, 'years'::text]))));
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_interval_value_check" CHECK (((interval_value IS NULL) OR (interval_value > 0)));
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_last_result_check" CHECK (((last_result IS NULL) OR (last_result = ANY (ARRAY['passed'::text, 'passed_with_conditions'::text, 'failed'::text]))));
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_inspections ADD CONSTRAINT "interval_both_or_neither" CHECK (((interval_value IS NULL) = (interval_unit IS NULL)));
ALTER TABLE public.center_internal_documents ADD CONSTRAINT "center_internal_documents_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_lookups ADD CONSTRAINT "center_lookups_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_programs ADD CONSTRAINT "center_programs_more_info_url_check" CHECK (((more_info_url IS NULL) OR (more_info_url ~* '^https?://'::text)));
ALTER TABLE public.center_programs ADD CONSTRAINT "center_programs_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_center_id_staff_id_key" UNIQUE (center_id, staff_id);
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_employment_class_check" CHECK ((employment_class = ANY (ARRAY['regular'::text, 'substitute'::text])));
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_invite_token_key" UNIQUE (invite_token);
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_requested_class_check" CHECK (((requested_employment_class IS NULL) OR (requested_employment_class = ANY (ARRAY['regular'::text, 'substitute'::text]))));
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_center_id_staff_id_requirement_key" UNIQUE (center_id, staff_id, requirement_id);
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_hours_check" CHECK (((hours IS NULL) OR (hours >= (0)::numeric)));
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_team_members ADD CONSTRAINT "center_team_members_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_alternate_times_check" CHECK ((char_length(alternate_times) <= 500));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_center_note_check" CHECK ((char_length(center_note) <= 1000));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_confirmed_time_check" CHECK ((confirmed_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_contact_time_check" CHECK ((contact_time = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text])));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_email_check" CHECK (((char_length(email) >= 3) AND (char_length(email) <= 254)));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_first_name_check" CHECK (((char_length(first_name) >= 1) AND (char_length(first_name) <= 60)));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_last_name_check" CHECK (((char_length(last_name) >= 1) AND (char_length(last_name) <= 60)));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_message_check" CHECK ((char_length(message) <= 1000));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_phone_check" CHECK (((char_length(phone) >= 7) AND (char_length(phone) <= 30)));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_preferred_time_check" CHECK ((preferred_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_tour_type_check" CHECK ((tour_type = ANY (ARRAY['in_person'::text, 'virtual'::text])));
ALTER TABLE public.center_vendors ADD CONSTRAINT "center_vendors_pkey" PRIMARY KEY (id);
ALTER TABLE public.centers ADD CONSTRAINT "centers_pkey" PRIMARY KEY (id);
ALTER TABLE public.centers ADD CONSTRAINT "centers_public_description_length" CHECK (((public_description IS NULL) OR (char_length(public_description) <= 1500)));
ALTER TABLE public.centers ADD CONSTRAINT "centers_public_handle_format" CHECK (((public_handle IS NULL) OR ((public_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((char_length(public_handle) >= 3) AND (char_length(public_handle) <= 60)))));
ALTER TABLE public.centers ADD CONSTRAINT "centers_public_needs_handle" CHECK (((NOT public_enabled) OR (public_handle IS NOT NULL)));
ALTER TABLE public.centers ADD CONSTRAINT "centers_slug_key" UNIQUE (slug);
ALTER TABLE public.centers ADD CONSTRAINT "centers_stripe_customer_id_key" UNIQUE (stripe_customer_id);
ALTER TABLE public.child_audit_log ADD CONSTRAINT "child_audit_log_action_check" CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])));
ALTER TABLE public.child_audit_log ADD CONSTRAINT "child_audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_child_id_requirement_id_key" UNIQUE (child_id, requirement_id);
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_not_applicable_reason_check" CHECK (((not_applicable_reason IS NULL) OR (char_length(not_applicable_reason) <= 500)));
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_pkey" PRIMARY KEY (id);
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_review_notes_check" CHECK (((review_notes IS NULL) OR (char_length(review_notes) <= 1000)));
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_file_name_check" CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 200)));
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_pkey" PRIMARY KEY (id);
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_size_bytes_check" CHECK (((size_bytes IS NULL) OR (size_bytes >= 0)));
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_source_check" CHECK ((source = ANY (ARRAY['center'::text, 'parent'::text])));
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_email_check" CHECK (((email IS NULL) OR (char_length(email) <= 254)));
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)));
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_phone_check" CHECK (((phone IS NULL) OR (char_length(phone) <= 30)));
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_pkey" PRIMARY KEY (id);
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_relationship_check" CHECK (((relationship IS NULL) OR (char_length(relationship) <= 60)));
ALTER TABLE public.children ADD CONSTRAINT "children_custody_note_check" CHECK (((custody_note IS NULL) OR (char_length(custody_note) <= 1000)));
ALTER TABLE public.children ADD CONSTRAINT "children_date_of_birth_check" CHECK ((date_of_birth > '1990-01-01'::date));
ALTER TABLE public.children ADD CONSTRAINT "children_first_name_check" CHECK (((char_length(btrim(first_name)) >= 1) AND (char_length(btrim(first_name)) <= 80)));
ALTER TABLE public.children ADD CONSTRAINT "children_id_center_id_key" UNIQUE (id, center_id);
ALTER TABLE public.children ADD CONSTRAINT "children_immunization_status_check" CHECK ((immunization_status = ANY (ARRAY['missing'::text, 'complete'::text, 'in_progress'::text, 'medical_exemption'::text, 'religious_exemption'::text])));
ALTER TABLE public.children ADD CONSTRAINT "children_last_name_check" CHECK (((char_length(btrim(last_name)) >= 1) AND (char_length(btrim(last_name)) <= 80)));
ALTER TABLE public.children ADD CONSTRAINT "children_pkey" PRIMARY KEY (id);
ALTER TABLE public.children ADD CONSTRAINT "children_preferred_name_check" CHECK (((preferred_name IS NULL) OR (char_length(preferred_name) <= 80)));
ALTER TABLE public.children ADD CONSTRAINT "children_status_check" CHECK ((status = ANY (ARRAY['enrolled'::text, 'withdrawn'::text])));
ALTER TABLE public.children ADD CONSTRAINT "children_withdrawn_after_enrolled" CHECK (((withdrawn_on IS NULL) OR (withdrawn_on >= enrolled_on)));
ALTER TABLE public.children ADD CONSTRAINT "children_withdrawn_has_date" CHECK (((status = 'enrolled'::text) OR (withdrawn_on IS NOT NULL)));
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_document_kind_check" CHECK ((document_kind = ANY (ARRAY['vault'::text, 'internal'::text, 'template'::text, 'inspection'::text, 'offer_letter'::text, 'child'::text])));
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_pkey" PRIMARY KEY (id);
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'submitted'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.job_alerts ADD CONSTRAINT "job_alerts_pkey" PRIMARY KEY (id);
ALTER TABLE public.job_application_documents ADD CONSTRAINT "job_application_documents_pkey" PRIMARY KEY (application_id, requirement_id);
ALTER TABLE public.job_application_events ADD CONSTRAINT "job_application_events_pkey" PRIMARY KEY (id);
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_cover_note_check" CHECK ((char_length(cover_note) <= 2000));
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_job_id_staff_id_key" UNIQUE (job_id, staff_id);
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_pkey" PRIMARY KEY (id);
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_stage_check" CHECK ((stage = ANY (ARRAY['applied'::text, 'reviewing'::text, 'interview'::text, 'offer'::text, 'hired'::text, 'rejected'::text, 'withdrawn'::text])));
ALTER TABLE public.job_posting_requirements ADD CONSTRAINT "job_posting_requirements_needed_at_check" CHECK ((needed_at = ANY (ARRAY['apply'::text, 'offer'::text, 'start'::text])));
ALTER TABLE public.job_posting_requirements ADD CONSTRAINT "job_posting_requirements_pkey" PRIMARY KEY (job_id, requirement_id);
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_center_id_slug_key" UNIQUE (center_id, slug);
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_check" CHECK (((pay_max IS NULL) OR (pay_min IS NULL) OR (pay_max >= pay_min)));
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_check1" CHECK (((status = 'draft'::text) OR (pay_min IS NOT NULL)));
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_employment_type_check" CHECK ((employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text])));
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_openings_check" CHECK ((openings > 0));
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_pay_unit_check" CHECK ((pay_unit = ANY (ARRAY['hour'::text, 'year'::text])));
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_pkey" PRIMARY KEY (id);
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'closed'::text, 'filled'::text])));
ALTER TABLE public.metro_areas ADD CONSTRAINT "metro_areas_pkey" PRIMARY KEY (id);
ALTER TABLE public.metro_areas ADD CONSTRAINT "metro_areas_slug_key" UNIQUE (slug);
ALTER TABLE public.native_push_tokens ADD CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY (id);
ALTER TABLE public.native_push_tokens ADD CONSTRAINT "native_push_tokens_platform_check" CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));
ALTER TABLE public.native_push_tokens ADD CONSTRAINT "native_push_tokens_token_key" UNIQUE (token);
ALTER TABLE public.notification_preferences ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY (user_id);
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE (endpoint);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE public.requirement_templates ADD CONSTRAINT "requirement_templates_pkey" PRIMARY KEY (id);
ALTER TABLE public.shift_claims ADD CONSTRAINT "shift_claims_pkey" PRIMARY KEY (id);
ALTER TABLE public.shift_claims ADD CONSTRAINT "shift_claims_shift_id_staff_id_key" UNIQUE (shift_id, staff_id);
ALTER TABLE public.shift_reviews ADD CONSTRAINT "shift_reviews_pkey" PRIMARY KEY (id);
ALTER TABLE public.shift_reviews ADD CONSTRAINT "shift_reviews_rating_check" CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.shift_reviews ADD CONSTRAINT "shift_reviews_reviewer_id_reviewee_id_reviewer_type_key" UNIQUE (reviewer_id, reviewee_id, reviewer_type);
ALTER TABLE public.shift_reviews ADD CONSTRAINT "shift_reviews_reviewer_type_check" CHECK ((reviewer_type = ANY (ARRAY['center'::text, 'staff'::text])));
ALTER TABLE public.shifts ADD CONSTRAINT "shifts_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_credentials ADD CONSTRAINT "staff_credentials_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_documents ADD CONSTRAINT "staff_documents_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_experiences ADD CONSTRAINT "staff_experiences_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_profiles ADD CONSTRAINT "staff_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_profiles ADD CONSTRAINT "staff_profiles_user_id_key" UNIQUE (user_id);
ALTER TABLE public.staff_profiles ADD CONSTRAINT "staff_requested_employment_class_check" CHECK (((requested_employment_class IS NULL) OR (requested_employment_class = ANY (ARRAY['regular'::text, 'substitute'::text]))));
ALTER TABLE public.staff_references ADD CONSTRAINT "staff_references_pkey" PRIMARY KEY (id);
ALTER TABLE public.staff_role_types ADD CONSTRAINT "staff_role_types_center_id_label_key" UNIQUE NULLS NOT DISTINCT (center_id, label);
ALTER TABLE public.staff_role_types ADD CONSTRAINT "staff_role_types_center_id_value_key" UNIQUE NULLS NOT DISTINCT (center_id, value);
ALTER TABLE public.staff_role_types ADD CONSTRAINT "staff_role_types_pkey" PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE (stripe_subscription_id);
ALTER TABLE public.support_tickets ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY (id);
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_kind_check" CHECK ((kind = ANY (ARRAY['internal'::text, 'inspection'::text, 'template'::text, 'vault'::text])));
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_pkey" PRIMARY KEY (id);
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'uploaded'::text, 'attached'::text, 'discarded'::text])));
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_token_hash_key" UNIQUE (token_hash);
ALTER TABLE public.user_notification_settings ADD CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY (user_id);
ALTER TABLE public.work_areas ADD CONSTRAINT "classrooms_pkey" PRIMARY KEY (id);
ALTER TABLE public.app_notifications ADD CONSTRAINT "app_notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.center_about_items ADD CONSTRAINT "center_about_items_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_admins ADD CONSTRAINT "center_admins_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_admins ADD CONSTRAINT "center_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT "center_document_requirements_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_inspection_files ADD CONSTRAINT "center_inspection_files_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_inspection_files ADD CONSTRAINT "center_inspection_files_inspection_id_fkey" FOREIGN KEY (inspection_id) REFERENCES center_inspections(id) ON DELETE RESTRICT;
ALTER TABLE public.center_inspection_files ADD CONSTRAINT "center_inspection_files_log_id_fkey" FOREIGN KEY (log_id) REFERENCES center_inspection_logs(id) ON DELETE SET NULL;
ALTER TABLE public.center_inspection_files ADD CONSTRAINT "center_inspection_files_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_inspection_id_fkey" FOREIGN KEY (inspection_id) REFERENCES center_inspections(id) ON DELETE CASCADE;
ALTER TABLE public.center_inspection_logs ADD CONSTRAINT "center_inspection_logs_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES center_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_inspections ADD CONSTRAINT "center_inspections_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES center_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.center_internal_documents ADD CONSTRAINT "center_internal_documents_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_internal_documents ADD CONSTRAINT "center_internal_documents_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE SET NULL;
ALTER TABLE public.center_internal_documents ADD CONSTRAINT "center_internal_documents_source_document_id_fkey" FOREIGN KEY (source_document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.center_internal_documents ADD CONSTRAINT "center_internal_documents_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.center_lookups ADD CONSTRAINT "center_lookups_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_programs ADD CONSTRAINT "center_programs_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_added_by_fkey" FOREIGN KEY (added_by) REFERENCES auth.users(id);
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_staff ADD CONSTRAINT "center_staff_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_matched_document_id_fkey" FOREIGN KEY (matched_document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE CASCADE;
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);
ALTER TABLE public.center_staff_document_status ADD CONSTRAINT "center_staff_document_status_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.center_team_members ADD CONSTRAINT "center_team_members_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_tour_requests ADD CONSTRAINT "center_tour_requests_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.center_vendors ADD CONSTRAINT "center_vendors_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.centers ADD CONSTRAINT "centers_metro_area_id_fkey" FOREIGN KEY (metro_area_id) REFERENCES metro_areas(id);
ALTER TABLE public.child_audit_log ADD CONSTRAINT "child_audit_log_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;
ALTER TABLE public.child_audit_log ADD CONSTRAINT "child_audit_log_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.child_audit_log ADD CONSTRAINT "child_audit_log_child_id_fkey" FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE;
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_child_id_center_id_fkey" FOREIGN KEY (child_id, center_id) REFERENCES children(id, center_id) ON DELETE CASCADE;
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE CASCADE;
ALTER TABLE public.child_documents ADD CONSTRAINT "child_documents_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_child_id_center_id_fkey" FOREIGN KEY (child_id, center_id) REFERENCES children(id, center_id) ON DELETE CASCADE;
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE SET NULL;
ALTER TABLE public.child_files ADD CONSTRAINT "child_files_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.child_guardians ADD CONSTRAINT "child_guardians_child_id_center_id_fkey" FOREIGN KEY (child_id, center_id) REFERENCES children(id, center_id) ON DELETE CASCADE;
ALTER TABLE public.children ADD CONSTRAINT "children_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;
ALTER TABLE public.children ADD CONSTRAINT "children_classroom_id_fkey" FOREIGN KEY (classroom_id) REFERENCES work_areas(id) ON DELETE SET NULL;
ALTER TABLE public.children ADD CONSTRAINT "children_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.children ADD CONSTRAINT "children_source_tour_request_id_fkey" FOREIGN KEY (source_tour_request_id) REFERENCES center_tour_requests(id) ON DELETE SET NULL;
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_child_id_fkey" FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE SET NULL;
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.document_access_log ADD CONSTRAINT "document_access_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE SET NULL;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.document_requests ADD CONSTRAINT "document_requests_submitted_document_id_fkey" FOREIGN KEY (submitted_document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.job_alerts ADD CONSTRAINT "job_alerts_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.job_application_documents ADD CONSTRAINT "job_application_documents_application_id_fkey" FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE;
ALTER TABLE public.job_application_documents ADD CONSTRAINT "job_application_documents_document_id_fkey" FOREIGN KEY (document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.job_application_documents ADD CONSTRAINT "job_application_documents_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE CASCADE;
ALTER TABLE public.job_application_events ADD CONSTRAINT "job_application_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.job_application_events ADD CONSTRAINT "job_application_events_application_id_fkey" FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE;
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_center_staff_id_fkey" FOREIGN KEY (center_staff_id) REFERENCES center_staff(id) ON DELETE CASCADE;
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY (job_id) REFERENCES job_postings(id) ON DELETE CASCADE;
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_resume_document_id_fkey" FOREIGN KEY (resume_document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.job_applications ADD CONSTRAINT "job_applications_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.job_posting_requirements ADD CONSTRAINT "job_posting_requirements_job_id_fkey" FOREIGN KEY (job_id) REFERENCES job_postings(id) ON DELETE CASCADE;
ALTER TABLE public.job_posting_requirements ADD CONSTRAINT "job_posting_requirements_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE CASCADE;
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.job_postings ADD CONSTRAINT "job_postings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.native_push_tokens ADD CONSTRAINT "native_push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notification_preferences ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.requirement_templates ADD CONSTRAINT "requirement_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.requirement_templates ADD CONSTRAINT "requirement_templates_source_center_id_fkey" FOREIGN KEY (source_center_id) REFERENCES centers(id) ON DELETE SET NULL;
ALTER TABLE public.shift_claims ADD CONSTRAINT "shift_claims_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES auth.users(id);
ALTER TABLE public.shift_claims ADD CONSTRAINT "shift_claims_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE public.shift_claims ADD CONSTRAINT "shift_claims_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.shift_reviews ADD CONSTRAINT "shift_reviews_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE public.shifts ADD CONSTRAINT "shifts_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.shifts ADD CONSTRAINT "shifts_classroom_id_fkey" FOREIGN KEY (work_area_id) REFERENCES work_areas(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.staff_credentials ADD CONSTRAINT "staff_credentials_linked_document_id_fkey" FOREIGN KEY (linked_document_id) REFERENCES staff_documents(id) ON DELETE SET NULL;
ALTER TABLE public.staff_credentials ADD CONSTRAINT "staff_credentials_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff_documents ADD CONSTRAINT "staff_documents_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff_experiences ADD CONSTRAINT "staff_experiences_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff_profiles ADD CONSTRAINT "staff_profiles_metro_area_id_fkey" FOREIGN KEY (metro_area_id) REFERENCES metro_areas(id);
ALTER TABLE public.staff_profiles ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.staff_references ADD CONSTRAINT "staff_references_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff_role_types ADD CONSTRAINT "staff_role_types_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions ADD CONSTRAINT "subscriptions_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.support_tickets ADD CONSTRAINT "support_tickets_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.support_tickets ADD CONSTRAINT "support_tickets_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_requirement_id_fkey" FOREIGN KEY (requirement_id) REFERENCES center_document_requirements(id) ON DELETE CASCADE;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT "upload_handoffs_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.user_notification_settings ADD CONSTRAINT "user_notification_settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.work_areas ADD CONSTRAINT "classrooms_center_id_fkey" FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX center_about_items_center_id_idx ON public.center_about_items USING btree (center_id);
CREATE UNIQUE INDEX cdr_center_template_key_unique ON public.center_document_requirements USING btree (center_id, template_key) WHERE (template_key IS NOT NULL);
CREATE INDEX idx_cdr_center_audience ON public.center_document_requirements USING btree (center_id, audience);
CREATE INDEX idx_center_inspection_files_inspection ON public.center_inspection_files USING btree (inspection_id, uploaded_at DESC);
CREATE INDEX idx_center_inspection_files_log ON public.center_inspection_files USING btree (log_id);
CREATE INDEX idx_center_inspection_logs_inspection ON public.center_inspection_logs USING btree (inspection_id, performed_on DESC);
CREATE INDEX idx_center_inspections_center ON public.center_inspections USING btree (center_id);
CREATE INDEX idx_center_inspections_due ON public.center_inspections USING btree (center_id, next_due_date) WHERE is_active;
CREATE INDEX idx_center_inspections_vendor ON public.center_inspections USING btree (vendor_id);
CREATE UNIQUE INDEX center_internal_documents_source_unique ON public.center_internal_documents USING btree (center_id, source_document_id) WHERE (source_document_id IS NOT NULL);
CREATE UNIQUE INDEX center_lookups_center_unique ON public.center_lookups USING btree (center_id, group_name, value) WHERE (center_id IS NOT NULL);
CREATE UNIQUE INDEX center_lookups_default_unique ON public.center_lookups USING btree (group_name, domain_key, value) WHERE (center_id IS NULL);
CREATE INDEX center_programs_center_id_idx ON public.center_programs USING btree (center_id);
CREATE INDEX idx_center_staff_center ON public.center_staff USING btree (center_id);
CREATE INDEX idx_center_staff_staff ON public.center_staff USING btree (staff_id);
CREATE INDEX center_team_members_center_id_idx ON public.center_team_members USING btree (center_id);
CREATE INDEX idx_tour_requests_center_status ON public.center_tour_requests USING btree (center_id, status, created_at DESC);
CREATE INDEX idx_tour_requests_email_recent ON public.center_tour_requests USING btree (lower(email), created_at DESC);
CREATE INDEX idx_center_vendors_center ON public.center_vendors USING btree (center_id);
CREATE UNIQUE INDEX centers_public_handle_key ON public.centers USING btree (public_handle) WHERE (public_handle IS NOT NULL);
CREATE INDEX idx_child_audit_child ON public.child_audit_log USING btree (child_id, changed_at DESC);
CREATE INDEX idx_child_documents_center ON public.child_documents USING btree (center_id, status);
CREATE INDEX idx_child_files_child ON public.child_files USING btree (child_id, requirement_id);
CREATE INDEX idx_child_guardians_child ON public.child_guardians USING btree (child_id);
CREATE INDEX idx_children_center_name ON public.children USING btree (center_id, last_name, first_name);
CREATE INDEX idx_children_center_status ON public.children USING btree (center_id, status);
CREATE INDEX idx_children_withdrawn ON public.children USING btree (withdrawn_on) WHERE (withdrawn_on IS NOT NULL);
CREATE INDEX idx_document_access_log_center ON public.document_access_log USING btree (center_id, created_at DESC);
CREATE INDEX idx_document_access_log_child ON public.document_access_log USING btree (child_id, created_at DESC) WHERE (child_id IS NOT NULL);
CREATE INDEX idx_document_access_log_staff ON public.document_access_log USING btree (staff_id, created_at DESC);
CREATE INDEX idx_document_requests_center ON public.document_requests USING btree (center_id, status, created_at DESC);
CREATE INDEX idx_document_requests_staff ON public.document_requests USING btree (staff_id, status);
CREATE INDEX idx_job_alerts_staff ON public.job_alerts USING btree (staff_id);
CREATE UNIQUE INDEX job_alerts_unique ON public.job_alerts USING btree (staff_id, COALESCE(lower(city), ''::text), COALESCE(lower(state), ''::text), COALESCE(role_value, ''::text));
CREATE INDEX idx_job_application_events_app ON public.job_application_events USING btree (application_id, created_at);
CREATE INDEX idx_job_applications_center ON public.job_applications USING btree (center_id, stage);
CREATE INDEX idx_job_applications_job ON public.job_applications USING btree (job_id, stage);
CREATE INDEX idx_job_applications_staff ON public.job_applications USING btree (staff_id, stage);
CREATE INDEX idx_job_postings_center ON public.job_postings USING btree (center_id, status);
CREATE INDEX idx_job_postings_feed ON public.job_postings USING btree (domain_key, status, published_at DESC);
CREATE INDEX idx_notifications_sent_at ON public.notifications USING btree (sent_at DESC);
CREATE INDEX idx_shift_claims_shift ON public.shift_claims USING btree (shift_id);
CREATE INDEX idx_shifts_center_date ON public.shifts USING btree (center_id, shift_date);
CREATE INDEX idx_shifts_status ON public.shifts USING btree (status);
CREATE INDEX idx_staff_docs_staff ON public.staff_documents USING btree (staff_id);
CREATE INDEX idx_staff_references_staff ON public.staff_references USING btree (staff_id);
CREATE INDEX idx_upload_handoffs_center ON public.upload_handoffs USING btree (center_id, created_at DESC);
CREATE INDEX work_areas_center_sort_idx ON public.work_areas USING btree (center_id, sort_order);

-- Views
CREATE VIEW public."job_application_stage_history" WITH (security_barrier=true, security_invoker=on) AS SELECT e.id,
    e.application_id,
    e.from_stage,
    e.to_stage,
    e.created_at
   FROM job_application_events e
     JOIN job_applications a ON a.id = e.application_id
  WHERE is_own_staff(a.staff_id) OR is_center_admin(a.center_id);

-- Triggers
CREATE TRIGGER on_auth_user_created_preferences AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_preferences();
CREATE TRIGGER on_auth_user_created_settings AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_notification_settings();
CREATE TRIGGER center_admins_sync_domain_key AFTER INSERT ON public.center_admins FOR EACH ROW EXECUTE FUNCTION public.sync_center_admin_domain_key();
CREATE TRIGGER trg_requirement_template_key_namespace BEFORE INSERT OR UPDATE ON public.center_document_requirements FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();
CREATE TRIGGER trg_check_inspection_file BEFORE INSERT OR UPDATE ON public.center_inspection_files FOR EACH ROW EXECUTE FUNCTION public.check_inspection_file();
CREATE TRIGGER trg_center_inspection_logs_consistency BEFORE INSERT OR UPDATE ON public.center_inspection_logs FOR EACH ROW EXECUTE FUNCTION public.check_inspection_center_consistency();
CREATE TRIGGER trg_center_inspections_consistency BEFORE INSERT OR UPDATE ON public.center_inspections FOR EACH ROW EXECUTE FUNCTION public.check_inspection_center_consistency();
CREATE TRIGGER trg_center_inspections_updated_at BEFORE UPDATE ON public.center_inspections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_internal_documents_key_namespace BEFORE INSERT OR UPDATE ON public.center_internal_documents FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.center_staff FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_cancel_claims_on_regular_employment AFTER UPDATE OF employment_class ON public.center_staff FOR EACH ROW EXECUTE FUNCTION public.cancel_claims_on_regular_employment();
CREATE TRIGGER trg_guard_center_staff_employment_class BEFORE INSERT OR UPDATE ON public.center_staff FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_employment_class();
CREATE TRIGGER trg_guard_center_staff_self_status BEFORE INSERT OR UPDATE ON public.center_staff FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_self_status();
CREATE TRIGGER trg_revoke_admin_when_not_regular AFTER UPDATE OF employment_class, status ON public.center_staff FOR EACH ROW EXECUTE FUNCTION public.revoke_admin_when_not_regular();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.center_staff_document_status FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_guard_document_status_admin_fields BEFORE INSERT OR UPDATE ON public.center_staff_document_status FOR EACH ROW EXECUTE FUNCTION public.guard_document_status_admin_fields();
CREATE TRIGGER trg_protect_accepted_document_status BEFORE DELETE ON public.center_staff_document_status FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_document_status();
CREATE TRIGGER trg_sync_requests_with_review AFTER INSERT OR UPDATE OF status, not_applicable ON public.center_staff_document_status FOR EACH ROW EXECUTE FUNCTION public.sync_requests_with_review();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.center_tour_requests FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_center_vendors_updated_at BEFORE UPDATE ON public.center_vendors FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.centers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_guard_center_active_flag BEFORE UPDATE ON public.centers FOR EACH ROW EXECUTE FUNCTION public.guard_account_active_flag();
CREATE TRIGGER trg_guard_child_files_flag BEFORE UPDATE ON public.centers FOR EACH ROW EXECUTE FUNCTION public.guard_child_files_flag();
CREATE TRIGGER trg_guard_jobs_enabled_flag BEFORE UPDATE ON public.centers FOR EACH ROW EXECUTE FUNCTION public.guard_jobs_enabled_flag();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.child_documents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_audit_child_documents AFTER INSERT OR DELETE OR UPDATE ON public.child_documents FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
CREATE TRIGGER trg_check_child_document_requirement BEFORE INSERT OR UPDATE OF requirement_id, center_id ON public.child_documents FOR EACH ROW EXECUTE FUNCTION public.check_child_requirement();
CREATE TRIGGER trg_audit_child_files AFTER INSERT OR DELETE OR UPDATE ON public.child_files FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
CREATE TRIGGER trg_check_child_file_key BEFORE INSERT OR UPDATE OF file_key ON public.child_files FOR EACH ROW EXECUTE FUNCTION public.check_child_file_key();
CREATE TRIGGER trg_check_child_file_requirement BEFORE INSERT OR UPDATE OF requirement_id, center_id ON public.child_files FOR EACH ROW EXECUTE FUNCTION public.check_child_requirement();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.child_guardians FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_audit_child_guardians AFTER INSERT OR DELETE OR UPDATE ON public.child_guardians FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.children FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_audit_children AFTER INSERT OR UPDATE ON public.children FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
CREATE TRIGGER trg_enforce_child_limit BEFORE INSERT OR UPDATE OF status ON public.children FOR EACH ROW EXECUTE FUNCTION public.enforce_child_limit();
CREATE TRIGGER trg_guard_child_row BEFORE INSERT OR UPDATE ON public.children FOR EACH ROW EXECUTE FUNCTION public.guard_child_row();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_guard_job_offer_letter BEFORE UPDATE OF stage ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.guard_job_offer_letter();
CREATE TRIGGER trg_log_job_application_stage AFTER INSERT OR UPDATE OF stage ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.log_job_application_stage();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.job_postings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_guard_job_posting BEFORE INSERT OR UPDATE ON public.job_postings FOR EACH ROW EXECUTE FUNCTION public.guard_job_posting();
CREATE TRIGGER trg_guard_shift_claim_employment_class BEFORE INSERT ON public.shift_claims FOR EACH ROW EXECUTE FUNCTION public.guard_shift_claim_employment_class();
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.shift_reviews FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_protect_accepted_staff_document BEFORE DELETE ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_staff_document();
CREATE TRIGGER trg_staff_documents_key_namespace BEFORE INSERT OR UPDATE ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER staff_profiles_sync_domain_key AFTER INSERT ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.sync_staff_profile_domain_key();
CREATE TRIGGER trg_guard_staff_active_flag BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_account_active_flag();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row level security
ALTER TABLE public."app_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_about_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_document_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_inspection_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_inspection_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_internal_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_lookups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_staff_document_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_tour_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."center_vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."child_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."child_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."child_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."child_guardians" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."children" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."document_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."document_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_application_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_application_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_posting_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_postings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."metro_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."native_push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."requirement_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shift_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shift_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_experiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_role_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."upload_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."work_areas" ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Service role has full access to app_notifications" ON public."app_notifications" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can update own app_notifications" ON public."app_notifications" AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own notifications" ON public."app_notifications" AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own app_notifications" ON public."app_notifications" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own notifications" ON public."app_notifications" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Center admins can manage center_about_items" ON public."center_about_items" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins can manage center_about_items" ON public."center_about_items" AS PERMISSIVE FOR ALL TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Super Admin Bypass" ON public."center_admins" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all center admins" ON public."center_admins" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Users can create their own admin records" ON public."center_admins" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users can see their own admin records" ON public."center_admins" AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY "Anyone can see center requirements" ON public."center_document_requirements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Center admins can manage their document requirements" ON public."center_document_requirements" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers))) WITH CHECK ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers)));
CREATE POLICY "Staff read requirements of open jobs" ON public."center_document_requirements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (job_posting_requirements jr
     JOIN job_postings p ON ((p.id = jr.job_id)))
  WHERE ((jr.requirement_id = center_document_requirements.id) AND (((p.status = 'published'::text) AND job_center_in_my_metro(p.center_id)) OR (EXISTS ( SELECT 1
           FROM job_applications a
          WHERE ((a.job_id = p.id) AND is_own_staff(a.staff_id)))))))));
CREATE POLICY "Super Admin Bypass" ON public."center_document_requirements" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Center admins manage inspection files" ON public."center_inspection_files" AS PERMISSIVE FOR ALL TO public USING (is_center_admin(center_id)) WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Super admins read inspection files" ON public."center_inspection_files" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins manage inspection logs" ON public."center_inspection_logs" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins read inspection logs" ON public."center_inspection_logs" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins manage inspections" ON public."center_inspections" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins read inspections" ON public."center_inspections" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins delete internal docs" ON public."center_internal_documents" AS PERMISSIVE FOR DELETE TO public USING (is_center_admin(center_id));
CREATE POLICY "Center admins read internal docs" ON public."center_internal_documents" AS PERMISSIVE FOR SELECT TO public USING ((is_center_admin(center_id) AND ((NOT is_confidential) OR can_view_confidential(center_id)) AND ((requirement_id IS NULL) OR (NOT (EXISTS ( SELECT 1
   FROM center_document_requirements r
  WHERE ((r.id = center_internal_documents.requirement_id) AND r.is_confidential)))) OR can_view_confidential(center_id))));
CREATE POLICY "Center admins update internal docs" ON public."center_internal_documents" AS PERMISSIVE FOR UPDATE TO public USING (is_center_admin(center_id)) WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Center admins write internal docs" ON public."center_internal_documents" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Admins can manage center lookups" ON public."center_lookups" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM center_admins
  WHERE ((center_admins.user_id = auth.uid()) AND (center_admins.center_id = center_lookups.center_id)))));
CREATE POLICY "Authenticated users can read default lookups" ON public."center_lookups" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((center_id IS NULL));
CREATE POLICY "Staff can read their centers' lookups" ON public."center_lookups" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((center_id IN ( SELECT cs.center_id
   FROM (center_staff cs
     JOIN staff_profiles sp ON ((sp.id = cs.staff_id)))
  WHERE (sp.user_id = auth.uid()))));
CREATE POLICY "Center admins can manage center_programs" ON public."center_programs" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Staff read programs of centers that are hiring" ON public."center_programs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active AND job_center_in_my_metro(center_id) AND (EXISTS ( SELECT 1
   FROM job_postings p
  WHERE ((p.center_id = center_programs.center_id) AND (p.status = 'published'::text))))));
CREATE POLICY "Super admins can manage center_programs" ON public."center_programs" AS PERMISSIVE FOR ALL TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can manage center staff" ON public."center_staff" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers)));
CREATE POLICY "Staff can apply to a center" ON public."center_staff" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_own_staff_profile(staff_id));
CREATE POLICY "Staff can join any center" ON public."center_staff" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((staff_id = get_my_staff_id()));
CREATE POLICY "Staff can see their own center relationships" ON public."center_staff" AS PERMISSIVE FOR SELECT TO public USING (is_own_staff_profile(staff_id));
CREATE POLICY "Super Admin Bypass" ON public."center_staff" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all center-staff relationships" ON public."center_staff" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can manage document reviews" ON public."center_staff_document_status" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers))) WITH CHECK ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers)));
CREATE POLICY "Center admins can view staff document statuses" ON public."center_staff_document_status" AS PERMISSIVE FOR SELECT TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Staff can manage their own document statuses" ON public."center_staff_document_status" AS PERMISSIVE FOR ALL TO public USING ((staff_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Super Admin Bypass" ON public."center_staff_document_status" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Center admins can manage center_team_members" ON public."center_team_members" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins can manage center_team_members" ON public."center_team_members" AS PERMISSIVE FOR ALL TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins delete their tour requests" ON public."center_tour_requests" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_center_admin(center_id));
CREATE POLICY "Center admins read their tour requests" ON public."center_tour_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_center_admin(center_id));
CREATE POLICY "Center admins update their tour requests" ON public."center_tour_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_center_admin(center_id)) WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Center admins manage vendors" ON public."center_vendors" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))) WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins read vendors" ON public."center_vendors" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Authenticated users can create a center" ON public."centers" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Center admins can update their center" ON public."centers" AS PERMISSIVE FOR UPDATE TO public USING ((id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Center admins can view their center" ON public."centers" AS PERMISSIVE FOR SELECT TO public USING ((id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Staff can view all centers" ON public."centers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Super Admin Bypass" ON public."centers" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all centers" ON public."centers" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Owners and admins read child_audit_log" ON public."child_audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins add child_documents" ON public."child_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins change child_documents" ON public."child_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (can_use_child_files(center_id)) WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins delete child_documents" ON public."child_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins read child_documents" ON public."child_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins add child_files" ON public."child_files" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins change child_files" ON public."child_files" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (can_use_child_files(center_id)) WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins delete child_files" ON public."child_files" AS PERMISSIVE FOR DELETE TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins read child_files" ON public."child_files" AS PERMISSIVE FOR SELECT TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins add child_guardians" ON public."child_guardians" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins change child_guardians" ON public."child_guardians" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (can_use_child_files(center_id)) WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins delete child_guardians" ON public."child_guardians" AS PERMISSIVE FOR DELETE TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins read child_guardians" ON public."child_guardians" AS PERMISSIVE FOR SELECT TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins add children" ON public."children" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins change children" ON public."children" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (can_use_child_files(center_id)) WITH CHECK (can_use_child_files(center_id));
CREATE POLICY "Owners and admins delete children" ON public."children" AS PERMISSIVE FOR DELETE TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Owners and admins read children" ON public."children" AS PERMISSIVE FOR SELECT TO "authenticated" USING (can_use_child_files(center_id));
CREATE POLICY "Center admins read access log" ON public."document_access_log" AS PERMISSIVE FOR SELECT TO public USING (((center_id IS NOT NULL) AND can_view_confidential(center_id)));
CREATE POLICY "Staff read access to their documents" ON public."document_access_log" AS PERMISSIVE FOR SELECT TO public USING ((staff_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Super admins read access log" ON public."document_access_log" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Users log their own access" ON public."document_access_log" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Center admins read requests" ON public."document_requests" AS PERMISSIVE FOR SELECT TO public USING (is_center_admin(center_id));
CREATE POLICY "Staff read their requests" ON public."document_requests" AS PERMISSIVE FOR SELECT TO public USING (is_own_staff(staff_id));
CREATE POLICY "Staff manage their own job alerts" ON public."job_alerts" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_own_staff_profile(staff_id)) WITH CHECK (is_own_staff_profile(staff_id));
CREATE POLICY "Application documents follow the application" ON public."job_application_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM job_applications a
  WHERE (a.id = job_application_documents.application_id))));
CREATE POLICY "Center admins read stage history" ON public."job_application_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM job_applications a
  WHERE ((a.id = job_application_events.application_id) AND is_center_admin(a.center_id)))));
CREATE POLICY "Applicants and center admins read applications" ON public."job_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_own_staff(staff_id) OR is_center_admin(center_id)));
CREATE POLICY "Center admins manage job requirements" ON public."job_posting_requirements" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM job_postings p
  WHERE ((p.id = job_posting_requirements.job_id) AND is_center_admin(p.center_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM job_postings p
  WHERE ((p.id = job_posting_requirements.job_id) AND is_center_admin(p.center_id)))));
CREATE POLICY "Job requirements follow the job" ON public."job_posting_requirements" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM job_postings p
  WHERE (p.id = job_posting_requirements.job_id))));
CREATE POLICY "Applicants read jobs they applied to" ON public."job_postings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM job_applications a
  WHERE ((a.job_id = job_postings.id) AND is_own_staff(a.staff_id)))));
CREATE POLICY "Center admins create jobs" ON public."job_postings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Center admins delete draft jobs" ON public."job_postings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((is_center_admin(center_id) AND (status = 'draft'::text)));
CREATE POLICY "Center admins read their jobs" ON public."job_postings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_center_admin(center_id));
CREATE POLICY "Center admins update jobs" ON public."job_postings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_center_admin(center_id)) WITH CHECK (is_center_admin(center_id));
CREATE POLICY "Staff read published jobs in their metro" ON public."job_postings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((status = 'published'::text) AND job_center_in_my_metro(center_id)));
CREATE POLICY "Anyone can see active metro areas" ON public."metro_areas" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active = true));
CREATE POLICY "Super Admin Bypass" ON public."metro_areas" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Users can manage their own native push tokens" ON public."native_push_tokens" AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own preferences" ON public."notification_preferences" AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own preferences" ON public."notification_preferences" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can manage their own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Authenticated users can read requirement templates" ON public."requirement_templates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Super admins manage requirement templates" ON public."requirement_templates" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true)) WITH CHECK (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can confirm or cancel claims" ON public."shift_claims" AS PERMISSIVE FOR UPDATE TO public USING ((shift_id IN ( SELECT shifts.id
   FROM shifts
  WHERE (shifts.center_id IN ( SELECT center_admins.center_id
           FROM center_admins
          WHERE (center_admins.user_id = auth.uid()))))));
CREATE POLICY "Center admins can view claims for their shifts" ON public."shift_claims" AS PERMISSIVE FOR SELECT TO public USING ((shift_id IN ( SELECT shifts.id
   FROM shifts
  WHERE (shifts.center_id IN ( SELECT center_admins.center_id
           FROM center_admins
          WHERE (center_admins.user_id = auth.uid()))))));
CREATE POLICY "Staff can manage their own claims" ON public."shift_claims" AS PERMISSIVE FOR ALL TO public USING ((staff_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Super admins can manage all shift claims" ON public."shift_claims" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Centers can insert reviews" ON public."shift_reviews" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((reviewer_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))) AND (reviewer_type = 'center'::text)));
CREATE POLICY "Centers can view reviews about themselves" ON public."shift_reviews" AS PERMISSIVE FOR SELECT TO public USING ((reviewee_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Centers can view reviews they wrote" ON public."shift_reviews" AS PERMISSIVE FOR SELECT TO public USING (((reviewer_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))) AND (reviewer_type = 'center'::text)));
CREATE POLICY "Staff can insert reviews" ON public."shift_reviews" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((reviewer_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))) AND (reviewer_type = 'staff'::text)));
CREATE POLICY "Staff can view reviews about themselves" ON public."shift_reviews" AS PERMISSIVE FOR SELECT TO public USING ((reviewee_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Staff can view reviews they wrote" ON public."shift_reviews" AS PERMISSIVE FOR SELECT TO public USING (((reviewer_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))) AND (reviewer_type = 'staff'::text)));
CREATE POLICY "Authenticated users can view open shifts" ON public."shifts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((status = 'open'::shift_status) AND (shift_date >= CURRENT_DATE) AND (NOT (center_id IN ( SELECT get_user_regular_centers(auth.uid()) AS get_user_regular_centers)))));
CREATE POLICY "Center admins can manage shifts" ON public."shifts" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Staff can view shifts they are assigned to" ON public."shifts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id IN ( SELECT get_user_assigned_shifts(auth.uid()) AS get_user_assigned_shifts)));
CREATE POLICY "Super admins can manage all shifts" ON public."shifts" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can view linked staff credentials" ON public."staff_credentials" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((staff_id IN ( SELECT cs.staff_id
   FROM (center_staff cs
     JOIN center_admins ca ON ((ca.center_id = cs.center_id)))
  WHERE (ca.user_id = auth.uid()))));
CREATE POLICY "Staff own their credentials" ON public."staff_credentials" AS PERMISSIVE FOR ALL TO "authenticated" USING ((staff_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Super admins can manage all staff credentials" ON public."staff_credentials" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can view documents of their active staff" ON public."staff_documents" AS PERMISSIVE FOR SELECT TO public USING ((staff_id IN ( SELECT cs.staff_id
   FROM (center_staff cs
     JOIN center_admins ca ON ((ca.center_id = cs.center_id)))
  WHERE ((ca.user_id = auth.uid()) AND (cs.status = 'active'::center_staff_status)))));
CREATE POLICY "Center admins can view linked staff documents" ON public."staff_documents" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM (center_staff_document_status csds
     LEFT JOIN center_document_requirements r ON ((r.id = csds.requirement_id)))
  WHERE ((csds.matched_document_id = staff_documents.id) AND is_center_admin(csds.center_id) AND ((COALESCE(r.is_confidential, false) = false) OR can_view_confidential(csds.center_id))))));
CREATE POLICY "Center admins can view requested staff documents" ON public."staff_documents" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM document_requests dr
  WHERE ((dr.submitted_document_id = staff_documents.id) AND is_center_admin(dr.center_id) AND ((dr.is_confidential = false) OR can_view_confidential(dr.center_id))))));
CREATE POLICY "Center admins view documents shared with an application" ON public."staff_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM job_applications a
  WHERE ((a.resume_document_id = staff_documents.id) AND is_center_admin(a.center_id)))) OR (EXISTS ( SELECT 1
   FROM ((job_application_documents d
     JOIN job_applications a ON ((a.id = d.application_id)))
     JOIN center_document_requirements r ON ((r.id = d.requirement_id)))
  WHERE ((d.document_id = staff_documents.id) AND is_center_admin(a.center_id) AND ((NOT r.is_confidential) OR can_view_confidential(a.center_id)))))));
CREATE POLICY "Staff can manage their own documents" ON public."staff_documents" AS PERMISSIVE FOR ALL TO public USING ((staff_id = get_my_staff_id()));
CREATE POLICY "Super Admin Bypass" ON public."staff_documents" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all staff documents" ON public."staff_documents" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can view linked staff experiences" ON public."staff_experiences" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((staff_id IN ( SELECT cs.staff_id
   FROM (center_staff cs
     JOIN center_admins ca ON ((ca.center_id = cs.center_id)))
  WHERE (ca.user_id = auth.uid()))));
CREATE POLICY "Staff own their experiences" ON public."staff_experiences" AS PERMISSIVE FOR ALL TO "authenticated" USING ((staff_id IN ( SELECT staff_profiles.id
   FROM staff_profiles
  WHERE (staff_profiles.user_id = auth.uid()))));
CREATE POLICY "Super admins can manage all staff experiences" ON public."staff_experiences" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can view applicant profiles" ON public."staff_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (admin_can_see_staff(id, false));
CREATE POLICY "Center admins can view their center's staff profiles" ON public."staff_profiles" AS PERMISSIVE FOR SELECT TO public USING (admin_can_see_staff(id, true));
CREATE POLICY "Staff can update their own profile" ON public."staff_profiles" AS PERMISSIVE FOR UPDATE TO public USING ((user_id = auth.uid()));
CREATE POLICY "Staff can view and edit their own profile" ON public."staff_profiles" AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid()));
CREATE POLICY "Super Admin Bypass" ON public."staff_profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all staff profiles" ON public."staff_profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can view references of their staff" ON public."staff_references" AS PERMISSIVE FOR SELECT TO "authenticated" USING (admin_can_see_staff(staff_id, false));
CREATE POLICY "Staff own their references" ON public."staff_references" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_own_staff_profile(staff_id)) WITH CHECK (is_own_staff_profile(staff_id));
CREATE POLICY "Super admins can manage all staff references" ON public."staff_references" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "delete_own_center_roles" ON public."staff_role_types" AS PERMISSIVE FOR DELETE TO public USING (((center_id IS NOT NULL) AND (center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))));
CREATE POLICY "insert_own_center_roles" ON public."staff_role_types" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((center_id IS NOT NULL) AND (center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))));
CREATE POLICY "read_own_center_roles" ON public."staff_role_types" AS PERMISSIVE FOR SELECT TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "read_platform_defaults" ON public."staff_role_types" AS PERMISSIVE FOR SELECT TO public USING ((center_id IS NULL));
CREATE POLICY "update_own_center_roles" ON public."staff_role_types" AS PERMISSIVE FOR UPDATE TO public USING (((center_id IS NOT NULL) AND (center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid())))));
CREATE POLICY "Admins can create subscriptions for their center" ON public."subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Admins can view their own center subscriptions" ON public."subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super Admin Bypass" ON public."subscriptions" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all subscriptions" ON public."subscriptions" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Center admins can create tickets" ON public."support_tickets" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Center admins can view their center's tickets" ON public."support_tickets" AS PERMISSIVE FOR SELECT TO public USING ((center_id IN ( SELECT center_admins.center_id
   FROM center_admins
  WHERE (center_admins.user_id = auth.uid()))));
CREATE POLICY "Super admins can update tickets" ON public."support_tickets" AS PERMISSIVE FOR UPDATE TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Super admins can view all tickets" ON public."support_tickets" AS PERMISSIVE FOR SELECT TO public USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));
CREATE POLICY "Service role has full access to user_notification_settings" ON public."user_notification_settings" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can update own user_notification_settings" ON public."user_notification_settings" AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own user_notification_settings" ON public."user_notification_settings" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Center admins can manage their classrooms" ON public."work_areas" AS PERMISSIVE FOR ALL TO public USING ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers))) WITH CHECK ((center_id IN ( SELECT get_my_admin_centers() AS get_my_admin_centers)));
CREATE POLICY "Staff can view all classrooms" ON public."work_areas" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Super Admin Bypass" ON public."work_areas" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_super_admin());
CREATE POLICY "Super admins can manage all classrooms" ON public."work_areas" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'is_super_admin'::text))::boolean = true));

-- Privileges (exactly what the source database grants)
REVOKE ALL ON public."subscriptions" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."subscriptions" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."subscriptions" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."subscriptions" TO "service_role";
REVOKE ALL ON public."center_staff_document_status" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff_document_status" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff_document_status" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff_document_status" TO "service_role";
REVOKE ALL ON public."work_areas" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."work_areas" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."work_areas" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."work_areas" TO "service_role";
REVOKE ALL ON public."notifications" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notifications" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notifications" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notifications" TO "service_role";
REVOKE ALL ON public."staff_profiles" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_profiles" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_profiles" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_profiles" TO "service_role";
REVOKE ALL ON public."center_admins" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_admins" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_admins" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_admins" TO "service_role";
REVOKE ALL ON public."staff_documents" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_documents" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_documents" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_documents" TO "service_role";
REVOKE ALL ON public."staff_role_types" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_role_types" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_role_types" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_role_types" TO "service_role";
REVOKE ALL ON public."shift_claims" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_claims" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_claims" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_claims" TO "service_role";
REVOKE ALL ON public."shifts" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shifts" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shifts" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shifts" TO "service_role";
REVOKE ALL ON public."center_staff" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_staff" TO "service_role";
REVOKE ALL ON public."staff_credentials" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_credentials" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_credentials" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_credentials" TO "service_role";
REVOKE ALL ON public."staff_experiences" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_experiences" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_experiences" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_experiences" TO "service_role";
REVOKE ALL ON public."shift_reviews" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_reviews" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_reviews" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."shift_reviews" TO "service_role";
REVOKE ALL ON public."app_notifications" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."app_notifications" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."app_notifications" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."app_notifications" TO "service_role";
REVOKE ALL ON public."support_tickets" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."support_tickets" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."support_tickets" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."support_tickets" TO "service_role";
REVOKE ALL ON public."center_lookups" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_lookups" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_lookups" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_lookups" TO "service_role";
REVOKE ALL ON public."user_notification_settings" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."user_notification_settings" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."user_notification_settings" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."user_notification_settings" TO "service_role";
REVOKE ALL ON public."push_subscriptions" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."push_subscriptions" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."push_subscriptions" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."push_subscriptions" TO "service_role";
REVOKE ALL ON public."native_push_tokens" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."native_push_tokens" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."native_push_tokens" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."native_push_tokens" TO "service_role";
REVOKE ALL ON public."notification_preferences" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notification_preferences" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notification_preferences" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."notification_preferences" TO "service_role";
REVOKE ALL ON public."metro_areas" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."metro_areas" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."metro_areas" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."metro_areas" TO "service_role";
REVOKE ALL ON public."center_internal_documents" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_internal_documents" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_internal_documents" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_internal_documents" TO "service_role";
REVOKE ALL ON public."center_team_members" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_team_members" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_team_members" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_team_members" TO "service_role";
REVOKE ALL ON public."center_programs" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_programs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_programs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_programs" TO "service_role";
REVOKE ALL ON public."center_about_items" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_about_items" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_about_items" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_about_items" TO "service_role";
REVOKE ALL ON public."center_vendors" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_vendors" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_vendors" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_vendors" TO "service_role";
REVOKE ALL ON public."center_inspections" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspections" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspections" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspections" TO "service_role";
REVOKE ALL ON public."center_inspection_logs" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_logs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_logs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_logs" TO "service_role";
REVOKE ALL ON public."center_inspection_files" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_files" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_files" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_inspection_files" TO "service_role";
REVOKE ALL ON public."center_document_requirements" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_document_requirements" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_document_requirements" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_document_requirements" TO "service_role";
REVOKE ALL ON public."document_requests" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_requests" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_requests" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_requests" TO "service_role";
REVOKE ALL ON public."upload_handoffs" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."upload_handoffs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."upload_handoffs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."upload_handoffs" TO "service_role";
REVOKE ALL ON public."requirement_templates" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."requirement_templates" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."requirement_templates" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."requirement_templates" TO "service_role";
REVOKE ALL ON public."staff_references" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_references" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_references" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."staff_references" TO "service_role";
REVOKE ALL ON public."document_access_log" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_access_log" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_access_log" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."document_access_log" TO "service_role";
REVOKE ALL ON public."job_posting_requirements" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_posting_requirements" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_posting_requirements" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_posting_requirements" TO "service_role";
REVOKE ALL ON public."job_application_documents" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_documents" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_documents" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_documents" TO "service_role";
REVOKE ALL ON public."job_application_events" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_events" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_events" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_events" TO "service_role";
REVOKE ALL ON public."job_application_stage_history" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_stage_history" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_application_stage_history" TO "service_role";
REVOKE ALL ON public."job_alerts" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_alerts" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_alerts" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_alerts" TO "service_role";
REVOKE ALL ON public."job_postings" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_postings" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_postings" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_postings" TO "service_role";
REVOKE ALL ON public."centers" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."centers" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."centers" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."centers" TO "service_role";
REVOKE ALL ON public."job_applications" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_applications" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_applications" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."job_applications" TO "service_role";
REVOKE ALL ON public."center_tour_requests" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_tour_requests" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."center_tour_requests" TO "service_role";
REVOKE ALL ON public."children" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."children" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."children" TO "service_role";
REVOKE ALL ON public."child_guardians" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_guardians" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_guardians" TO "service_role";
REVOKE ALL ON public."child_documents" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_documents" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_documents" TO "service_role";
REVOKE ALL ON public."child_files" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_files" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_files" TO "service_role";
REVOKE ALL ON public."child_audit_log" FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."child_audit_log" TO "service_role";
GRANT SELECT ON public."child_audit_log" TO "authenticated";
REVOKE ALL ON FUNCTION hiring_in_progress() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hiring_in_progress() TO PUBLIC;
GRANT EXECUTE ON FUNCTION hiring_in_progress() TO "anon";
GRANT EXECUTE ON FUNCTION hiring_in_progress() TO "authenticated";
GRANT EXECUTE ON FUNCTION hiring_in_progress() TO "service_role";
REVOKE ALL ON FUNCTION guard_job_offer_letter() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_job_offer_letter() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_job_offer_letter() TO "anon";
GRANT EXECUTE ON FUNCTION guard_job_offer_letter() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_job_offer_letter() TO "service_role";
REVOKE ALL ON FUNCTION log_child_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_child_change() TO "service_role";
REVOKE ALL ON FUNCTION leave_center(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION leave_center(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION leave_center(uuid) TO "service_role";
REVOKE ALL ON FUNCTION check_inspection_file() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_inspection_file() TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_inspection_file() TO "anon";
GRANT EXECUTE ON FUNCTION check_inspection_file() TO "authenticated";
GRANT EXECUTE ON FUNCTION check_inspection_file() TO "service_role";
REVOKE ALL ON FUNCTION can_view_confidential(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_view_confidential(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION can_view_confidential(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION can_view_confidential(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION can_view_confidential(uuid) TO "service_role";
REVOKE ALL ON FUNCTION create_document_requests(uuid,uuid[],uuid,text,text,date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_document_requests(uuid,uuid[],uuid,text,text,date) TO "authenticated";
GRANT EXECUTE ON FUNCTION create_document_requests(uuid,uuid[],uuid,text,text,date) TO "service_role";
REVOKE ALL ON FUNCTION is_own_staff_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_own_staff_profile(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION is_own_staff_profile(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION is_own_staff_profile(uuid) TO "service_role";
REVOKE ALL ON FUNCTION is_super_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_super_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION is_super_admin() TO "anon";
GRANT EXECUTE ON FUNCTION is_super_admin() TO "authenticated";
GRANT EXECUTE ON FUNCTION is_super_admin() TO "service_role";
REVOKE ALL ON FUNCTION guard_account_active_flag() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_account_active_flag() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_account_active_flag() TO "anon";
GRANT EXECUTE ON FUNCTION guard_account_active_flag() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_account_active_flag() TO "service_role";
REVOKE ALL ON FUNCTION resolve_document_request(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolve_document_request(uuid,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION resolve_document_request(uuid,text,text) TO "service_role";
REVOKE ALL ON FUNCTION archive_unfilled_shifts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION archive_unfilled_shifts() TO PUBLIC;
GRANT EXECUTE ON FUNCTION archive_unfilled_shifts() TO "anon";
GRANT EXECUTE ON FUNCTION archive_unfilled_shifts() TO "authenticated";
GRANT EXECUTE ON FUNCTION archive_unfilled_shifts() TO "service_role";
REVOKE ALL ON FUNCTION is_center_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_center_admin(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION is_center_admin(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION is_center_admin(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION is_center_admin(uuid) TO "service_role";
REVOKE ALL ON FUNCTION check_child_requirement() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_child_requirement() TO "service_role";
REVOKE ALL ON FUNCTION withdraw_job_application(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION withdraw_job_application(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION withdraw_job_application(uuid) TO "service_role";
REVOKE ALL ON FUNCTION admin_can_see_staff(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_can_see_staff(uuid,boolean) TO "anon";
GRANT EXECUTE ON FUNCTION admin_can_see_staff(uuid,boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION admin_can_see_staff(uuid,boolean) TO "service_role";
REVOKE ALL ON FUNCTION guard_document_status_admin_fields() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_document_status_admin_fields() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_document_status_admin_fields() TO "anon";
GRANT EXECUTE ON FUNCTION guard_document_status_admin_fields() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_document_status_admin_fields() TO "service_role";
REVOKE ALL ON FUNCTION get_user_claimed_shifts(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_claimed_shifts(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_claimed_shifts(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION get_user_claimed_shifts(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION get_user_claimed_shifts(uuid) TO "service_role";
REVOKE ALL ON FUNCTION sync_requests_with_review() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_requests_with_review() TO PUBLIC;
GRANT EXECUTE ON FUNCTION sync_requests_with_review() TO "anon";
GRANT EXECUTE ON FUNCTION sync_requests_with_review() TO "authenticated";
GRANT EXECUTE ON FUNCTION sync_requests_with_review() TO "service_role";
REVOKE ALL ON FUNCTION get_user_assigned_shifts(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_assigned_shifts(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_assigned_shifts(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION get_user_assigned_shifts(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION get_user_assigned_shifts(uuid) TO "service_role";
REVOKE ALL ON FUNCTION log_job_application_stage() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_job_application_stage() TO PUBLIC;
GRANT EXECUTE ON FUNCTION log_job_application_stage() TO "anon";
GRANT EXECUTE ON FUNCTION log_job_application_stage() TO "authenticated";
GRANT EXECUTE ON FUNCTION log_job_application_stage() TO "service_role";
REVOKE ALL ON FUNCTION handle_new_user_preferences() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION handle_new_user_preferences() TO PUBLIC;
GRANT EXECUTE ON FUNCTION handle_new_user_preferences() TO "anon";
GRANT EXECUTE ON FUNCTION handle_new_user_preferences() TO "authenticated";
GRANT EXECUTE ON FUNCTION handle_new_user_preferences() TO "service_role";
REVOKE ALL ON FUNCTION guard_job_posting() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_job_posting() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_job_posting() TO "anon";
GRANT EXECUTE ON FUNCTION guard_job_posting() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_job_posting() TO "service_role";
REVOKE ALL ON FUNCTION check_inspection_center_consistency() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_inspection_center_consistency() TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_inspection_center_consistency() TO "anon";
GRANT EXECUTE ON FUNCTION check_inspection_center_consistency() TO "authenticated";
GRANT EXECUTE ON FUNCTION check_inspection_center_consistency() TO "service_role";
REVOKE ALL ON FUNCTION list_active_metros() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION list_active_metros() TO "anon";
GRANT EXECUTE ON FUNCTION list_active_metros() TO "authenticated";
GRANT EXECUTE ON FUNCTION list_active_metros() TO "service_role";
REVOKE ALL ON FUNCTION decline_job_offer(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION decline_job_offer(uuid,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION decline_job_offer(uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION set_current_timestamp_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_current_timestamp_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION set_current_timestamp_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION set_current_timestamp_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION set_current_timestamp_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION cancel_claims_on_regular_employment() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_claims_on_regular_employment() TO PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_claims_on_regular_employment() TO "anon";
GRANT EXECUTE ON FUNCTION cancel_claims_on_regular_employment() TO "authenticated";
GRANT EXECUTE ON FUNCTION cancel_claims_on_regular_employment() TO "service_role";
REVOKE ALL ON FUNCTION is_own_staff(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_own_staff(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION is_own_staff(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION is_own_staff(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION is_own_staff(uuid) TO "service_role";
REVOKE ALL ON FUNCTION reapply_to_center(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION reapply_to_center(uuid,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION reapply_to_center(uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION guard_jobs_enabled_flag() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_jobs_enabled_flag() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_jobs_enabled_flag() TO "anon";
GRANT EXECUTE ON FUNCTION guard_jobs_enabled_flag() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_jobs_enabled_flag() TO "service_role";
REVOKE ALL ON FUNCTION mark_offer_letter_viewed(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_offer_letter_viewed(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION mark_offer_letter_viewed(uuid) TO "service_role";
REVOKE ALL ON FUNCTION rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO PUBLIC;
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO "anon";
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO "authenticated";
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO "service_role";
REVOKE ALL ON FUNCTION submit_document_request(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_document_request(uuid,uuid,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION submit_document_request(uuid,uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION handle_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION handle_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION handle_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION handle_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION job_post_limit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION job_post_limit(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION job_post_limit(uuid) TO "service_role";
REVOKE ALL ON FUNCTION get_my_staff_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_my_staff_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_staff_id() TO "anon";
GRANT EXECUTE ON FUNCTION get_my_staff_id() TO "authenticated";
GRANT EXECUTE ON FUNCTION get_my_staff_id() TO "service_role";
REVOKE ALL ON FUNCTION revoke_admin_when_not_regular() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION revoke_admin_when_not_regular() TO PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_admin_when_not_regular() TO "anon";
GRANT EXECUTE ON FUNCTION revoke_admin_when_not_regular() TO "authenticated";
GRANT EXECUTE ON FUNCTION revoke_admin_when_not_regular() TO "service_role";
REVOKE ALL ON FUNCTION handle_new_user_notification_settings() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION handle_new_user_notification_settings() TO PUBLIC;
GRANT EXECUTE ON FUNCTION handle_new_user_notification_settings() TO "anon";
GRANT EXECUTE ON FUNCTION handle_new_user_notification_settings() TO "authenticated";
GRANT EXECUTE ON FUNCTION handle_new_user_notification_settings() TO "service_role";
REVOKE ALL ON FUNCTION can_use_child_files(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_use_child_files(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION can_use_child_files(uuid) TO "service_role";
REVOKE ALL ON FUNCTION set_user_domain_key(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_user_domain_key(uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION get_user_regular_centers(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_regular_centers(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_regular_centers(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION get_user_regular_centers(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION get_user_regular_centers(uuid) TO "service_role";
REVOKE ALL ON FUNCTION job_center_in_my_metro(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION job_center_in_my_metro(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION job_center_in_my_metro(uuid) TO "service_role";
REVOKE ALL ON FUNCTION protect_accepted_staff_document() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION protect_accepted_staff_document() TO PUBLIC;
GRANT EXECUTE ON FUNCTION protect_accepted_staff_document() TO "anon";
GRANT EXECUTE ON FUNCTION protect_accepted_staff_document() TO "authenticated";
GRANT EXECUTE ON FUNCTION protect_accepted_staff_document() TO "service_role";
REVOKE ALL ON FUNCTION staff_center_role(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_center_role(uuid,uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION staff_center_role(uuid,uuid) TO "anon";
GRANT EXECUTE ON FUNCTION staff_center_role(uuid,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION staff_center_role(uuid,uuid) TO "service_role";
REVOKE ALL ON FUNCTION acknowledge_requirement(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION acknowledge_requirement(uuid,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION acknowledge_requirement(uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION apply_to_job(uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_to_job(uuid,text,jsonb,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION apply_to_job(uuid,text,jsonb,uuid) TO "service_role";
REVOKE ALL ON FUNCTION protect_accepted_document_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION protect_accepted_document_status() TO PUBLIC;
GRANT EXECUTE ON FUNCTION protect_accepted_document_status() TO "anon";
GRANT EXECUTE ON FUNCTION protect_accepted_document_status() TO "authenticated";
GRANT EXECUTE ON FUNCTION protect_accepted_document_status() TO "service_role";
REVOKE ALL ON FUNCTION get_my_admin_centers() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_my_admin_centers() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_admin_centers() TO "anon";
GRANT EXECUTE ON FUNCTION get_my_admin_centers() TO "authenticated";
GRANT EXECUTE ON FUNCTION get_my_admin_centers() TO "service_role";
REVOKE ALL ON FUNCTION child_limit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION child_limit(uuid) TO "service_role";
REVOKE ALL ON FUNCTION guard_center_staff_employment_class() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_center_staff_employment_class() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_center_staff_employment_class() TO "anon";
GRANT EXECUTE ON FUNCTION guard_center_staff_employment_class() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_center_staff_employment_class() TO "service_role";
REVOKE ALL ON FUNCTION schedule_job_interview(uuid,timestamp with time zone,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION schedule_job_interview(uuid,timestamp with time zone,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION schedule_job_interview(uuid,timestamp with time zone,text,text) TO "service_role";
REVOKE ALL ON FUNCTION guard_shift_claim_employment_class() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_shift_claim_employment_class() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_shift_claim_employment_class() TO "anon";
GRANT EXECUTE ON FUNCTION guard_shift_claim_employment_class() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_shift_claim_employment_class() TO "service_role";
REVOKE ALL ON FUNCTION guard_child_files_flag() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_child_files_flag() TO "service_role";
REVOKE ALL ON FUNCTION enforce_document_key_namespace() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_document_key_namespace() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_document_key_namespace() TO "anon";
GRANT EXECUTE ON FUNCTION enforce_document_key_namespace() TO "authenticated";
GRANT EXECUTE ON FUNCTION enforce_document_key_namespace() TO "service_role";
REVOKE ALL ON FUNCTION send_job_offer(uuid,date,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION send_job_offer(uuid,date,numeric,text,text,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION send_job_offer(uuid,date,numeric,text,text,text,text) TO "service_role";
REVOKE ALL ON FUNCTION publish_policy_update(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION publish_policy_update(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION publish_policy_update(uuid) TO "service_role";
REVOKE ALL ON FUNCTION sync_center_admin_domain_key() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_center_admin_domain_key() TO PUBLIC;
GRANT EXECUTE ON FUNCTION sync_center_admin_domain_key() TO "anon";
GRANT EXECUTE ON FUNCTION sync_center_admin_domain_key() TO "authenticated";
GRANT EXECUTE ON FUNCTION sync_center_admin_domain_key() TO "service_role";
REVOKE ALL ON FUNCTION guard_child_row() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_child_row() TO "service_role";
REVOKE ALL ON FUNCTION get_my_claimed_shift_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_my_claimed_shift_ids() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_claimed_shift_ids() TO "anon";
GRANT EXECUTE ON FUNCTION get_my_claimed_shift_ids() TO "authenticated";
GRANT EXECUTE ON FUNCTION get_my_claimed_shift_ids() TO "service_role";
REVOKE ALL ON FUNCTION set_center_admin_access(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_center_admin_access(uuid,uuid,boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION set_center_admin_access(uuid,uuid,boolean) TO "service_role";
REVOKE ALL ON FUNCTION sync_staff_profile_domain_key() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_staff_profile_domain_key() TO PUBLIC;
GRANT EXECUTE ON FUNCTION sync_staff_profile_domain_key() TO "anon";
GRANT EXECUTE ON FUNCTION sync_staff_profile_domain_key() TO "authenticated";
GRANT EXECUTE ON FUNCTION sync_staff_profile_domain_key() TO "service_role";
REVOKE ALL ON FUNCTION move_application_stage(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION move_application_stage(uuid,text,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION move_application_stage(uuid,text,text,text) TO "service_role";
REVOKE ALL ON FUNCTION touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION touch_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION touch_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION touch_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION touch_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION enforce_child_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_child_limit() TO "service_role";
REVOKE ALL ON FUNCTION enforce_regular_single_center() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_regular_single_center() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_regular_single_center() TO "anon";
GRANT EXECUTE ON FUNCTION enforce_regular_single_center() TO "authenticated";
GRANT EXECUTE ON FUNCTION enforce_regular_single_center() TO "service_role";
REVOKE ALL ON FUNCTION check_child_file_key() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_child_file_key() TO "service_role";
REVOKE ALL ON FUNCTION accept_job_offer(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION accept_job_offer(uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION accept_job_offer(uuid) TO "service_role";
REVOKE ALL ON FUNCTION guard_center_staff_self_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION guard_center_staff_self_status() TO PUBLIC;
GRANT EXECUTE ON FUNCTION guard_center_staff_self_status() TO "anon";
GRANT EXECUTE ON FUNCTION guard_center_staff_self_status() TO "authenticated";
GRANT EXECUTE ON FUNCTION guard_center_staff_self_status() TO "service_role";

-- Platform data every center depends on (shared dropdown defaults, role types, metro areas). No center, staff or child data.
INSERT INTO public."center_lookups" SELECT * FROM jsonb_populate_recordset(null::public."center_lookups", '[{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"f25864c1-20d8-4a14-9801-13bb9a539509","is_active":true,"label":"Identity (ID/Passport)","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"identity"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"dc9b7466-5edc-4026-9b80-fb8c5260002c","is_active":true,"label":"Certification (CPR/First Aid)","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"certification"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"81c0da46-8b96-4ff8-ac96-47397e2cd496","is_active":true,"label":"Background Check","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"background"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"0f4ce99d-9641-48bb-ab5b-af7bc6c6e587","is_active":true,"label":"Training","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"training"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"9b7bda70-9251-4c92-8a43-a747f5809b14","is_active":true,"label":"Medical/Health","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"medical"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"dee6f2a1-99a6-4ced-b3f8-7df4187a0ffa","is_active":true,"label":"Documentation","sort_order":6,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"documentation"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"23e57a0f-37a5-409f-ae05-a1852dfb6d5c","is_active":true,"label":"Academic Qualification","sort_order":7,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"academic_qualification"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Document Type","id":"8f1ffd5f-e3f2-4d68-9b5a-455fe68cb15d","is_active":true,"label":"Other","sort_order":8,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"other"},{"center_id":null,"created_at":"2026-10-18T14:03:44.816807+00:00","domain_key":"childcare","group_name":"Document Type","id":"1bfd0a47-f5f3-4204-8a67-1849829935cd","is_active":true,"label":"Resume","sort_order":9,"updated_at":"2026-10-18T14:03:44.816807+00:00","value":"resume"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Document Type","id":"d337ef79-df37-438e-bf16-8fce53e42b15","is_active":true,"label":"State Professional License","sort_order":1,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"license"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Document Type","id":"b770ea0e-ae3c-4b32-a97b-13d118d65211","is_active":true,"label":"BLS / CPR Certification","sort_order":2,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"bls_cpr"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Document Type","id":"3a0bba88-029b-462b-a3f4-c37c30b02ebb","is_active":true,"label":"Background & Drug Screen","sort_order":3,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"background_drug"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Document Type","id":"902451d6-0b43-4a0a-a01e-41fbd71e35a2","is_active":true,"label":"Immunization & Health Records","sort_order":4,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"immunization"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Document Type","id":"b5b9e39b-c414-49a8-9123-29a6983cdae1","is_active":true,"label":"Other Credentials","sort_order":5,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"other"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Document Type","id":"4e407b2f-cde5-46bd-b597-75b9c3d7d4f0","is_active":true,"label":"Background Check","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"background_check"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Document Type","id":"9cab5d44-100b-4574-9e4a-2f7831ffd7d9","is_active":true,"label":"CPR / First Aid Certification","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cpr_first_aid"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Document Type","id":"8b94a2ce-85c9-466b-b84c-41b52b7ccc83","is_active":true,"label":"Caregiver Training","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"caregiver_training"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Document Type","id":"a7de3051-caa1-45c7-9f0b-b0ae81afa623","is_active":true,"label":"Medication Training","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"medication_training"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Document Type","id":"df986085-b63b-42b1-b147-73276e70cb0b","is_active":true,"label":"Other Credentials","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"other"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"c153fb28-049d-45d9-9e12-4f11199d768b","is_active":true,"label":"Fire Marshal Inspection","sort_order":1,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_marshal"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"66ae071f-932b-4416-8647-d18dae85bc2c","is_active":true,"label":"Fire Extinguisher Service","sort_order":2,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_extinguisher"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"9439aa06-e46e-4b92-8701-2a77c4d24313","is_active":true,"label":"Fire Alarm / Sprinkler Test","sort_order":3,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_alarm_sprinkler"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"1749d8c8-f16c-43a4-bb90-1db858aa1442","is_active":true,"label":"Health / Sanitation Inspection","sort_order":4,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"health_sanitation"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"b694a983-2e64-40ca-a45d-5e8628d16c18","is_active":true,"label":"State Licensing Visit","sort_order":5,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"state_licensing"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"d4f810fe-ca86-4e81-b806-3bfca68456ff","is_active":true,"label":"Playground Safety Inspection","sort_order":6,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"playground_safety"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"d1c50ae7-1756-4e96-8813-f6c07e840d50","is_active":true,"label":"Pest Control","sort_order":7,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"pest_control"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"884d5a88-5ec9-467c-92d0-e918e1e3a1a6","is_active":true,"label":"HVAC Service","sort_order":8,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"hvac"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"95947367-4a89-440f-b30e-31cd2ff7380b","is_active":true,"label":"Water Quality / Lead Testing","sort_order":9,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"water_quality"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"childcare","group_name":"Inspection Type","id":"ad543e9c-e9ec-486f-aef8-6b4e4b02b53d","is_active":true,"label":"Kitchen Hood Cleaning","sort_order":10,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"kitchen_hood"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"b735e4ae-72e6-419a-bfe8-19b8e7918279","is_active":true,"label":"Fire Marshal Inspection","sort_order":1,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_marshal"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"72d4b725-39f1-4d65-8ecf-31a60474265d","is_active":true,"label":"Fire Extinguisher Service","sort_order":2,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_extinguisher"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"8a5fc014-f588-4847-9a63-dd1730bdbf35","is_active":true,"label":"Fire Alarm / Sprinkler Test","sort_order":3,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"fire_alarm_sprinkler"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"3857c32e-3e4e-4505-8004-02018cb48f26","is_active":true,"label":"State Survey / Licensing Inspection","sort_order":4,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"state_survey"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"93dd0563-5645-4e03-bdd6-7965ec98e130","is_active":true,"label":"Health Department Inspection","sort_order":5,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"health_department"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"22ff7f5b-3d25-4764-a0a6-13f1a8c40d59","is_active":true,"label":"Medical Equipment Calibration","sort_order":6,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"equipment_calibration"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"53bfe461-3b20-481c-b63d-8ee2b1a18704","is_active":true,"label":"Generator Load Test","sort_order":7,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"generator"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"c6b741d8-5215-481e-b866-3bdcd6eca188","is_active":true,"label":"Pest Control","sort_order":8,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"pest_control"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"654085a6-d752-456b-a986-e1308f1200df","is_active":true,"label":"HVAC Service","sort_order":9,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"hvac"},{"center_id":null,"created_at":"2026-10-14T23:56:41.633107+00:00","domain_key":"healthcare","group_name":"Inspection Type","id":"d8514acd-dbeb-4454-8b51-d2332c909d02","is_active":true,"label":"Elevator Inspection","sort_order":10,"updated_at":"2026-10-14T23:56:41.633107+00:00","value":"elevator"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"46fbdad0-3dcf-44b3-bfd6-6e6137e8691b","is_active":true,"label":"Payroll","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"payroll"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"51606ac0-db25-4862-b3a9-4c4c631af756","is_active":true,"label":"Direct Deposit","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"direct_deposit"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"6815aa4c-8b40-4717-87d8-99677f3fd7ca","is_active":true,"label":"Check","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"check"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"0b91ae10-26c5-4e23-8be3-1d277bea6b46","is_active":true,"label":"Cash","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cash"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"780f69a0-3e1d-49b9-b50d-44ae6c67c425","is_active":true,"label":"Zelle","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"zelle"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"017d93eb-c341-4100-91c9-54f70f461f4f","is_active":true,"label":"Venmo","sort_order":6,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"venmo"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"bf02ed66-6d52-40d2-a1c1-c6a1b895ceec","is_active":true,"label":"Cash App","sort_order":7,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cashapp"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Payment Method","id":"762086df-31df-42af-bd82-9ca09d0043e8","is_active":true,"label":"PayPal","sort_order":8,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"paypal"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"c4f818a1-05cc-4e1d-b64e-156b3569f314","is_active":true,"label":"Payroll","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"payroll"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"fe63a134-5493-4f44-966a-c7987bddf483","is_active":true,"label":"Direct Deposit","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"direct_deposit"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"c9cc364b-a310-41f0-9b72-150e28f7105f","is_active":true,"label":"Check","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"check"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"5ee09547-f4b4-4cee-830e-ccfff9885df8","is_active":true,"label":"Cash","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cash"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"0f3f4b2a-284b-4485-994b-5843f2bee03a","is_active":true,"label":"Zelle","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"zelle"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"bdf570e2-7743-4251-a93f-fbf3307d418e","is_active":true,"label":"Venmo","sort_order":6,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"venmo"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"a90be836-9d14-4543-a3c2-a44d711f809b","is_active":true,"label":"Cash App","sort_order":7,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cashapp"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"healthcare","group_name":"Payment Method","id":"33c47b5f-abe9-4818-aff9-3a6ba938b6ed","is_active":true,"label":"PayPal","sort_order":8,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"paypal"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"00c7816b-f4fd-4ed1-b3c0-a2a58b2f1d9f","is_active":true,"label":"Payroll","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"payroll"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"23a4f5cd-a3e1-4a94-b632-617732fe231d","is_active":true,"label":"Direct Deposit","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"direct_deposit"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"ec28af08-46c8-4a63-92d4-3a45b2814360","is_active":true,"label":"Check","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"check"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"ec60667e-ba9f-435f-87b9-fdb3d3f702b9","is_active":true,"label":"Cash","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cash"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"04b006db-fb2c-4633-ae8a-f30372bbc260","is_active":true,"label":"Zelle","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"zelle"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"d725bab7-7061-41a9-b84c-e87f0dffe9c1","is_active":true,"label":"Venmo","sort_order":6,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"venmo"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"87f3a9c8-e0ba-42e3-9d1c-fd787db6403e","is_active":true,"label":"Cash App","sort_order":7,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cashapp"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Payment Method","id":"069473fa-bc2a-45e7-bcf4-4a7ca58a4df4","is_active":true,"label":"PayPal","sort_order":8,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"paypal"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Role","id":"db5ec3fc-71e6-4f83-ac69-0f68e35a8b15","is_active":true,"label":"Teacher","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"teacher"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Role","id":"b35bdc64-eba6-4b03-b5b4-6f388ea84b39","is_active":true,"label":"Floater","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"floater"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Role","id":"ef8ef7af-fd1e-4ce4-a556-385eb4110ee4","is_active":true,"label":"Support Staff","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"support"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"childcare","group_name":"Role","id":"e4497cbe-5ef2-4ef6-b024-69e49a1ebb46","is_active":true,"label":"Cook","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"cook"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Role","id":"68a1fccf-438d-4940-b514-1f6ccf137ece","is_active":true,"label":"Nurse (RN/LPN)","sort_order":1,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"nurse"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Role","id":"3ce5b395-aa8c-4a4e-af01-885005c7bb38","is_active":true,"label":"Certified Nursing Assistant (CNA)","sort_order":2,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"cna"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Role","id":"b698aa06-fb36-4305-b772-94dbf695b995","is_active":true,"label":"Caregiver","sort_order":3,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"caregiver"},{"center_id":null,"created_at":"2026-06-25T03:06:42.311256+00:00","domain_key":"healthcare","group_name":"Role","id":"722fecbb-f10a-4f6a-b8f9-923b87b0fc8a","is_active":true,"label":"Therapist","sort_order":4,"updated_at":"2026-06-25T03:06:42.311256+00:00","value":"therapist"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Role","id":"27b442d5-105d-485c-a7a2-d9d657c456f1","is_active":true,"label":"Caregiver","sort_order":1,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"caregiver"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Role","id":"59c75ae0-62b8-4385-8211-59115d54211a","is_active":true,"label":"Home Health Aide","sort_order":2,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"home_health_aide"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Role","id":"57c165a9-5df5-4847-b1c2-2e40934600eb","is_active":true,"label":"Personal Care Assistant","sort_order":3,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"personal_care_assistant"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Role","id":"55d66ce4-9381-4c49-9620-53cf7e1e868d","is_active":true,"label":"Medication Aide","sort_order":4,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"medication_aide"},{"center_id":null,"created_at":"2026-10-15T11:59:36.226992+00:00","domain_key":"senior","group_name":"Role","id":"47dec9c9-7118-4399-aab8-7271b0253868","is_active":true,"label":"Activities Assistant","sort_order":5,"updated_at":"2026-10-15T11:59:36.226992+00:00","value":"activities_assistant"}]'::jsonb);
INSERT INTO public."staff_role_types" SELECT * FROM jsonb_populate_recordset(null::public."staff_role_types", '[{"center_id":null,"created_at":"2026-04-18T14:01:47.100976+00:00","id":"fcfa91b0-34de-417e-b076-613827d22f9c","is_active":true,"label":"Teacher","sort_order":1,"value":"teacher"},{"center_id":null,"created_at":"2026-04-18T14:01:47.100976+00:00","id":"5e7ae5fc-227d-4265-97b1-ce1b862707c0","is_active":true,"label":"Floater","sort_order":2,"value":"floater"},{"center_id":null,"created_at":"2026-04-18T14:01:47.100976+00:00","id":"6378c769-1662-43a3-8da3-16a0455f7825","is_active":true,"label":"Support Staff","sort_order":3,"value":"support"},{"center_id":null,"created_at":"2026-04-18T14:01:47.100976+00:00","id":"6aae8eec-e6da-44f2-b35c-153c54d150c0","is_active":true,"label":"Cook","sort_order":4,"value":"cook"}]'::jsonb);
INSERT INTO public."metro_areas" SELECT * FROM jsonb_populate_recordset(null::public."metro_areas", '[{"city":null,"created_at":"2026-04-13T19:39:09.49598+00:00","id":"7f0a0c58-0c57-4d59-a355-879db6bc8a1f","is_active":true,"name":"Atlanta Metro","slug":"atlanta-metro","staff_maintenance_fee":10,"state_code":"GA","timezone":"America/New_York"},{"city":"Charlotte","created_at":"2026-04-13T19:39:09.49598+00:00","id":"4e1b7591-95cf-454e-8419-be5362975d95","is_active":true,"name":"Charlotte Metro","slug":"charlotte-metro","staff_maintenance_fee":5,"state_code":"NC","timezone":"America/New_York"},{"city":null,"created_at":"2026-04-13T19:39:09.49598+00:00","id":"daf2a1ed-8356-45b0-83db-a60a00a5317c","is_active":true,"name":"Columbia Metro","slug":"columbia-sc","staff_maintenance_fee":5,"state_code":"SC","timezone":"America/New_York"},{"city":null,"created_at":"2026-04-13T19:39:09.49598+00:00","id":"d5b28691-7a56-44ec-a7ab-b82d3dc60918","is_active":true,"name":"Greensboro-Triad","slug":"greensboro-triad","staff_maintenance_fee":5,"state_code":"NC","timezone":"America/New_York"},{"city":null,"created_at":"2026-04-13T19:39:09.49598+00:00","id":"81d72359-4de9-4d89-9a1a-11764672c82c","is_active":true,"name":"Raleigh-Durham","slug":"raleigh-durham","staff_maintenance_fee":10,"state_code":"NC","timezone":"America/New_York"}]'::jsonb);
