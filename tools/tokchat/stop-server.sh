#!/bin/bash

# Stop the default Docker deployment.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

echo "停止 TokChat Docker 服务..."
docker compose down
echo "已停止。数据仍保留在 data/、logs/、uploads/、cache/、temp/。"
