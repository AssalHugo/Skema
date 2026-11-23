ALTER TABLE "episodes" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_generated_concept_uq" ON "episodes" USING btree ("concept_id") WHERE engine_type = 'generated';