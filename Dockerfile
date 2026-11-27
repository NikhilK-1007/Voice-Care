FROM node:20-alpine

WORKDIR /app/backend

# Install production backend dependencies first for clean Docker layer caching
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source and static frontend assets served by Express
COPY backend/ ./
COPY frontend/www/ /app/frontend/www/

# Ensure non-root ownership and remove any accidental .env
RUN rm -f /app/backend/.env && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV ALLOW_DEMO_FALLBACK=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
