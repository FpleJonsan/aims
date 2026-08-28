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

1. Copy `.env.example` to the ignored `.env` and provide local PostgreSQL role credentials.
2. Apply every file in `apps/api/migrations` in lexical order as the PostgreSQL migration administrator.
3. Run `npm install`, `npm run dev --workspace @aims/api`, and `npm run dev`.
4. Check `GET /health/live` and `GET /health/ready`. OpenAPI is available at `/openapi` outside production only.

See [local development](docs/LOCAL-DEVELOPMENT.md), the [operator runbook](docs/OPERATIONS-RUNBOOK.md), [migration inventory](docs/MIGRATION-INVENTORY.md), and [competition demo](docs/COMPETITION-DEMO.md).

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
