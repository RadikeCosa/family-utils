-- PostgreSQL grants function EXECUTE to PUBLIC globally by default; a schema-only
-- REVOKE cannot subtract that global grant. Apply to this migration owner, also
-- the owner required for subsequent migrations. Existing unrelated ACLs stay intact.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE f record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM anon';
  END IF;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'sports\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',f.signature);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',f.signature);
    END IF;
  END LOOP;
END $$;
