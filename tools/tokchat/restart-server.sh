#!/bin/bash

# Restart the default Docker deployment.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-${SALES_AI_HTTP_PORT:-18084}}"

cd "$PROJECT_DIR"

echo "重启 TokChat Docker 服务..."
docker compose down
exec "$PROJECT_DIR/deploy.sh" "$PORT"
