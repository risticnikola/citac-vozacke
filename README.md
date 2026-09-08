# citac-vozacke

Vehicle registration card reader system. Bridge app reads cards via native driver, pushes data to cloud API, web UI triggers scans and shows results.

## Stack

- **API** — Node.js, TypeScript, Fastify, WebSocket, PostgreSQL, Redis, AWS SDK v3 (S3, SQS), JWT auth, OpenTelemetry, Prometheus, Pino, Vitest
- **Web** — Next.js 16, React 19, TypeScript, TanStack Query, Tailwind CSS 4, Axios
- **Bridge** — Electron, TypeScript, native C++ module (card reader SDK), better-sqlite3 (offline queue), WebSocket client
- **Worker** — Node.js, TypeScript, SQS consumers, PDF generation (pdfmake), PostgreSQL, Redis
- **DB** — PostgreSQL, Flyway-style SQL migrations (`db/migrations`)
- **Infra** — Docker Compose, LocalStack (S3/SQS emulation), Prometheus + Grafana, OpenTelemetry Collector

## Prerequisites

- Node.js 20+
- Docker + Docker Compose
- Windows (bridge native module built for Windows; ships as `.exe`/`.dll`)

## Run

### 1. Infra (Postgres, Redis, LocalStack, API, monitoring)

```bash
cd infra
docker compose up -d
```

Requires env vars for secrets — set before `up`: `POSTGRES_PASSWORD`, `MIGRATION_ROLE_PASSWORD`, `APP_ROLE_PASSWORD`, `REDIS_PASSWORD`.

This starts:
- `postgres` :5432
- `redis` :6379
- `localstack` (S3/SQS) :4566
- `flyway` — runs DB migrations automatically
- `api` :3000
- `otel-collector` :4317/:4318
- `prometheus` :9090
- `grafana` :3001
- `adminer` (DB UI) :8080

### 2. Worker (SQS consumers, not in compose — run manually)

```bash
cd worker
npm install
npm run dev
```

### 3. Web

```bash
cd web
npm install
npm run dev
```

Runs at `http://localhost:3060`. Configure `web/.env.local` with API URL.

### 4. Bridge (desktop app)

```bash
cd bridge
npm install
npm run dev
```

Configure `bridge/.env` (see `.env.example` — needs `DEFAULT_API_URL`). Requires native reader module in `bridge/native/` (`citacVozacke.exe`, `eVehicleRegistrationAPI.dll`).

## Tests

Each service (`api`, `bridge`, `worker`) uses Vitest:

```bash
cd <service>
npm test
```

API also has a dedicated security test suite: `npm run test:security` (in `api/`).
