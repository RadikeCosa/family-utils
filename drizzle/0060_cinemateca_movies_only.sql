SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
LOCK TABLE library_works IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM library_works WHERE kind <> 'movie') THEN
    RAISE EXCEPTION 'Cinemateca: existen contenidos que no son películas. Migración cancelada sin convertir ni borrar datos.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE library_works DROP CONSTRAINT library_works_kind;
--> statement-breakpoint
ALTER TABLE library_works ADD CONSTRAINT library_works_kind CHECK (kind = 'movie');
