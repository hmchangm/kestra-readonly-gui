# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Commands

### Backend (Quarkus, port 8125)
```bash
cd backend
cp .env.example .env          # first time only — fill in DB_* and KESTRA_AUTH_BASIC
./mvnw compile quarkus:dev    # dev mode: auth disabled, reads real MySQL
./mvnw test                   # unit tests with H2 in-memory, no .env needed
./mvnw package                # JVM jar → target/quarkus-app/
./mvnw package -Pnative       # native image
```

### Frontend (Vite, port 5173)
```bash
cd frontend
npm install
npm run dev     # dev server
npm run build   # production build → dist/
npm test        # Vitest (watch mode)
npm run lint    # ESLint
```

To run a single frontend test file:
```bash
cd frontend && npx vitest run src/components/StatusBadge.test.tsx
```

## Architecture

### Data flow
The backend reads **directly from Kestra's MySQL database** — it does not call Kestra's REST API for reads. The `executions` table is Kestra's own schema; the backend only ever SELECTs from it. The one write path is retrigger: `RetriggerService` calls the Kestra REST API (`KestraClient`) via HTTP with Basic auth, then writes an audit row to `kestra_retrigger_audit` (the only table the backend owns).

### Backend layer (Kotlin/Quarkus)
- **`ExecutionRepository`** — raw JDBC via Agroal `DataSource` (no ORM). Parses the `value` CLOB column (Kestra's execution JSON) with Jackson for the detail endpoint; flat columns for the list endpoint.
- **`RetriggerService`** — fetches the original execution, merges caller-supplied input overrides on top of stored inputs, POSTs to Kestra's API as multipart form data via `KestraPartBuilder`, then audits the action.
- **`KestraClient`** — MicroProfile REST Client interface; `Authorization: Basic …` injected via `kestra.auth.basic` config property.
- **`AuditRepository`** — inserts into `kestra_retrigger_audit`; failure is logged but not re-thrown so a Kestra API error doesn't also lose the audit trail.
- **`DevIdentityAugmentor`** — active only in `LaunchMode.DEVELOPMENT`; promotes anonymous requests to a `dev-user` principal so `@Authenticated` endpoints work without Keycloak.

### Frontend layer (React/TypeScript)
- **Auth** — `oidc-client-ts` wrapped in `AuthProvider` / `useAuth`. Set `VITE_DEV_BYPASS_AUTH=true` to skip OIDC in dev; this injects a fake `dev-user` and skips the `userManager` entirely.
- **Data fetching** — each API resource has a dedicated hook (`useExecutions`, `useExecution`, `useSummary`, `useNamespaces`, `useRetrigger`) that wraps TanStack Query calls to `api/client.ts` (axios).
- **Pages** — `ExecutionListPage` (filterable table + KPI charts) and `ExecutionDetailPage` (task run list + retrigger modal). Both are behind `ProtectedRoute`.
- **`CallbackPage`** — handles the OIDC redirect; calls `userManager.signinRedirectCallback()`.

### Test strategy
- Backend tests extend `DbTestBase`, which applies `db-setup.sql` against H2 (MySQL compatibility mode) and truncates both tables before each test. OIDC is disabled in the `%test` profile.
- Frontend tests use Vitest + jsdom + Testing Library. Setup file is `src/test-setup.ts`.

### Database schema
Two tables matter:
- `executions` — Kestra-owned; columns: `key`, `value` (JSON CLOB), `deleted`, `id`, `namespace`, `flow_id`, `state_current`, `start_date`, `end_date`.
- `kestra_retrigger_audit` — app-owned; created by `db-setup.sql` on first dev boot via `DevSchemaInit`.

## Environment variables

**Backend** (`backend/.env`):

| Variable | Purpose |
|---|---|
| `DB_JDBC_URL` | `jdbc:mysql://HOST:3306/kestra?serverTimezone=UTC` |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL credentials |
| `KESTRA_AUTH_BASIC` | `Basic <base64(user:pass)>` for Kestra REST API |

**Frontend** (`frontend/.env.local`):

| Variable | Purpose |
|---|---|
| `VITE_KEYCLOAK_URL` / `VITE_KEYCLOAK_REALM` / `VITE_KEYCLOAK_CLIENT_ID` | OIDC config |
| `VITE_API_URL` | Backend base URL (default: `http://localhost:8125`) |
| `VITE_DEV_BYPASS_AUTH` | Set `true` to skip Keycloak in local dev |
