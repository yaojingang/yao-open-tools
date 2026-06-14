#!/bin/bash

# TokChat - Docker deployment entrypoint.
# Usage: ./deploy.sh [host_port]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-${SALES_AI_HTTP_PORT:-18084}}"
HEALTH_URL="http://127.0.0.1:${PORT}/health.php"

cd "$PROJECT_DIR"
export SALES_AI_HTTP_PORT="$PORT"

echo "TokChat Docker 部署"
echo "=================="
echo "项目目录: $PROJECT_DIR"
echo "本机端口: $PORT"
echo ""

if ! command -v docker >/dev/null 2>&1; then
    echo "错误: 未检测到 Docker，请先安装并启动 Docker Desktop。"
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "错误: 当前 Docker 不支持 compose 子命令。"
    exit 1
fi

mkdir -p data logs uploads cache temp

echo "构建并启动容器..."
docker compose up -d --build

echo "等待健康检查..."
HEALTHY=0
for _ in $(seq 1 60); do
    if command -v curl >/dev/null 2>&1 && curl -fsS "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
        HEALTHY=1
        break
    fi
    sleep 1
done

if [ "$HEALTHY" -ne 1 ]; then
    echo "错误: 容器未通过健康检查。最近日志如下:"
    docker compose logs --tail=120 sales-ai
    exit 1
fi

echo "等待 Docker health 状态..."
for _ in $(seq 1 60); do
    HEALTH_STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' sales-ai-assistant 2>/dev/null || true)"
    if [ "$HEALTH_STATUS" = "healthy" ] || [ "$HEALTH_STATUS" = "none" ]; then
        break
    fi
    if [ "$HEALTH_STATUS" = "unhealthy" ]; then
        echo "错误: Docker 标记容器为 unhealthy。最近日志如下:"
        docker compose logs --tail=120 sales-ai
        exit 1
    fi
    sleep 1
done

echo ""
docker compose ps
echo ""
echo "部署完成"
echo "前台: http://127.0.0.1:${PORT}/"
echo "登录页: http://127.0.0.1:${PORT}/login.php"
echo "后台: http://127.0.0.1:${PORT}/admin.php"
echo "健康检查: $HEALTH_URL"
echo ""
echo "常用命令:"
echo "查看日志: docker compose logs -f sales-ai"
echo "停止服务: ./stop-server.sh"
echo "重启服务: ./restart-server.sh"
