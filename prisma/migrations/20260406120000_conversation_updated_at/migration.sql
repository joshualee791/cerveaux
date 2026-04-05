-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "conversations" SET "updated_at" = "created_at" WHERE "updated_at" IS NOT NULL;
