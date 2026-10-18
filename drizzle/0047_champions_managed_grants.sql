-- Close managed-Postgres default grants for Champions' server-only API and data.
-- Default ACLs apply only to the role executing this migration; production must
-- also check/revoke ACLs for a different migration owner (see runbook).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
DO $lockdown$
DECLARE
  f record;
  t record;
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    END IF;
  END LOOP;

  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'sports\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', f.signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', f.signature, role_name);
      END IF;
    END LOOP;
  END LOOP;

  FOR t IN
    SELECT c.oid::regclass AS relation
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (c.relname LIKE 'sports\_football\_%' ESCAPE '\' OR c.relname = 'sports_champions_switches')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC', t.relation);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I', t.relation, role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$lockdown$;
