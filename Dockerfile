# syntax=docker/dockerfile:1.6

# --- Build stage: compile the frontend ---------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


# --- Runtime stage: node server serves API + built frontend ------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/dist ./dist

EXPOSE 8080

# GEMINI_API_KEY must be supplied at runtime:
#   docker run -e GEMINI_API_KEY=... -p 8080:8080 shiksha-anuvad
CMD ["npm", "run", "start"]
