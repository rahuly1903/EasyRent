-- Drop leftover size/color identity. Units are keyed by product + variant only.
ALTER TABLE "RentalUnit" DROP COLUMN IF EXISTS "size";
ALTER TABLE "RentalUnit" DROP COLUMN IF EXISTS "color";
