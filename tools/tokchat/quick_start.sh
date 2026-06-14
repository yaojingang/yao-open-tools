#!/bin/bash

# TokChat quick start. Docker is the default runtime.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-${SALES_AI_HTTP_PORT:-18084}}"

exec "$PROJECT_DIR/deploy.sh" "$PORT"
