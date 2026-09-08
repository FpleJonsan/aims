# 🚀 Quick Start Guide - AIMS

**Date:** 2026-09-08

---

## Prerequisites Check ✅

Before starting, make sure you have:
- ✅ Node.js v22+ installed
- ✅ Docker running (for PostgreSQL)
- ✅ Port 3000 (web) and 3001 (API) available

---

## Step-by-Step Startup

### 1️⃣ Start PostgreSQL Database

You need a PostgreSQL database running. Choose one option:

#### Option A: Use Docker (Recommended)

```bash
# Start PostgreSQL container
docker run -d \
  --name aims-postgres \
  -e POSTGRES_DB=aims \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=your_secure_password \
  -p 5432:5432 \
  postgres:17

# Verify it's running
docker ps | grep aims-postgres
```

#### Option B: Use Existing PostgreSQL

If you already have PostgreSQL installed locally:
```bash
# Create database
createdb aims

# Or connect and create:
psql postgres
CREATE DATABASE aims;
\q
```

---

### 2️⃣ Set Up Database Users & Roles

Connect to PostgreSQL and create the required roles:

```bash
# Using Docker container
docker exec -it aims-postgres psql -U postgres -d aims

# Or local PostgreSQL
psql -U postgres -d aims
```

Then run these SQL commands:

```sql
-- Create application user
CREATE USER aims_app WITH PASSWORD '111';

-- Create finance executor capability role (NOLOGIN)
CREATE ROLE aims_finance_executor NOLOGIN;

-- Create finance runtime user (member of executor role)
CREATE USER aims_finance_runtime WITH PASSWORD '111';
GRANT aims_finance_executor TO aims_finance_runtime;

-- Create payment executor capability role (NOLOGIN)
CREATE ROLE aims_payment_executor NOLOGIN;

-- Create payment runtime user (member of executor role)
CREATE USER aims_payment_runtime WITH PASSWORD '111';
GRANT aims_payment_executor TO aims_payment_runtime;

-- Exit
\q
```

---

### 3️⃣ Run Database Migrations

Apply all 53 migrations in order:

```bash
cd /Users/woonchunkit/Sites/aims-site

# If using Docker:
for f in apps/api/migrations/*.sql; do
  echo "Applying $f..."
  docker exec -i aims-postgres psql -U postgres -d aims -v ON_ERROR_STOP=1 < "$f"
done

# If using local PostgreSQL:
for f in apps/api/migrations/*.sql; do
  echo "Applying $f..."
  psql -U postgres -d aims -v ON_ERROR_STOP=1 < "$f"
done
```

**Important:** This will apply all migrations including demo data fixtures.

---

### 4️⃣ Verify Environment Configuration

Check your `.env` file has correct database URLs:

```bash
cat .env | grep DATABASE_URL
```

Should show:
```
DATABASE_URL=postgresql://aims_app:111@localhost:5432/aims
FINANCE_DATABASE_URL=postgresql://aims_finance_runtime:111@localhost:5432/aims
PAYMENT_DATABASE_URL=postgresql://aims_payment_runtime:111@localhost:5432/aims
```

---

### 5️⃣ Start the API Server

Open a terminal and run:

```bash
cd /Users/woonchunkit/Sites/aims-site
npm run dev --workspace @aims/api
```

You should see:
```
[Nest] INFO [NestApplication] Nest application successfully started
```

**API will be running at:** `http://localhost:3001`

Test it:
```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

---

### 6️⃣ Start the Web Application

Open a **second terminal** and run:

```bash
cd /Users/woonchunkit/Sites/aims-site
npm run dev
```

You should see:
```
▲ Next.js 16.3.3
- Local: http://localhost:3000
```

**Web will be running at:** `http://localhost:3000`

---

## 7️⃣ Access the Application

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
- [ ] All 53 migrations applied successfully
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

**Solution:** Run the user creation SQL from Step 2 again.

---

### Problem: API won't start - "Database schema version..."

**Solution:** Make sure all migrations are applied:
```bash
# Check current migration status
psql -U postgres -d aims -c "SELECT * FROM schema_version ORDER BY applied_at DESC LIMIT 5;"
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
