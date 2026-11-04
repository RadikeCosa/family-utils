-- v1 is immutable as a contract. Future rules require a new function and backfill.
CREATE FUNCTION normalize_name_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(trim(regexp_replace(translate(normalize(value, NFC),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g')));
$$;
--> statement-breakpoint
-- Fail with no data changes if existing unique suggestions would collide.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM shopping_suggestions GROUP BY family_id, normalize_name_v1(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'NORMALIZATION_COLLISION: review shopping suggestions before applying normalization';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_normalized_name_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'meal_ideas' THEN NEW.normalized_title := normalize_name_v1(NEW.title);
  ELSE NEW.normalized_name := normalize_name_v1(NEW.name); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Two-phase update avoids transient unique conflicts when old keys differ.
UPDATE shopping_suggestions SET normalized_name = 'normalization-transition-' || id::text;
--> statement-breakpoint
UPDATE shopping_suggestions SET normalized_name = normalize_name_v1(name);
--> statement-breakpoint
UPDATE meal_ideas SET normalized_title = normalize_name_v1(title);

--> statement-breakpoint
CREATE TRIGGER meal_ideas_normalize_v1 BEFORE INSERT OR UPDATE ON meal_ideas
FOR EACH ROW EXECUTE FUNCTION sync_normalized_name_v1();
--> statement-breakpoint
CREATE TRIGGER shopping_suggestions_normalize_v1 BEFORE INSERT OR UPDATE ON shopping_suggestions
FOR EACH ROW EXECUTE FUNCTION sync_normalized_name_v1();
--> statement-breakpoint
