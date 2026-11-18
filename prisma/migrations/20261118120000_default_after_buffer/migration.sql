-- AlterTable
ALTER TABLE "Settings" ALTER COLUMN "defaultBufferAfter" SET DEFAULT 5;

-- Existing shops were created with the old default of 0.
UPDATE "Settings" SET "defaultBufferAfter" = 5 WHERE "defaultBufferAfter" = 0;
