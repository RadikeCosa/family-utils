ALTER TABLE meal_ideas ADD COLUMN normalized_title varchar(160) NOT NULL DEFAULT '';
ALTER TABLE meal_ideas ADD COLUMN merged_into_id uuid;
ALTER TABLE meal_ideas ADD COLUMN last_used_at timestamptz;
CREATE INDEX meal_ideas_catalog_order_idx ON meal_ideas(family_id, last_used_at);
CREATE INDEX meal_ideas_merged_idx ON meal_ideas(merged_into_id);

CREATE TEMP TABLE meal_catalog_name_map AS
WITH existing AS (
  SELECT id, family_id,
    lower(regexp_replace(translate(trim(title), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g')) AS normalized,
    first_value(id) OVER (PARTITION BY family_id, lower(regexp_replace(translate(trim(title), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g')) ORDER BY created_at, id) AS canonical_id
  FROM meal_ideas
), suggestion_names AS (
  SELECT s.id AS suggestion_id, s.slot_id, s.author_member_id, s.title, s.note, s.created_at,
    lower(regexp_replace(translate(trim(s.title), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g')) AS normalized,
    s.withdrawn_at IS NULL AS active,
    EXISTS (
      SELECT 1 FROM meal_selections ms WHERE ms.suggestion_id = s.id
      UNION ALL SELECT 1 FROM meal_groups mg WHERE mg.suggestion_id = s.id
      UNION ALL SELECT 1 FROM meal_daily_plans dp, jsonb_array_elements(dp.plan->'menus') m
        WHERE m->'selection'->>'suggestionId' = s.id::text
    ) AS selected,
    sl.family_id
  FROM meal_suggestions s JOIN meal_slots sl ON sl.id = s.slot_id
), missing AS (
  SELECT DISTINCT ON (sn.family_id, sn.normalized) sn.family_id, sn.normalized, sn.author_member_id, sn.title, sn.note, sn.created_at
  FROM suggestion_names sn
  WHERE (sn.active OR sn.selected)
    AND NOT EXISTS (SELECT 1 FROM existing e WHERE e.family_id = sn.family_id AND e.normalized = sn.normalized)
  ORDER BY sn.family_id, sn.normalized, sn.selected DESC, sn.created_at DESC, sn.suggestion_id
), inserted AS (
  INSERT INTO meal_ideas(family_id, author_member_id, title, note, normalized_title, last_used_at)
  SELECT family_id, author_member_id, title, note, normalized, created_at FROM missing
  RETURNING id, family_id, normalized_title
), canonical AS (
  SELECT DISTINCT family_id, normalized, canonical_id AS id FROM existing
  UNION ALL SELECT family_id, normalized_title, id FROM inserted
)
SELECT family_id, normalized, id FROM canonical;

UPDATE meal_ideas i SET normalized_title = lower(regexp_replace(translate(trim(i.title), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g'));
UPDATE meal_ideas duplicate SET merged_into_id = map.id, archived_at = COALESCE(duplicate.archived_at, now())
FROM meal_catalog_name_map map
WHERE duplicate.family_id = map.family_id
  AND duplicate.normalized_title = map.normalized
  AND duplicate.id <> map.id;
UPDATE meal_suggestions s SET catalog_idea_id = map.id
FROM meal_slots sl, meal_catalog_name_map map
WHERE sl.id = s.slot_id AND sl.family_id = map.family_id
  AND lower(regexp_replace(translate(trim(s.title), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[[:space:]]+', ' ', 'g')) = map.normalized;
UPDATE meal_ideas i SET last_used_at = usage.last_used
FROM (
  SELECT s.catalog_idea_id, max(s.created_at) AS last_used
  FROM meal_suggestions s JOIN meal_slots sl ON sl.id = s.slot_id
  WHERE s.catalog_idea_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM meal_selections ms WHERE ms.suggestion_id = s.id)
    OR EXISTS (SELECT 1 FROM meal_groups mg WHERE mg.suggestion_id = s.id)
    OR EXISTS (SELECT 1 FROM meal_daily_plans dp, jsonb_array_elements(dp.plan->'menus') m WHERE m->'selection'->>'suggestionId' = s.id::text)
  ) GROUP BY s.catalog_idea_id
) usage WHERE usage.catalog_idea_id = i.id;
DROP TABLE meal_catalog_name_map;
