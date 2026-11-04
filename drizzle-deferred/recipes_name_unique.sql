-- Separate rollout (2b). Not part of automatic db:migrate.
-- Apply only after inspecting and explicitly resolving reported collisions.
BEGIN;
LOCK TABLE meal_ideas IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM meal_ideas WHERE merged_into_id IS NULL GROUP BY family_id, normalized_title HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'RECIPE_NAME_COLLISION: resolve catalog collisions explicitly before applying index';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS meal_ideas_family_name_unique
ON meal_ideas(family_id, normalized_title) WHERE merged_into_id IS NULL;
COMMIT;
