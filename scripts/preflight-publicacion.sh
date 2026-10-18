#!/usr/bin/env bash
# Read-only publication preflight. Does not modify the repository or database.
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DETAILS=()
HAS_ERROR=0

record() {
  CHECK_NAMES+=("$1")
  CHECK_STATUSES+=("$2")
  CHECK_DETAILS+=("$3")
  [[ "$2" == ERROR ]] && HAS_ERROR=1
}

version_for() {
  case "$1" in
    git) git --version 2>&1 ;;
    node) node --version 2>&1 ;;
    npm) npm --version 2>&1 ;;
    psql) psql --version 2>&1 ;;
    pg_dump) pg_dump --version 2>&1 ;;
    pg_restore) pg_restore --version 2>&1 ;;
    docker) docker --version 2>&1 ;;
  esac
}

install_hint() {
  case "$1" in
    git)
      printf '  Ubuntu/WSL: sudo apt update && sudo apt install -y git\n'
      printf '  Docker: no reemplaza git; instalar el cliente git en Ubuntu/WSL.\n'
      ;;
    node|npm)
      printf '  Ubuntu/WSL: instalar nvm y luego ejecutar: nvm install 24 && nvm use 24 (incluye npm).\n'
      printf '  Docker: no reemplaza el Node/npm local requerido por el proyecto.\n'
      ;;
    psql|pg_dump|pg_restore)
      printf '  Ubuntu/WSL (cliente PostgreSQL 17 oficial): sudo apt install -y ca-certificates curl && sudo install -d /usr/share/postgresql-common/pgdg && sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc && . /etc/os-release && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null && sudo apt update && sudo apt install -y postgresql-client-17\n'
      printf '  Si el servidor es PostgreSQL 18 o superior, instale el paquete cliente de esa misma versión o una posterior.\n'
      printf '  Docker (contenedor postgres:17 ya levantado): docker exec <contenedor> %s --version\n' "$1"
      printf '  Consulta remota con psql dentro del contenedor: docker exec -e DATABASE_URL_UNPOOLED <contenedor> sh -c '\''psql "$DATABASE_URL_UNPOOLED" -X -A -t -c "SHOW server_version"'\''\n'
      ;;
    docker)
      printf '  Ubuntu/WSL: sudo apt update && sudo apt install -y docker.io (o siga la guía oficial de Docker).\n'
      printf '  La comprobación de Docker es informativa y no bloquea la publicación.\n'
      ;;
  esac
}

for tool in git node npm psql pg_dump pg_restore docker; do
  if command -v "$tool" >/dev/null 2>&1; then
    tool_version="$(version_for "$tool" 2>/dev/null || true)"
    if [[ -n "$tool_version" ]]; then
      if [[ "$tool" == docker ]]; then
        record "Herramienta: $tool" OK "$tool_version (informativo)"
      else
        record "Herramienta: $tool" OK "$tool_version"
      fi
    elif [[ "$tool" == docker ]]; then
      record "Herramienta: $tool" INFO "presente, pero no pudo informar versión; es informativo"
    else
      record "Herramienta: $tool" ERROR "presente, pero no ejecuta correctamente"
      install_hint "$tool"
    fi
  elif [[ "$tool" == docker ]]; then
    record "Herramienta: $tool" INFO "no instalada; Docker es informativo y no bloquea"
    install_hint "$tool"
  else
    record "Herramienta: $tool" ERROR "no instalada"
    install_hint "$tool"
  fi
done

NODE_ENGINE=""
if [[ -f package.json ]]; then
  NODE_ENGINE="$(sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"
fi

version_ge() {
  local left="$1" right="$2"
  [[ "$(printf '%s\n%s\n' "$right" "$left" | sort -V | head -n 1)" == "$right" ]]
}
version_lt() {
  local left="$1" right="$2"
  [[ "$(printf '%s\n%s\n' "$left" "$right" | sort -V | head -n 1)" == "$left" && "$left" != "$right" ]]
}

node_range_matches_atom() {
  local actual="$1" atom="$2" actual_core major base op
  atom="${atom#"${atom%%[![:space:]]*}"}"
  atom="${atom%"${atom##*[![:space:]]}"}"
  [[ -z "$atom" || "$atom" == "*" ]] && return 0
  actual_core="${actual#v}"
  major="${actual_core%%.*}"
  case "$atom" in
    *"||"*) return 2 ;;
    x|X) return 0 ;;
    *.[xX]|*.'*') base="${atom%%.*}"; [[ "$major" == "$base" ]] ;;
    \^*)
      base="${atom#^}"; base="${base%%.*}"
      [[ "$major" == "$base" ]] && version_ge "$actual_core" "${atom#^}"
      ;;
    \~*)
      base="${atom#~}"
      local required_major="${base%%.*}" required_minor="${base#*.}"
      required_minor="${required_minor%%.*}"
      [[ "$major" == "$required_major" && "${actual_core#*.}" == "$required_minor"* ]] && version_ge "$actual_core" "$base"
      ;;
    ">="*|">"*|"<="*|"<"*)
      op="${atom%%[0-9]*}"; base="${atom#"$op"}"
      case "$op" in
        '>=') version_ge "$actual_core" "$base" ;;
        '>') version_ge "$actual_core" "$base" && [[ "$actual_core" != "$base" ]] ;;
        '<=') version_ge "$base" "$actual_core" ;;
        '<') version_lt "$actual_core" "$base" ;;
      esac
      ;;
    *)
      if [[ "$atom" =~ ^[0-9]+\.x$ || "$atom" =~ ^[0-9]+\.\*$ ]]; then
        [[ "$major" == "${atom%%.*}" ]]
      else
        [[ "$actual_core" == "$atom" || "$actual_core" == "$atom".* ]]
      fi
      ;;
  esac
}

node_satisfies_range() {
  local actual="$1" range="$2" atom
  [[ "$range" == *"||"* ]] && {
    local alternatives="${range//||/$'\n'}"
    while IFS= read -r atom; do
      node_satisfies_range "$actual" "$atom" && return 0
    done <<< "$alternatives"
    return 1
  }
  for atom in $range; do
    node_range_matches_atom "$actual" "$atom" || return 1
  done
  return 0
}

if [[ -z "$NODE_ENGINE" ]]; then
  record "Node cumple package.json engines" SKIP "package.json no declara engines.node"
elif ! command -v node >/dev/null 2>&1; then
  record "Node cumple package.json engines" ERROR "no se puede verificar engines.node=$NODE_ENGINE sin Node"
elif node_version="$(node --version 2>/dev/null)" && node_satisfies_range "$node_version" "$NODE_ENGINE"; then
  record "Node cumple package.json engines" OK "$node_version cumple engines.node=$NODE_ENGINE"
else
  record "Node cumple package.json engines" ERROR "$(node --version 2>/dev/null || printf 'Node no disponible') no cumple o no se pudo evaluar engines.node=$NODE_ENGINE"
fi

if git_status="$(git status --porcelain 2>/dev/null)"; then
  if [[ -z "$git_status" ]]; then
    record "Árbol Git limpio" OK "git status --porcelain vacío"
  else
    record "Árbol Git limpio" ERROR "hay cambios sin commit (git status --porcelain no está vacío)"
  fi
else
  record "Árbol Git limpio" ERROR "no se pudo consultar el estado de Git"
fi

commit="$(git rev-parse HEAD 2>/dev/null || true)"
describe="$(git describe --tags --always 2>/dev/null || true)"
if [[ -n "$commit" && -n "$describe" ]]; then
  record "Commit y tag actual" OK "commit=$commit; git describe --tags --always=$describe"
  printf 'Commit exacto: %s\nTag/describe exacto: %s\n' "$commit" "$describe"
else
  record "Commit y tag actual" ERROR "no se pudo resolver el commit y el tag"
fi

if [[ "${DATABASE_URL_UNPOOLED+x}" != x ]]; then
  record "DATABASE_URL_UNPOOLED / servidor PostgreSQL" SKIP "variable no definida; se omite consulta y comparación de versiones"
else
  connection_url="$DATABASE_URL_UNPOOLED"
  url_rest="${connection_url#*://}"
  authority="${url_rest%%/*}"
  server_authority="${authority##*@}"
  if [[ "$server_authority" == \[* ]]; then
    db_host="${server_authority%%]*}]"
  else
    db_host="${server_authority%%:*}"
  fi
  db_path="${url_rest#*/}"
  db_name="${db_path%%[\?#]*}"
  if [[ -z "$db_host" || -z "$db_name" || "$connection_url" != postgresql://* && "$connection_url" != postgres://* ]]; then
    record "DATABASE_URL_UNPOOLED / servidor PostgreSQL" ERROR "URL directa inválida o incompleta (valor oculto)"
  else
    printf 'DATABASE_URL_UNPOOLED definida: host=%s database=%s (URL oculta)\n' "$db_host" "$db_name"
    if ! command -v psql >/dev/null 2>&1; then
      record "Servidor PostgreSQL y versión de pg_dump" ERROR "requiere psql y pg_dump; URL oculta"
    else
      server_version="$(psql "$connection_url" -X -A -t -v ON_ERROR_STOP=1 -c 'SHOW server_version' 2>/dev/null | head -n 1 | tr -d '\r')"
      if [[ -z "$server_version" ]]; then
        record "Servidor PostgreSQL y versión de pg_dump" ERROR "no se pudo consultar SHOW server_version (conexión/credenciales; URL oculta)"
      elif ! command -v pg_dump >/dev/null 2>&1; then
        record "Servidor PostgreSQL y versión de pg_dump" ERROR "servidor=$server_version; pg_dump no está disponible; URL oculta"
      else
        dump_version="$(pg_dump --version 2>/dev/null | sed -nE 's/.*PostgreSQL[^0-9]*([0-9]+([.][0-9]+)?).*/\1/p' | head -n 1)"
        server_major="${server_version%%.*}"
        dump_major="${dump_version%%.*}"
        if [[ -z "$dump_version" ]]; then
          record "Servidor PostgreSQL y versión de pg_dump" ERROR "servidor=$server_version; no se pudo interpretar pg_dump --version"
        elif [[ "$server_major" =~ ^[0-9]+$ && "$dump_major" =~ ^[0-9]+$ ]] && (( dump_major >= server_major )); then
          record "Servidor PostgreSQL y versión de pg_dump" OK "servidor=$server_version; pg_dump=$dump_version; versión mayor compatible"
        elif [[ "$server_major" =~ ^[0-9]+$ && "$dump_major" =~ ^[0-9]+$ ]]; then
          record "Servidor PostgreSQL y versión de pg_dump" ERROR "servidor=$server_version; pg_dump=$dump_version; pg_dump es más viejo que el servidor"
        else
          record "Servidor PostgreSQL y versión de pg_dump" ERROR "no se pudieron comparar las versiones; URL oculta"
        fi
      fi
    fi
  fi
fi

printf '\nResultado del preflight\n'
printf '%-48s | %-6s | %s\n' 'Comprobación' 'Estado' 'Detalle'
printf '%-48s-+-%-6s-+-%s\n' '------------------------------------------------' '------' '------------------------------------------------------------'
for i in "${!CHECK_NAMES[@]}"; do
  printf '%-48s | %-6s | %s\n' "${CHECK_NAMES[$i]}" "${CHECK_STATUSES[$i]}" "${CHECK_DETAILS[$i]}"
done

if (( HAS_ERROR )); then
  exit 1
fi
exit 0
