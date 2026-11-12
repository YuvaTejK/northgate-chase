FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    ASSISTANT_PORT=4175 \
    DATABASE_PATH=/tmp/northgate.sqlite \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/venv \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:${PATH}"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY assistant ./assistant
RUN pip install --no-cache-dir ./assistant
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY deploy/entrypoint.py ./deploy/entrypoint.py

USER node
EXPOSE 8080
CMD ["python", "deploy/entrypoint.py"]
