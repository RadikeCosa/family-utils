SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
CREATE FUNCTION library_cast_is_valid(names text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT CASE
    WHEN names IS NULL THEN false
    WHEN cardinality(names) = 0 THEN true
    WHEN array_ndims(names) <> 1 OR cardinality(names) > 30 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(names) AS entry(name)
      WHERE name IS NULL OR char_length(name) NOT BETWEEN 1 AND 200
        OR name !~ '[^[:space:]]'
    )
  END
$function$;
--> statement-breakpoint
ALTER TABLE "library_works" ADD COLUMN "runtime_minutes" integer;--> statement-breakpoint
ALTER TABLE "library_works" ADD COLUMN "cast" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "library_works" ADD COLUMN "synopsis" text;--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_runtime" CHECK ("library_works"."runtime_minutes" IS NULL OR "library_works"."runtime_minutes" BETWEEN 1 AND 1440);--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_synopsis" CHECK ("library_works"."synopsis" IS NULL OR char_length("library_works"."synopsis") BETWEEN 1 AND 5000);--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_cast" CHECK (library_cast_is_valid("library_works"."cast"));