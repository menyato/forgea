-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deniedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "grantedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "Role" NOT NULL,
    "permissions" TEXT[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role")
);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: the lists are never NULL (an empty list means "nothing").
UPDATE "users" SET "grantedPermissions" = '{}' WHERE "grantedPermissions" IS NULL;
UPDATE "users" SET "deniedPermissions" = '{}' WHERE "deniedPermissions" IS NULL;
ALTER TABLE "users" ALTER COLUMN "grantedPermissions" SET NOT NULL,
                    ALTER COLUMN "deniedPermissions" SET NOT NULL;
ALTER TABLE "role_permissions" ALTER COLUMN "permissions" SET NOT NULL;

-- Admins hold everything and customers nothing: only team roles have their own permissions.
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_team_role"
  CHECK ("role" IN ('STAFF', 'DESIGNER'));
ALTER TABLE "users" ADD CONSTRAINT "users_permissions_team_only"
  CHECK ("role" IN ('STAFF', 'DESIGNER')
         OR (cardinality("grantedPermissions") = 0 AND cardinality("deniedPermissions") = 0));

-- The defaults (DEFAULT_ROLE_PERMISSIONS in @forgea/types): what each role could do before.
INSERT INTO "role_permissions" ("role", "permissions", "updatedAt") VALUES
  ('STAFF', ARRAY['orders.view', 'orders.manage', 'production.manage', 'requests.view',
                  'requests.design', 'requests.quote', 'leads.view', 'leads.manage',
                  'quotations.view', 'quotations.manage', 'invoices.view', 'invoices.create',
                  'payments.record', 'materials.view'], now()),
  ('DESIGNER', ARRAY['requests.view', 'requests.design', 'catalog.view', 'catalog.manage',
                     'homebed.manage', 'materials.view'], now());
