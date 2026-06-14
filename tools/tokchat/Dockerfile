FROM php:8.4-cli

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 update; \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 install -y --no-install-recommends \
        ca-certificates \
        curl \
        libzip-dev \
        poppler-utils \
        unzip; \
    docker-php-ext-install zip; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY . /var/www/html
COPY docker/entrypoint.sh /usr/local/bin/sales-ai-entrypoint

RUN chmod +x /usr/local/bin/sales-ai-entrypoint \
    && mkdir -p data/uploads logs uploads cache temp \
    && chmod -R 775 data logs uploads cache temp

ENV APP_DEBUG=0 \
    PHP_MEMORY_LIMIT=256M \
    PHP_MAX_EXECUTION_TIME=300 \
    PHP_MAX_INPUT_TIME=300 \
    PHP_UPLOAD_MAX_FILESIZE=20M \
    PHP_POST_MAX_SIZE=24M \
    SALES_AI_HOST=0.0.0.0 \
    SALES_AI_PORT=8080 \
    TZ=Asia/Shanghai

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${SALES_AI_PORT}/health.php" | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["sales-ai-entrypoint"]
