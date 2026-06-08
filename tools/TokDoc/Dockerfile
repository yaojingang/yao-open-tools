FROM node:25-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libreoffice-writer fonts-noto-cjk fontconfig \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV TOKDOC_DATA_DIR=/app/data
ENV TOKDOC_WATCH_DIRS=/watch/html-inbox
ENV TOKDOC_SOFFICE_BIN=soffice

EXPOSE 8080

CMD ["npm", "start"]
