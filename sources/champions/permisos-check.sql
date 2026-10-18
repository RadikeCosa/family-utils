-- Solo lectura. Enumera todas las funciones de public y falla únicamente si
-- una función que NO pertenece a una extensión otorga EXECUTE a PUBLIC, anon
-- o authenticated. Las funciones de extensiones se listan aparte con dueño.
-- Ejecutar con: psql -X -v ON_ERROR_STOP=1 -f sources/champions/permisos-check.sql
BEGIN READ ONLY;

WITH role_presence AS (
  SELECT pg_catalog.to_regrole('anon') IS NOT NULL AS anon_present,
         pg_catalog.to_regrole('authenticated') IS NOT NULL AS authenticated_present
), public_functions AS (
  SELECT p.oid,
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner,
         COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) AS acl,
         ext.extname AS extension_name
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL (
    SELECT e.extname
    FROM pg_catalog.pg_depend AS d
    JOIN pg_catalog.pg_extension AS e
      ON d.refclassid = 'pg_catalog.pg_extension'::regclass
     AND d.refobjid = e.oid
    WHERE d.classid = 'pg_catalog.pg_proc'::regclass
      AND d.objid = p.oid
      AND d.deptype = 'e'
    LIMIT 1
  ) AS ext ON true
  WHERE n.nspname = 'public'
), checked AS (
  SELECT f.*,
         rp.anon_present,
         rp.authenticated_present,
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(f.acl) AS a
           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) AS public_can_execute,
         CASE WHEN rp.anon_present
              THEN pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
              ELSE false END AS anon_can_execute,
         CASE WHEN rp.authenticated_present
              THEN pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
              ELSE false END AS authenticated_can_execute
  FROM public_functions AS f CROSS JOIN role_presence AS rp
)
SELECT CASE WHEN extension_name IS NULL THEN 'application' ELSE 'extension' END AS function_kind,
       COALESCE(extension_name, '-') AS extension,
       owner,
       signature,
       anon_present AS anon_role_present,
       anon_can_execute,
       authenticated_present AS authenticated_role_present,
       authenticated_can_execute,
       public_can_execute,
       CASE WHEN extension_name IS NOT NULL
            THEN 'informational; excluded from application permission failure'
            WHEN public_can_execute OR anon_can_execute OR authenticated_can_execute
            THEN 'ERROR: unexpected EXECUTE'
            ELSE 'OK' END AS check_result
FROM checked
ORDER BY (extension_name IS NULL), extension_name NULLS FIRST, signature;

DO $check$
DECLARE bad record;
BEGIN
  WITH public_functions AS (
    SELECT p.oid,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature,
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) AS acl
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS d
        WHERE d.classid = 'pg_catalog.pg_proc'::regclass
          AND d.objid = p.oid
          AND d.refclassid = 'pg_catalog.pg_extension'::regclass
          AND d.deptype = 'e'
      )
  )
  SELECT f.* INTO bad
  FROM public_functions AS f
  WHERE EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(f.acl) AS a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
     OR (pg_catalog.to_regrole('anon') IS NOT NULL
         AND pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE'))
     OR (pg_catalog.to_regrole('authenticated') IS NOT NULL
         AND pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE'))
  ORDER BY f.signature
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Permiso EXECUTE inesperado en función no perteneciente a extensión % (PUBLIC/anon/authenticated)', bad.signature;
  END IF;
END
$check$;

COMMIT;
