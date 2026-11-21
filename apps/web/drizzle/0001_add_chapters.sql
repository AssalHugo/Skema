CREATE TYPE "public"."chapter_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"order_index" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"status" "chapter_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "course_diagrams" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapters_course_id_idx" ON "chapters" USING btree ("course_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_diagrams" ADD CONSTRAINT "course_diagrams_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concepts_chapter_id_idx" ON "concepts" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "course_diagrams_chapter_id_idx" ON "course_diagrams" USING btree ("chapter_id");