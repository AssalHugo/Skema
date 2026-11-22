ALTER TABLE "chapters" ADD COLUMN "batches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "pdf_r2_key" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "structure_source" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "error" text;