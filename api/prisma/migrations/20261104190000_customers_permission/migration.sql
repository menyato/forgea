-- The new Customers page: Staff see it by default, like the code's defaults.
UPDATE "role_permissions"
SET "permissions" = array_append("permissions", 'customers.view'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'STAFF' AND NOT ('customers.view' = ANY("permissions"));
