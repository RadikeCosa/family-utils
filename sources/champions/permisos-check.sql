-- Solo lectura. Ejecutar después de aplicar migraciones en la base objetivo.
-- Devuelve cada función del esquema public y falla con excepción si PUBLIC, anon o
-- authenticated pueden ejecutarla. PUBLIC es un pseudorol de PostgreSQL, por
-- eso su permiso efectivo se inspecciona en ACL (grantee 0); los roles nombrados
-- se comprueban con has_function_privilege. Usar psql -v ON_ERROR_STOP=1.
BEGIN READ ONLY;

WITH public_functions AS (
  SELECT p.oid,
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature,
         COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) AS acl
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
), checked AS (
  SELECT signature,
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(acl) AS a
           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) AS public_can_execute,
         CASE WHEN pg_catalog.to_regrole('anon') IS NULL THEN false
              ELSE pg_catalog.has_function_privilege('anon', oid, 'EXECUTE') END AS anon_can_execute,
         CASE WHEN pg_catalog.to_regrole('authenticated') IS NULL THEN false
              ELSE pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE') END AS authenticated_can_execute
  FROM public_functions
)
SELECT signature, public_can_execute, anon_can_execute, authenticated_can_execute
FROM checked
ORDER BY signature;

DO $check$
DECLARE bad record;
BEGIN
  SELECT * INTO bad
  FROM (
    SELECT p.oid,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature,
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) AS acl
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) AS f
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
    RAISE EXCEPTION 'Permiso EXECUTE inesperado en % (PUBLIC/anon/authenticated)', bad.signature;
  END IF;
END
$check$;

COMMIT;
