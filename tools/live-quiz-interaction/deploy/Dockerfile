FROM nginx:1.27-alpine

COPY dist/ /usr/share/nginx/html/

RUN printf '%s\n' \
  'server {' \
  '    listen 80;' \
  '    server_name _;' \
  '    root /usr/share/nginx/html;' \
  '    index index.html;' \
  '    location / {' \
  '        try_files $uri $uri/ /index.html;' \
  '    }' \
  '    location /assets/ {' \
  '        expires 30d;' \
  '        add_header Cache-Control "public, immutable";' \
  '        try_files $uri =404;' \
  '    }' \
  '}' > /etc/nginx/conf.d/default.conf
