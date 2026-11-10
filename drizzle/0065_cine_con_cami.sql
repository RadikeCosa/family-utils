SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
ALTER TABLE "library_works" ADD COLUMN "cine_with_cami" boolean DEFAULT false NOT NULL;
