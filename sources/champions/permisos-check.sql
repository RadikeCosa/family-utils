-- Solo lectura. Ejecutar después de aplicar migraciones en la base objetivo.
-- Devuelve cada función del esquema public y falla con excepción si PUBLIC, anon o
-- authenticated pueden ejecutarla. PUBLIC es un pseudorol de PostgreSQL, por
-- eso su permiso efectivo se inspecciona en ACL (grantee 0); los roles nombrados
-- se comprueban con has_function_privilege. Si anon/authenticated no existen,
-- la salida lo marca y comprueba los roles presentes. Usar psql -v ON_ERROR_STOP=1.
BEGIN READ ONLY;

WITH roles AS (
  SELECT pg_catalog.to_regrole('anon') AS anon_role,
         pg_catalog.to_regrole('authenticated') AS authenticated_role
), public_functions AS (
  SELECT p.oid,
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature,
         COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) AS acl
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
), checked AS (
  SELECT signature,
         roles.anon_role IS NOT NULL AS anon_role_exists,
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(acl) AS a
           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) AS public_can_execute,
         CASE WHEN roles.anon_role IS NULL THEN false
              ELSE pg_catalog.has_function_privilege(roles.anon_role, oid, 'EXECUTE') END AS anon_can_execute,
         roles.authenticated_role IS NOT NULL AS authenticated_role_exists,
         CASE WHEN roles.authenticated_role IS NULL THEN false
              ELSE pg_catalog.has_function_privilege(roles.authenticated_role, oid, 'EXECUTE') END AS authenticated_can_execute
  FROM public_functions CROSS JOIN roles
)
SELECT signature, public_can_execute,
       anon_role_exists, anon_can_execute,
       authenticated_role_exists, authenticated_can_execute
FROM checked
ORDER BY signature;

DO $check$
DECLARE bad record;
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL THEN
    RAISE NOTICE 'Rol anon ausente; se omitió la comprobación de permisos para ese rol.';
  END IF;
  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    RAISE NOTICE 'Rol authenticated ausente; se omitió la comprobación de permisos para ese rol.';
  END IF;

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
