# 🚀 Quick Start Guide - AIMS

**Release contract:** schema 71, migrations `001`–`071`, latest `071_p20_7a_enterprise_ui_contracts`

---

## Prerequisites Check ✅

Before starting, make sure you have:
- ✅ Node.js v22+ installed
- ✅ Docker running (for PostgreSQL)
- ✅ Port 3000 (web) and 3001 (API) available

---

## Step-by-Step Startup

### 1️⃣ Install dependencies and run the canonical bootstrap

The supported local path uses the repository's Docker Compose service, creates
the complete owner/migrator/application/Finance/Payment/document-worker role
model, writes an ignored `.env.local`, validates all 71 immutable migration
files, executes the production-safe schema portions with `ON_ERROR_STOP=1`,
runs post-migration hardening and verifies the privilege
manifest. Do not hand-create partial runtime roles or replay SQL over a
partially initialized database.

```bash
cd /Users/woonchunkit/Sites/aims-site
npm install
npm run bootstrap
```

The resulting database must report schema 71 and migration
`071_p20_7a_enterprise_ui_contracts`. The local bootstrap then applies the
separately isolated development fixture layer. Production uses
`npm run migrate:production` and never invokes it.

---

### 2️⃣ Verify Environment Configuration

The bootstrap creates `.env.local` with distinct local-only runtime URLs. Never
copy these development credentials into a hosted environment.

```bash
grep 'DATABASE_URL' .env.local
```

Should show:
```
DATABASE_URL=postgresql://aims_app:local_app@127.0.0.1:55432/aims
FINANCE_DATABASE_URL=postgresql://aims_finance_runtime:local_finance@127.0.0.1:55432/aims
PAYMENT_DATABASE_URL=postgresql://aims_payment_runtime:local_payment@127.0.0.1:55432/aims
DOCUMENT_WORKER_DATABASE_URL=postgresql://aims_document_worker_runtime:local_worker@127.0.0.1:55432/aims
```

---

### 3️⃣ Start the complete local application

Run the canonical launcher. It verifies schema 71, Redis, ports and readiness,
then starts the API, worker and frontend together.

```bash
npm run local
```

You should see:
```
[Nest] INFO [NestApplication] Nest application successfully started
```

The web application runs at `http://localhost:3000` and the API at
`http://localhost:3001`.

Test it:
```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

---

## 4️⃣ Access the Application

Open your browser and go to: **http://localhost:3000**

### Demo Login Identities

You'll see a login screen. Choose from these demo users:

| Identity | Role | What you can do |
|----------|------|-----------------|
| **demo.requester** | Requester | Create payment requests, submit, track status |
| **demo.finance** | Finance | Validate, analyze, check contexts |
| **demo.approver** | Approver | Approve payment requests |

For full testing, start with **`demo.requester`** to create a payment request, then switch to **`demo.finance`** to process it.

---

## ✅ Success Checklist

After startup, verify:

- [ ] PostgreSQL is running
- [ ] All 71 migrations applied successfully; schema is 71 at `071_p20_7a_enterprise_ui_contracts`
- [ ] API server running on port 3001
- [ ] Web server running on port 3000
- [ ] Can access http://localhost:3000
- [ ] Can log in with demo.requester
- [ ] Can create a payment request

---

## 🔍 Troubleshooting

### Problem: "Connection refused" to database

**Solution:**
```bash
# Check if PostgreSQL is running
docker ps | grep postgres
# or
pg_isready -h localhost -p 5432
```

---

### Problem: "Role does not exist" or "Permission denied"

**Solution:** Re-run `npm run bootstrap`; it preserves an existing `.env.local`
and verifies the complete role and privilege model.

---

### Problem: API won't start - "Database schema version..."

**Solution:** Make sure all migrations are applied:
```bash
# Check current migration status
docker compose exec -T postgres psql -X -U postgres -d aims -c "SELECT version,migration_id FROM aims_schema_version WHERE singleton;"
```

---

### Problem: Port 3000 or 3001 already in use

**Solution:**
```bash
# Find what's using the port
lsof -ti:3000
lsof -ti:3001

# Kill the process if needed
kill -9 $(lsof -ti:3000)
```

---

### Problem: "Module not found" errors

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules
npm install
```

---

## 🎯 Common Tasks

### View API Documentation
http://localhost:3001/openapi (only available in development)

### Create a Payment Request
1. Log in as `demo.requester`
2. Click "New Request"
3. Fill in the form (payee, amount, purpose, etc.)
4. Upload a document (optional)
5. Click "Submit"

### Process as Finance
1. Log in as `demo.finance`
2. Click "Work Queue"
3. Select the submitted request
4. Run validation, finance context, risk analysis
5. View policy evaluation

### Test Full Workflow
1. Create request as `demo.requester`
2. Submit for approval
3. Switch to `demo.approver`
4. Approve the request
5. Switch to `demo.finance`
6. Complete finance control
7. Record payment

---

## 🛠️ Development Commands

```bash
# Type check
npm run typecheck

# Lint code
npm run lint

# Run tests (unit)
npm test

# Run integration tests
npm run test:integration --workspace @aims/api

# Build for production
npm run build
```

---

## 📊 Monitoring

### Check API Health
```bash
curl http://localhost:3001/health/live    # Process liveness
curl http://localhost:3001/health/ready   # Dependency readiness
```

### Check Database Connection
```bash
psql -U aims_app -d aims -h localhost -c "SELECT current_user, current_database();"
```

### View Logs
- **API logs:** In the terminal running `npm run dev --workspace @aims/api`
- **Web logs:** In the terminal running `npm run dev`
- **Browser console:** Open DevTools (F12) in browser

---

## 🎨 New UI Components Available!

After Phase 1 refactoring, you can now use:

```tsx
import { StatusChip, KpiCard, Button } from "@/app/components/shared";
import { formatCurrency, formatDate } from "@/app/lib/utils";
```

See `WHATS_NEW.md` for details!

---

## 📚 Documentation

- **README.md** - Project overview
- **WHATS_NEW.md** - UI improvements & examples
- **REFACTOR_PROGRESS.md** - Technical refactoring details
- **UI_IMPROVEMENTS.md** - Full UI assessment
- **docs/LOCAL-DEVELOPMENT.md** - Detailed development guide
- **docs/COMPETITION-DEMO.md** - Demo workflow

---

## 🆘 Still Having Issues?

Check these resources:

1. **Terminal output** - Look for error messages
2. **Browser console** - Check for JavaScript errors
3. **Database logs** - Check PostgreSQL logs
4. **Network tab** - Check API request/response in DevTools

Common fixes:
- Restart both servers
- Clear browser cache
- Rebuild: `npm run build`
- Check `.env` file values

---

## 🚀 You're Ready!

Once everything is running:
1. Open http://localhost:3000
2. Log in as `demo.requester`
3. Create your first payment request
4. Explore the 12-stage workflow!

**Have fun exploring AIMS!** 🎉
