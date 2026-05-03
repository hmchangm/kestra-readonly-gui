# Kestra Read-Only GUI

A lightweight monitoring dashboard for [Kestra](https://kestra.io/) workflow executions. Browse execution history, inspect task runs, view daily KPI charts, and re-trigger flows — all secured behind Keycloak/OIDC.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Quarkus 3 (Kotlin), Jakarta REST, Agroal, OIDC |
| Frontend | React 19, TypeScript, Vite, TanStack Query, Recharts, Tailwind CSS |
| Auth | Keycloak (OpenID Connect) |
| Database | MySQL (prod/dev) · H2 in-memory (test) |

## Project Structure

```
kestra-readonly-gui/
├── backend/          # Quarkus API (port 8125)
├── frontend/         # Vite dev server (port 5173)
└── docs/             # Design specs and implementation plans
```

## Getting Started

### Prerequisites

- Java 21+
- Node.js 20+
- MySQL instance pointed at a Kestra database
- Keycloak realm with a `kestra-gui` client (skip for dev mode)

### Backend

1. Copy the env template and fill in your values:

   ```bash
   cp backend/.env.example backend/.env
   # edit backend/.env
   ```

   | Variable | Description |
   |----------|-------------|
   | `DB_JDBC_URL` | `jdbc:mysql://HOST:3306/kestra?serverTimezone=UTC` |
   | `DB_USERNAME` | MySQL username |
   | `DB_PASSWORD` | MySQL password |
   | `KESTRA_AUTH_BASIC` | `Basic <base64(user:password)>` for Kestra REST API |

2. Start in dev mode (auth disabled, reads from MySQL):

   ```bash
   cd backend
   ./mvnw compile quarkus:dev
   ```

   API runs at `http://localhost:8125`.

### Frontend

1. Create `frontend/.env.local`:

   ```env
   VITE_KEYCLOAK_URL=http://your-keycloak:8080
   VITE_KEYCLOAK_REALM=kestra
   VITE_KEYCLOAK_CLIENT_ID=kestra-gui
   VITE_API_URL=http://localhost:8125
   VITE_DEV_BYPASS_AUTH=true   # set false in prod
   ```

2. Install dependencies and start:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   App runs at `http://localhost:5173`.

## Building for Production

```bash
# Backend — produces target/quarkus-app/
cd backend && ./mvnw package -Pnative   # or omit -Pnative for JVM jar

# Frontend — produces dist/
cd frontend && npm run build
```

## Running Tests

```bash
# Backend (uses H2 in-memory, no .env needed)
cd backend && ./mvnw test

# Frontend
cd frontend && npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/namespaces` | List all namespaces |
| `GET` | `/api/executions` | Paginated execution list (filterable) |
| `GET` | `/api/executions/summary` | KPI counts + hourly breakdown (last 24 h) |
| `GET` | `/api/executions/{id}` | Execution detail |
| `POST` | `/api/executions/{id}/retrigger` | Re-trigger with optional input overrides |

All endpoints require a valid Keycloak bearer token (except in dev mode).
