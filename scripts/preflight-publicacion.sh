#!/usr/bin/env bash
# Preflight de solo lectura. Requiere SHA candidato/desplegado, destino y evidencia.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT_DIR/scripts/preflight-publicacion.mjs" "$@"
