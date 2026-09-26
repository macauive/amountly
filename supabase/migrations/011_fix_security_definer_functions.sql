-- ============================================
-- Migration 011: Fix SECURITY DEFINER Functions and RLS Policies
-- ============================================
-- This migration fixes:
-- 1. "Mutable search_path" security issue in SECURITY DEFINER functions
-- 2. RLS policies for organization creation during signup
--
-- The search_path fix ensures auth.uid() resolves correctly in triggers.
-- The RLS policy fix allows new users to create and view organizations
-- before they have a record in the users table.
-- ============================================

-- Historical prerequisite: this column used to be created out of band.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1. Fix set_org_owner trigger function (THE CRITICAL FIX)
CREATE OR REPLACE FUNCTION set_org_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    IF NEW.owner_id IS NULL THEN
        NEW.owner_id := auth.uid();
    END IF;

    IF NEW.owner_id IS NULL THEN
        RAISE EXCEPTION 'Cannot create organization: no authenticated user found';
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Fix get_user_organization_id function
CREATE OR REPLACE FUNCTION get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
    SELECT organization_id FROM users WHERE id = auth.uid()
$$;

-- 3. Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 4. Fix generate_invoice_number function
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := 'INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;

-- 5. Fix calculate_line_item_amount function
CREATE OR REPLACE FUNCTION calculate_line_item_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.amount := NEW.quantity * NEW.rate;
    RETURN NEW;
END;
$$;

-- 6. Fix calculate_billable_rate function
CREATE OR REPLACE FUNCTION calculate_billable_rate(
    project_id_param UUID,
    task_id_param UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    rate NUMERIC;
BEGIN
    IF task_id_param IS NOT NULL THEN
        SELECT t.rate INTO rate
        FROM tasks t
        WHERE t.id = task_id_param AND t.rate IS NOT NULL;
        IF rate IS NOT NULL THEN
            RETURN rate;
        END IF;
    END IF;
    SELECT p.rate INTO rate
    FROM projects p
    WHERE p.id = project_id_param;
    RETURN rate;
END;
$$;

-- 7. Fix set_time_entry_billable_rate function
CREATE OR REPLACE FUNCTION set_time_entry_billable_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.billable_rate IS NULL THEN
        NEW.billable_rate := calculate_billable_rate(NEW.project_id, NEW.task_id);
    END IF;
    RETURN NEW;
END;
$$;

-- 8. Fix get_dashboard_metrics function
CREATE OR REPLACE FUNCTION get_dashboard_metrics(user_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    result JSON;
    today DATE := CURRENT_DATE;
    week_start DATE := today - (EXTRACT(DOW FROM today)::INTEGER);
BEGIN
    SELECT json_build_object(
        'hours_today', COALESCE((
            SELECT SUM(duration_minutes) / 60.0
            FROM time_entries WHERE user_id = user_id_param AND start_at::DATE = today
        ), 0),
        'hours_week', COALESCE((
            SELECT SUM(duration_minutes) / 60.0
            FROM time_entries WHERE user_id = user_id_param AND start_at >= week_start
        ), 0),
        'pending_expenses_count', COALESCE((
            SELECT COUNT(*) FROM expenses
            WHERE user_id = user_id_param AND status IN ('DRAFT', 'SUBMITTED')
        ), 0),
        'pending_approvals_count', COALESCE((
            SELECT COUNT(*) FROM time_entries
            WHERE user_id = user_id_param AND status = 'SUBMITTED'
        ), 0),
        'outstanding_invoices_count', COALESCE((
            SELECT COUNT(*) FROM invoices i
            JOIN users u ON u.organization_id = i.organization_id
            WHERE u.id = user_id_param AND i.status IN ('SENT', 'OVERDUE')
        ), 0)
    ) INTO result;
    RETURN result;
END;
$$;

-- 9. Fix get_business_metrics function
CREATE OR REPLACE FUNCTION get_business_metrics(user_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    result JSON;
    org_id UUID;
    month_start DATE := DATE_TRUNC('month', CURRENT_DATE);
BEGIN
    SELECT organization_id INTO org_id FROM users WHERE id = user_id_param;
    SELECT json_build_object(
        'total_revenue', COALESCE((
            SELECT SUM(total) FROM invoices
            WHERE organization_id = org_id AND status = 'PAID'
        ), 0),
        'outstanding_revenue', COALESCE((
            SELECT SUM(total) FROM invoices
            WHERE organization_id = org_id AND status IN ('SENT', 'OVERDUE')
        ), 0),
        'billable_hours_this_month', COALESCE((
            SELECT SUM(duration_minutes) / 60.0 FROM time_entries
            WHERE user_id = user_id_param AND start_at >= month_start AND billable_rate IS NOT NULL
        ), 0),
        'pending_invoices', COALESCE((
            SELECT COUNT(*) FROM invoices
            WHERE organization_id = org_id AND status IN ('SENT', 'OVERDUE')
        ), 0)
    ) INTO result;
    RETURN result;
END;
$$;

-- 10. Update RLS policies for organizations table
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can create orgs" ON organizations;

-- Allow authenticated users to create organizations (owner_id set by app or trigger)
CREATE POLICY "Authenticated users can create organizations"
    ON organizations
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_id IS NULL OR owner_id = auth.uid());

-- 11. Add SELECT policy for organization owners
-- This allows users to view organizations they own, even before they have a user record.
-- Required for INSERT...RETURNING to work during signup flow.
DROP POLICY IF EXISTS "Owners can view their organization by owner_id" ON organizations;

CREATE POLICY "Owners can view their organization by owner_id"
    ON organizations
    FOR SELECT
    TO authenticated
    USING (owner_id = auth.uid());
