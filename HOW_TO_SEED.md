# How to Run Seeders in AIMS

## Overview

AIMS has two types of seed data:

1. **Basic Demo Seed** - Minimal data for local development (already included in migrations)
2. **Competition Seed** - Comprehensive dataset with multiple scenarios

---

## Option 1: Basic Demo Seed (Included in Migrations)

The basic seed data is **automatically applied** when you run migrations. It includes:

- 2 departments (Operations, Finance)
- 2 demo users (Requester, Finance)
- Basic user roles

### Files
- `apps/api/migrations/002_local_demo_seed.sql` - Basic users and departments
- `apps/api/migrations/006_day3_demo_finance_seed.sql` - Budget and fiscal data

### How to Apply

This is already included when you run:

```bash
./reset-and-migrate.sh
```

Or manually apply all migrations.

---

## Option 2: Competition Seed (Comprehensive Dataset) ⭐ RECOMMENDED

The competition seed creates a **complete, realistic dataset** including:

### What It Creates:

- **Multiple Departments:**
  - Operations (OPS)
  - Finance (FIN)
  - Marketing (MKT)
  - Technology (TECH)

- **Multiple Users with Different Roles:**
  - Amelia Tan (Requester)
  - Daniel Lim (Finance Analyst)
  - Sarah Lee (Manager)
  - Adrian Ng (Director)
  - Michael Wong (Finance Controller)
  - Nora Ismail (Payment Operator)
  - Grace Chen (Reporting)
  - Tech Administrator
  - Maya Rahman (Marketing Requester)
  - Ethan Teo (Technology Requester)

- **Multiple Budget Categories:**
  - Office & Equipment ($320,000 MYR)
  - Marketing ($160,000 MYR)
  - Software & Technology ($120,000 MYR)
  - Professional Services ($100,000 MYR)

- **Sample Payment Requests in Various States:**
  - **Normal Request** (A-NORMAL) - Low risk, pending manager approval
  - **High Risk Request** (B-HIGH-RISK) - Marketing campaign requiring multi-level approval
  - **Clarification Required** (C-CLARIFICATION) - Request needing additional documentation
  - **Ready for Payment** (READY) - Approved and ready for payment
  - **Paid Request** (D-PAID) - Already paid example
  - **Historical Payments** (5 paid requests from previous months)

### How to Run Competition Seed

#### Prerequisites

**IMPORTANT:** Make sure your `.env` file has this setting:

```bash
AIMS_ENVIRONMENT=competition
```

This is required for competition commands to run. If you see an error about "AIMS_ENVIRONMENT=competition is required", check line 64 in your `.env` file.

#### Step 1: Reset Database (if needed)

First, reset the competition environment to clean state:

```bash
npm run reset:competition
```

This will:
- Drop and recreate the `aims` database
- Apply all 61 migrations
- Prepare the database for seeding

#### Step 2: Run the Competition Seed

```bash
npm run seed:competition
```

This will:
- Create all departments, users, and roles
- Set up budgets and authorities
- Create sample payment requests through entire workflow
- Generate realistic test data

#### Expected Output

You should see JSON output like:

```json
{
  "result": "PASS",
  "normal": {
    "id": "...",
    "ticket": "2026-00001",
    "status": "PENDING_APPROVAL",
    "payee": "Metro Office Solutions Sdn. Bhd.",
    "amount": "8500.00"
  },
  "high": {
    "id": "...",
    "ticket": "2026-00002", 
    "status": "PENDING_APPROVAL",
    "payee": "BrightWave Media Sdn. Bhd.",
    "amount": "85000.00"
  },
  ...
}
```

---

## Complete Workflow (From Scratch)

### 1. Reset Everything and Apply Migrations

```bash
./reset-and-migrate.sh
```

Wait for all 61 migrations to complete successfully.

### 2. Seed with Competition Dataset

```bash
npm run seed:competition
```

Wait for the seeding to complete (should take a few seconds).

### 3. Start the Application

```bash
# Terminal 1: Start API
npm run dev --workspace @aims/api

# Terminal 2: Start Frontend (in a new terminal)
npm run dev
```

### 4. Login and Test

Open http://localhost:5173/login and you can log in as any of these users:

**Requesters:**
- Amelia Tan (`amelia.tan@aims.demo`)
- Maya Rahman (`maya.rahman@aims.demo`)
- Ethan Teo (`ethan.teo@aims.demo`)

**Finance/Approvers:**
- Daniel Lim (`daniel.lim@aims.demo`) - Finance Analyst
- Sarah Lee (`sarah.lee@aims.demo`) - Manager
- Michael Wong (`michael.wong@aims.demo`) - Finance Controller
- Nora Ismail (`nora.ismail@aims.demo`) - Payment Operator

**Admin:**
- Technical Administrator (`tech.admin@aims.demo`)

---

## Troubleshooting

### Error: "AIMS_ENVIRONMENT=competition is required"

If you see:

```
Error: Competition command refused: AIMS_ENVIRONMENT=competition is required.
```

**Solution:** Edit your `.env` file and change line 64:

```bash
# Change from:
AIMS_ENVIRONMENT=development

# To:
AIMS_ENVIRONMENT=competition
```

Then try again.

### Error: "Competition seed already exists"

If you see this error:

```
Competition seed already exists. Run reset:competition before reseeding.
```

Solution:

```bash
npm run reset:competition
npm run seed:competition
```

### Error: "Cannot find module"

Make sure to build the API first:

```bash
npm run build --workspace @aims/api
npm run seed:competition
```

### Error: Database connection refused

Make sure PostgreSQL container is running:

```bash
docker ps
```

If not running:

```bash
docker start PostgreSQL
```

---

## Understanding the Seed Data

### Sample Scenarios Created

1. **Normal Low-Risk Request (A-NORMAL)**
   - Payee: Metro Office Solutions
   - Amount: $8,500
   - Category: Office & Equipment
   - Status: Pending manager approval
   - Risk: LOW

2. **High-Risk Marketing Request (B-HIGH-RISK)**
   - Payee: BrightWave Media
   - Amount: $85,000
   - Category: Marketing
   - Status: Pending multi-level approval (Manager + Director)
   - Risk: HIGH (budget pressure, material amount)

3. **Clarification Scenario (C-CLARIFICATION)**
   - Payee: CloudSphere Technologies
   - Amount: $24,800
   - Category: Software & Technology
   - Status: Clarification required
   - Issue: Invoice service period mismatch

4. **Ready for Payment (READY)**
   - Payee: Vertex Business Systems
   - Amount: $8,500
   - Status: All approvals complete, ready for payment

5. **Already Paid (D-PAID + 4 Historical)**
   - Various vendors
   - All completed in previous months
   - Available for reporting/audit testing

---

## NPM Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run reset:competition` | Reset database and apply all migrations |
| `npm run seed:competition` | Seed with comprehensive competition dataset |
| `./reset-and-migrate.sh` | Manual script to reset and migrate |

---

## What Gets Seeded

### Database Tables Populated:

- ✅ `departments` - 4 departments
- ✅ `users` - 10 users
- ✅ `user_roles` - Role assignments
- ✅ `budgets` - 4 budget categories
- ✅ `budget_versions` - Current budget versions
- ✅ `budget_commitments` - Active commitments
- ✅ `approval_authorities` - Manager and Director authorities
- ✅ `finance_control_authorities` - Controller authority
- ✅ `payment_authorities` - Payment operator authority
- ✅ `finance_reporting_authorities` - Reporting authority
- ✅ `payment_requests` - 10 payment requests in various states
- ✅ `payment_documents` - Invoice attachments
- ✅ `validation_runs` - Validation records
- ✅ `finance_contexts` - Budget analysis
- ✅ `financial_analyses` - Risk assessments
- ✅ `policy_sets` & `policy_rules` - Approval workflows
- ✅ `approval_records` - Approval steps
- ✅ `finance_control_runs` - Control checks
- ✅ `payments` - Completed payments
- ✅ `audit_events` - Full audit trail

---

## Next Steps After Seeding

1. **Explore Payment Requests** - View the dashboard with multiple requests
2. **Test Approval Workflow** - Approve pending requests as Manager/Director
3. **Try Finance Control** - Complete control checks as Controller
4. **Process Payments** - Record payments as Payment Operator
5. **View Reports** - Check budget consumption and payment history

Ready to seed? Run:

```bash
npm run reset:competition && npm run seed:competition
```
