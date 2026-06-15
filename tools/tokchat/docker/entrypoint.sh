#!/bin/sh
set -eu

cd /var/www/html

mkdir -p data/uploads logs uploads cache temp
touch logs/php_errors.log

PHP_INI_DIR="${PHP_INI_DIR:-/usr/local/etc/php}"
mkdir -p "$PHP_INI_DIR/conf.d"
cat > "$PHP_INI_DIR/conf.d/sales-ai-runtime.ini" <<EOF
memory_limit=${PHP_MEMORY_LIMIT:-256M}
max_execution_time=${PHP_MAX_EXECUTION_TIME:-300}
max_input_time=${PHP_MAX_INPUT_TIME:-300}
upload_max_filesize=${PHP_UPLOAD_MAX_FILESIZE:-20M}
post_max_size=${PHP_POST_MAX_SIZE:-24M}
date.timezone=${TZ:-Asia/Shanghai}
EOF

find data logs uploads cache temp -type d -exec chmod 775 {} \; 2>/dev/null || true
find data logs uploads cache temp -type f -exec chmod 664 {} \; 2>/dev/null || true

echo "Checking SQLite database schema..."
php -r "require_once '/var/www/html/api/db.php'; initDatabase(); echo \"Database schema ready\n\";"

REQUESTED_WORKERS="${PHP_CLI_SERVER_WORKERS:-16}"
case "$REQUESTED_WORKERS" in
    ''|*[!0-9]*)
        REQUESTED_WORKERS=16
        ;;
esac

if [ "$REQUESTED_WORKERS" -lt 1 ]; then
    REQUESTED_WORKERS=1
elif [ "$REQUESTED_WORKERS" -gt 50 ]; then
    echo "PHP_CLI_SERVER_WORKERS capped at 50 (requested ${PHP_CLI_SERVER_WORKERS})"
    REQUESTED_WORKERS=50
fi

export PHP_CLI_SERVER_WORKERS="$REQUESTED_WORKERS"

echo "Starting Sales AI Assistant on ${SALES_AI_HOST:-0.0.0.0}:${SALES_AI_PORT:-8080} with ${PHP_CLI_SERVER_WORKERS} PHP workers"
exec php -S "${SALES_AI_HOST:-0.0.0.0}:${SALES_AI_PORT:-8080}" -t /var/www/html /var/www/html/router.php
