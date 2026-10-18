FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl \
    fluxbox \
    novnc \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/browser-service/package.json services/browser-service/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @live-browser/browser-service --include-workspace-root

COPY services/browser-service services/browser-service
RUN npm run build --workspace @live-browser/browser-service

RUN chmod +x services/browser-service/docker-entrypoint.sh \
  && mkdir -p /artifacts /browser-profile \
  && chown -R pwuser:pwuser /app /artifacts /browser-profile

USER pwuser
EXPOSE 3001 6080
ENTRYPOINT ["/app/services/browser-service/docker-entrypoint.sh"]
