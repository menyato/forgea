-- Hand-written: removing a test order also removes the quotation or custom request it was made
-- from (the owner's call, 2026-11-23: an admin controls every delete). Their status histories
-- stay append-only everywhere else: a delete passes only inside the one transaction
-- OrderRemoval marks with `set_config('forgea.removing', 'test-order', true)`, as the order's.

CREATE OR REPLACE FUNCTION refuse_quotation_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'quotation_status_history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION refuse_custom_request_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'custom_request_status_history is append-only';
END;
$$;
