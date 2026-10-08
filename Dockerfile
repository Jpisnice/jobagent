# Chat UI + agent in one image. The browser service (npm run browser) stays on the host because it
# drives your own visible Chrome window; the agent reaches it through host.docker.internal.
FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx eve build && npx vite build

ENV NODE_ENV=production \
    ALLOW_ANONYMOUS=1 \
    BROWSER_SERVICE_URL=http://host.docker.internal:8765

EXPOSE 5173
CMD ["bash", "docker/start.sh"]
