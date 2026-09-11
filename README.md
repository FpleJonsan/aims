# AIMS

Competition operators: use the [demo script](docs/competition-demo-script.md), [operator cheat sheet](docs/competition-demo-cheatsheet.md), and [demo data guide](docs/competition-demo-data.md).

AImazing Intelligent Management System — AI-Powered Payment & Finance Control.

AIMS is an internal finance-control application. AI assists with evidence extraction, validation, risk analysis, and financial interpretation. Deterministic policy controls routing; authorized humans control approval, Final Finance Control, and recording an externally executed payment.

## Locked workflow

1. Request Initiation
2. Request Capture
3. Validation
4. Finance Context
5. Financial Risk Analysis
6. Policy & Decision
7. Approval
8. Final Finance Control
9. Payment Processing
10. Payment Record / History
11. Finance Dashboard
12. AI Finance Intelligence

AI never approves, pays, changes state, calculates authoritative balances, or modifies policy. With `AI_MASTER` OFF, the same workflow continues using manual validation and risk assessment.

## Architecture

- Web: Vinext/React application.
- API: NestJS application with strict DTO whitelisting and correlation IDs.
- Data: PostgreSQL with append-only history, lifecycle triggers, restricted `aims_app`, and separate Finance/Payment executor capabilities.
- Documents: hardened local adapter for trusted development/demo fixtures only. Production S3-compatible storage and malware scanning are prerequisites, not simulated functionality.
- AI: optional OpenAI-compatible provider behind database feature switches and evidence-checked structured contracts.
- Approval channel: web domain commands plus optional Telegram adapter/outbox. Telegram does not own approval logic.

## Local setup

Prerequisites: Git, Docker with Docker Compose v2, and Node.js 22.13+ with npm. Docker provisions the database; no host PostgreSQL installation or manual SQL provisioning is needed.

```bash
git clone <your-AIMS-repository-url> aims
cd aims
npm install
npm run bootstrap
npm run local
```

`npm run bootstrap` runs the existing Compose startup, bootstrap, migration and seed commands in order, stopping on failure. It adds no separate bootstrap logic.

The bootstrap writes an ignored `.env.local` without overwriting an existing file. It uses distinct, **local-only** development passwords for the existing application, Finance, Payment, worker, and migrator roles. PostgreSQL is available on loopback port 55432 and Redis on 56379. Optional `AIMS_LOCAL_POSTGRES_PORT` and `AIMS_LOCAL_REDIS_PORT` overrides must be exported consistently before Compose and bootstrap. These containers use persistent project-scoped volumes.

After bootstrap, the canonical startup command is:

```bash
npm run local
```

It reads `.env.local`, checks PostgreSQL schema 61 and Redis, checks service ports, builds the API, then starts API, worker polling, and frontend independently. It reports ready only after API and worker readiness endpoints and the frontend respond. Missing prerequisites fail with instructions; this command never provisions containers or databases. Keep Docker services running with `docker compose up -d`.

The launcher derives `NEXT_PUBLIC_AIMS_API_URL=http://localhost:<API_PORT>` automatically. An explicit value in `.env.local` (or the shell when absent from that file) is preserved. It must address the API being launched; an inconsistent override fails with instructions rather than being overwritten. Readiness includes the browser-facing API health URL and credentialed CORS for `WEB_ORIGIN`.

Ctrl+C stops only the processes launched by this command. Containers, database records, Redis data and documents are preserved. Run `npm run local` again to restart. An occupied port is an error; existing services are never terminated or adopted. Individual API and worker entry points remain available for debugging:

```bash
node --env-file=.env.local apps/api/dist/src/main.js
node --env-file=.env.local apps/api/dist/src/worker-main.js
npm run dev
```

Visit `http://localhost:3000/login`, select a synthetic local identity, then open the dashboard with the seeded Finance user. Check `http://localhost:3001/health/live` and `/health/ready`. The local deterministic scanner is selected in `.env.local`; start the worker so uploaded evidence can complete scanning. No separate scheduler process is required for the worker polling loop.

Re-running bootstrap preserves credentials and `.env.local`. Re-running migrate on schema 61 checks the existing privilege manifest without replaying migrations. Seed verifies the synthetic data already included in migrations 001–061; it does not insert duplicates. A partially migrated database is rejected rather than replayed or erased. Stop services with `docker compose stop`; restarting retains data. `docker compose down -v` **deletes this Compose project's local database and Redis data** and is only for an intentional disposable reset.

See [local development](docs/LOCAL-DEVELOPMENT.md) for bootstrap details.

## Validation

```bash
npm test
npm run test:integration --workspace @aims/api
npm run test:validation:integration --workspace @aims/api
npm run test:finance-context:integration --workspace @aims/api
npm run test:financial-analysis:integration --workspace @aims/api
npm run test:policy:integration --workspace @aims/api
npm run test:approval:integration --workspace @aims/api
npm run test:finance-control:integration --workspace @aims/api
npm run test:payment:integration --workspace @aims/api
npm run test:dashboard:integration --workspace @aims/api
npm run lint
npm run typecheck
npm run build
npm run build --workspace @aims/api
git diff --check
```

Live OpenAI and Telegram tests are explicit opt-in commands and never run as part of the normal suite.

## Production boundary

This repository is competition/local ready, but not deployable to production until trusted identity, production object storage with malware scanning, TLS, secrets management, backups and restore rehearsal, operational workers, and deployment-specific monitoring are supplied. Startup validation fails closed for unsafe production identity or local storage settings.
