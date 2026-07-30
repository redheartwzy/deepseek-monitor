# ---- Build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ---- Run ----
FROM node:20-alpine
WORKDIR /app

# Install better-sqlite3 native dependencies
RUN apk add --no-cache build-base python3

# Copy production node_modules from build stage
COPY --from=build /app/node_modules ./node_modules
COPY . .

# Create data directory for SQLite
RUN mkdir -p data

EXPOSE 3000

# Use HEALTHCHECK to tell Railway the app is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "app.js"]
