ALTER TABLE "assignment" ALTER COLUMN "assignedByUserId" DROP NOT NULL;
ALTER TABLE "assignment" DROP CONSTRAINT IF EXISTS "assignment_assignedByUserId_fkey";
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;