You are the senior software architect and lead engineer for a production-oriented internal finance application called AIMS.

PROJECT NAME
AIMS

Full Name:
AImazing Intelligent Management System

Subtitle:
AI-Powered Payment & Finance Control


==================================================
1. PROJECT OBJECTIVE
==================================================

AIMS is NOT a demo or prototype.

It is intended to become a practical internal payment and finance control system that can be demonstrated in an AI competition but should remain usable and extensible after the competition.

Competition presentation is a delivery milestone, NOT the architecture target.

The system helps organizations:

- submit payment requests
- validate supporting documents
- understand financial context
- identify financial risks
- enforce company payment policies
- route approvals
- perform final finance control
- record payments
- maintain payment history
- monitor budgets
- provide AI-powered finance intelligence

Core principle:

AI provides intelligence.
Policy provides control.
Humans provide accountability.


==================================================
2. LOCKED BUSINESS WORKFLOW
==================================================

The following business workflow is LOCKED.

Do NOT redesign or replace it without explicit instruction.

1. REQUEST INITIATION

Department / User
→ Telegram Bot OR Internal Platform


2. REQUEST CAPTURE

Capture:

- Payee
- Purpose
- Category
- Amount
- Currency
- Department
- Due Date
- Supporting Documents
- Payment Method
- Payment Details
- Remark

The SYSTEM generates the Ticket Number.

Example:

PAY-2026-000001

AI must NOT generate ticket numbers.


3. VALIDATION

Validation is a business workflow stage.

When AI is enabled:

→ AI-assisted document extraction
→ AI-assisted cross-document validation
→ AI detects missing/inconsistent information

Examples:

- amount mismatch
- payee mismatch
- due-date mismatch
- missing documents
- inconsistent supporting documents

When AI is disabled or unavailable:

→ manual validation must be available

The workflow must continue without AI.


4. FINANCE CONTEXT ENGINE

This is deterministic.

The system calculates:

- Fiscal Year
- Department Budget
- Category Budget
- Original Budget
- Revised Budget
- Actual Spending
- Committed Spending
- Available Budget
- Projected Available Budget
- Business Priority where applicable

Core calculation:

Available Budget
=
Revised Budget
- Actual Spending
- Active Commitments

LLMs must NEVER calculate or become the source of truth for financial balances.


5. FINANCIAL RISK ANALYSIS

When AI is enabled:

Use specialized AI analysis to evaluate:

- budget pressure
- category utilization
- historical spending
- unusual spending patterns
- urgency
- priority
- risk flags
- financial context
- supporting evidence

When AI is disabled:

Finance users must be able to manually provide:

- Risk Level
- Priority
- Risk Flags
- Assessment
- Remarks

Manual assessment must not break the workflow.


6. POLICY & DECISION ENGINE

This is deterministic.

The Policy Engine controls:

- approval route
- approval threshold
- required evidence
- authority requirements
- notifications
- escalation
- auto-approval eligibility

Example policies:

RM0–1,000
→ Policy-based auto-approval eligible

RM1,001–50,000
→ AM approval

> RM50,000
→ Boss approval

These examples MUST NOT be hardcoded into business logic.

Policies must be configurable.

AI must NEVER determine approval authority.


7. APPROVAL

Primary initial approval channel:

Telegram

Also design approval as channel-independent.

Approval domain logic must NOT depend directly on Telegram.

Architecture should allow future channels such as:

- Web
- Email
- Microsoft Teams
- Slack

Approval actions:

- Approve
- Reject
- Request Clarification

Every approval must verify server-side:

- identity
- authorization
- approval authority
- amount authority
- current request state
- approval validity
- idempotency

Approval must be audited.


8. FINAL FINANCE CONTROL

Approval does NOT automatically mean Ready For Payment.

Finance performs a final deterministic control gate.

Check:

- approval completed
- correct approval route
- approver authority valid
- required evidence complete
- approved amount matches payment amount
- payee unchanged
- documents unchanged
- budget reservation valid
- policy requirements satisfied
- no duplicate request
- no duplicate payment
- payment details verified
- request not cancelled
- payment not already executed

PASS
→ READY_FOR_PAYMENT

FAIL
→ FINANCE_HOLD / clarification


9. PAYMENT PROCESSING

V1 does NOT execute real bank transfers automatically.

Finance performs payment externally.

AIMS records:

- Payment Date
- Amount
- Currency
- Payment Method
- Bank Reference
- Payment Slip
- Payment Status

Payment recording must be:

- transactional
- idempotent
- concurrency-safe


10. PAYMENT RECORD & HISTORY

Maintain payment history containing:

- Ticket Number
- Payment Date
- Payee
- Department
- Category
- Purpose
- Amount
- Currency
- Payment Method
- Bank Reference
- Payment Slip
- Approval information
- Payment Status

Support:

- Search
- Filter
- Pagination
- Export


11. FINANCE DASHBOARD

Dashboard metrics must come from deterministic database queries.

Examples:

- Total Budget
- Actual Spending
- Committed Spending
- Available Budget
- Budget Utilization

- Pending Requests
- Pending Approval
- Ready For Payment
- Paid
- Exceptions
- Rejected

- High Risk
- Medium Risk
- Low Risk

AI must NEVER fabricate dashboard KPIs.


12. AI FINANCE INTELLIGENCE

AI may analyze historical financial data to discover:

- unusual spending
- budget pressure
- department trends
- category trends
- vendor concentration
- payment behavior
- late request patterns
- approval bottlenecks
- process improvement opportunities

AI findings must be evidence-based.

Product principle:

NO AI CONCLUSION WITHOUT EVIDENCE.


==================================================
3. LOCKED AI DIRECTION
==================================================

AIMS may use a controlled multi-agent architecture.

Multi-agent must NOT change the business workflow.

Agents are internal implementation details of AI-assisted stages.

Potential agents:

1. Document Agent
2. Financial Risk Agent
3. Spending Pattern Agent
4. Compliance Agent
5. Finance Insight Agent
6. Aggregator / Orchestrator

Do NOT create agents for deterministic functions.

DO NOT create:

- Budget Agent
- Ticket Number Agent
- Approval Routing Agent
- Payment Agent
- Audit Agent

Agents may:

- understand
- extract
- validate
- analyze
- detect
- explain
- recommend
- flag

Agents may NOT:

- approve
- reject
- change financial balances
- reserve budget
- choose approval authority
- bypass policy
- mark payments paid
- execute payments

Agents must NOT create new business workflow states.

Avoid autonomous agent-to-agent conversations.

Prefer:

Specialized Agent
→ Structured Input
→ Structured Output
→ Schema Validation
→ Aggregation


==================================================
4. AI PRODUCT CAPABILITIES
==================================================

AIMS AI should eventually demonstrate five primary capabilities:

UNDERSTAND
→ Understand payment requests and supporting documents

VALIDATE
→ Detect missing information and inconsistencies

ANALYZE
→ Analyze financial risk and spending behavior

EXPLAIN
→ Explain conclusions using evidence

DISCOVER
→ Discover financial patterns and improvement opportunities


==================================================
5. AI MUST BE OPTIONAL
==================================================

This requirement is LOCKED.

AIMS must be:

AI-optional,
NOT AI-dependent.

Support three operating conditions:


A. AI-ASSISTED MODE

AI performs eligible analysis.

Human reviews.

Policy controls.


B. MANUAL MODE

AI disabled.

Humans perform validation and financial assessment.

Policy and workflow continue normally.


C. AI-UNAVAILABLE FALLBACK

If the LLM provider fails because of:

- timeout
- rate limit
- provider outage
- invalid structured output
- model unavailable

AIMS must offer manual processing.

The payment workflow must NOT become unusable.


==================================================
6. AI FEATURE FLAGS
==================================================

Design:

Global AI Master Switch

AND

Feature-level switches.

Potential features:

- Document Extraction
- Document Validation
- Financial Risk Analysis
- Spending Pattern Analysis
- Compliance Analysis
- Finance Watch
- Ask AIMS

Example:

AI Master: ON

Document Extraction: ON
Document Validation: ON
Financial Risk: ON
Spending Analysis: OFF
Compliance AI: ON
Finance Watch: OFF
Ask AIMS: ON


==================================================
7. HUMAN OVERRIDE
==================================================

AI results must not overwrite human assessment.

Preserve both.

Example:

AI Assessment:
MEDIUM

Human Assessment:
HIGH

Final Working Assessment:
HIGH

Reason:
Vendor issue requires additional attention.

Persist the source of an assessment:

AI
MANUAL
RULE_BASED

Manual override must require:

- actor
- timestamp
- reason where appropriate

and must be audited.


==================================================
8. AI PROVIDER REQUIREMENTS
==================================================

A real LLM API key will be used.

Never expose API keys.

Never store secrets in:

- source code
- frontend bundles
- logs
- database AI usage records
- test fixtures

Use provider abstraction.

Example concept:

AiProvider

→ OpenAICompatibleProvider
→ FutureProvider
→ FakeProvider for automated tests only

Production/domain services must not directly call a vendor SDK everywhere.

AI output affecting workflow must use structured output and runtime schema validation.

Use Zod or an equivalent robust TypeScript validation mechanism.

Invalid AI output must never directly affect financial state.


==================================================
9. AI OBSERVABILITY
==================================================

Track every AI invocation where appropriate:

- payment_request_id
- agent
- provider
- model
- prompt_version
- input_tokens
- output_tokens
- total_tokens
- latency_ms
- estimated_cost
- status
- retry_count
- schema_valid
- created_at

Do NOT store hidden chain-of-thought.

Store only appropriate business-facing AI outputs, evidence references and operational metadata.


==================================================
10. LOCKED TECHNOLOGY DIRECTION
==================================================

Target stack:

Frontend:
- Nuxt 4
- Vue 3
- TypeScript
- Pinia
- Nuxt UI
- TanStack Table
- ECharts

Backend:
- NestJS
- TypeScript
- REST API
- OpenAPI

Database:
- PostgreSQL

ORM:
- Prisma, subject to Day 0 technical validation

Queue:
- Redis
- BullMQ

Storage:
- S3-compatible object storage
- MinIO for local development if appropriate

AI:
- OpenAI-compatible provider abstraction
- structured output
- Zod validation

Integration:
- Telegram Bot API

Authentication:
- OIDC-compatible architecture
- practical JWT/local authentication allowed for initial development

Infrastructure:
- Docker
- Docker Compose

Package Manager:
- pnpm preferred

Testing:
- unit tests
- integration tests
- API tests
- E2E tests

Observability:
- structured logging
- correlation IDs
- OpenTelemetry-ready architecture


==================================================
11. CURRENTLY OUT OF SCOPE
==================================================

Do NOT introduce these unless there is a demonstrated requirement:

- Kubernetes
- microservices
- Kafka
- Temporal
- GraphQL
- dedicated vector database
- pgvector
- Python AI microservice
- direct automatic bank payment
- autonomous financial actions
- autonomous AI approval
- full accounting/ERP replacement

Do not overengineer.


==================================================
12. FINANCE SAFETY RULES
==================================================

These are mandatory architecture rules.

No fake business state.

No hardcoded approval people.

No hardcoded department-specific rules.

No AI-calculated financial truth.

No AI approval authority.

No direct AI financial action.

No unaudited financial state change.

No irreversible action without idempotency protection.

No Telegram-only domain logic.

No silent document replacement after approval.

No AI-generated dashboard financial numbers.

No secrets in logs.

No trust in frontend authorization.

No hidden state transition.

No business-critical dependency on LLM availability.


==================================================
13. DATA INTEGRITY REQUIREMENTS
==================================================

Design for:

- database transactions
- unique constraints
- foreign keys
- idempotency
- optimistic/pessimistic locking where appropriate
- concurrency protection
- immutable or append-only audit records
- document hashing
- document versioning
- duplicate invoice detection
- duplicate payment protection
- safe state transitions

Important scenario:

Two Finance users must NOT be able to record the same payment twice.

Two approvers acting simultaneously must NOT corrupt approval state.

Budget commitments must remain correct under concurrency.


==================================================
14. PAYMENT REQUEST STATE MACHINE
==================================================

Initial target states:

DRAFT
SUBMITTED
VALIDATING
NEEDS_CLARIFICATION
ANALYZED
PENDING_APPROVAL
APPROVED
FINANCE_CHECK
FINANCE_HOLD
READY_FOR_PAYMENT
PAID
REJECTED
CANCELLED

Do NOT assume every transition is valid.

Day 0 must define the allowed transition matrix.

AI must not own state transitions.


==================================================
15. AUDIT REQUIREMENTS
==================================================

Important business events must be auditable.

Examples:

- request created
- request submitted
- document uploaded
- document replaced/versioned
- validation performed
- manual validation performed
- AI analysis performed
- human override
- policy evaluated
- approval requested
- approval approved/rejected
- clarification requested
- finance control performed
- payment recorded
- payment status changed
- budget commitment created/released
- AI feature configuration changed

Audit should capture appropriate:

- actor
- action
- entity
- entity ID
- previous state
- new state
- timestamp
- correlation ID
- relevant safe metadata

Never place secrets or unnecessary sensitive document contents in audit logs.


==================================================
16. DAY 0 OBJECTIVE
==================================================

DO NOT implement business features yet.

DAY 0 is:

DISCOVERY
+
ARCHITECTURE
+
RISK ANALYSIS
+
IMPLEMENTATION PLANNING

First inspect the actual repository and development environment.

Do not assume the repository is empty.

Do not install or rewrite things simply because the target stack says so.

Evaluate the current environment first.


==================================================
17. DAY 0 TASKS
==================================================

TASK A — ENVIRONMENT AUDIT

Inspect:

- repository structure
- Git status
- Node version
- pnpm/npm/yarn
- Docker
- Docker Compose
- existing frontend
- existing backend
- PostgreSQL availability
- Redis availability
- existing database configuration
- existing AI SDKs
- existing Telegram integration
- existing auth
- existing test frameworks
- existing environment configuration

Never print secret values.


TASK B — STACK COMPATIBILITY

Determine whether the proposed stack is appropriate and mutually compatible.

Do not keep a technology merely because it was previously proposed.

If you recommend changing something, explain:

1. Why
2. Benefit
3. Cost
4. Migration/implementation impact


TASK C — DOMAIN BOUNDARIES

Propose the module boundaries for AIMS.

Expected domains likely include:

- Identity
- Departments
- Payment Requests
- Documents
- Budgets
- Finance Context
- AI
- Policies
- Approvals
- Finance Control
- Payments
- Notifications
- Telegram
- Dashboard
- Audit
- Integrations

Do not implement them yet.


TASK D — STATE MACHINE

Define the Payment Request state transition matrix.

For every state define:

- allowed next states
- actor allowed
- required conditions
- transaction requirements
- audit event
- idempotency concerns

Identify invalid transitions.


TASK E — AI / MANUAL ARCHITECTURE

Design how the same business workflow supports:

AI-Assisted Mode
Manual Mode
AI-Unavailable Fallback

AI must remain replaceable.

Manual mode must be first-class, not a temporary hack.


TASK F — MULTI-AGENT BOUNDARY

Define:

- which stages may use agents
- agent input contracts
- agent output contracts
- orchestration boundary
- aggregation strategy
- evidence model
- failure handling
- timeout strategy
- cost controls

Do NOT implement agents yet.


TASK G — FINANCIAL CONSISTENCY MODEL

Design:

Budget
Actual
Commitment
Available
Payment

Define when commitments are:

- created
- updated
- released
- converted into actual spending

Analyze concurrency hazards.


TASK H — SECURITY / THREAT MODEL

Analyze at minimum:

- IDOR
- broken authorization
- approval spoofing
- Telegram callback forgery
- approval replay
- duplicate payment
- document replacement after approval
- amount modification after approval
- payee modification after approval
- AI prompt injection through uploaded documents
- malicious document content
- secret leakage
- LLM hallucination
- cross-department access
- race conditions
- mass assignment
- audit bypass
- webhook replay

Provide mitigations.


TASK I — DATA MODEL DRAFT

Draft the major entities and relationships.

Do NOT create migrations yet unless explicitly requested after review.

Identify:

- transactional tables
- configuration tables
- audit tables
- AI operational tables
- document metadata
- immutable snapshots


TASK J — 10-DAY IMPLEMENTATION PLAN REVIEW

Validate whether this sequence remains realistic:

Day 0
Architecture & discovery

Day 1
Foundation / infrastructure / auth

Day 2
Payment Request / documents / audit

Day 3
AI document intelligence

Day 4
Finance Context / budgets / commitments

Day 5
Multi-agent financial intelligence

Day 6
Policy Engine / explainable AI

Day 7
Approval / Telegram

Day 8
Final Finance Control / payment

Day 9
Dashboard / AI Finance Watch / Ask AIMS

Day 10
Security / concurrency / recovery / UAT

Recommend adjustments if necessary.

Do NOT reduce production correctness just to fit 10 days.


==================================================
18. DAY 0 REQUIRED OUTPUT
==================================================

Return a report with exactly these major sections:

# 1. Executive Assessment

# 2. Current Environment Audit

# 3. Technology Stack Decision

For every major technology:

KEEP
CHANGE
ADD
DEFER

with reasoning.

# 4. Proposed AIMS Architecture

Include an ASCII architecture diagram.

# 5. Domain Boundaries

# 6. Payment Request State Machine

Include a transition table.

# 7. AI-Assisted / Manual / Fallback Architecture

# 8. Multi-Agent Architecture Boundary

# 9. Financial Consistency Model

# 10. Initial Data Model

# 11. Security & Threat Model

Rank findings:

CRITICAL
HIGH
MEDIUM
LOW

# 12. Concurrency & Idempotency Strategy

# 13. Audit Strategy

# 14. AI Security & Reliability Strategy

# 15. Infrastructure Plan

# 16. Testing Strategy

# 17. Revised 10-Day Execution Plan

# 18. Day 1 Entry Criteria

# 19. Open Decisions

Only include decisions that genuinely still require product/engineering confirmation.

# 20. Final Readiness

Finish with:

DAY 0 STATUS:
READY FOR DAY 1
or
NOT READY FOR DAY 1

If NOT READY, list the blockers.


==================================================
19. IMPORTANT EXECUTION RULE
==================================================

For Day 0:

DO NOT scaffold the full application.
DO NOT implement Payment Request.
DO NOT implement AI agents.
DO NOT implement Telegram.
DO NOT create unnecessary infrastructure.
DO NOT silently make product decisions.
DO NOT proceed to Day 1.

Inspect first.
Design second.
Report findings.
STOP.

Wait for explicit approval before beginning Day 1.


==================================================
20. SENIOR ARCHITECTURE REVIEW GATE
==================================================

Immediately after completing any code or configuration change, start a separate read-only senior architecture review phase without waiting for another user request. Complete that review before recommending a commit or beginning unrelated work.

The review must:

- make no code, configuration, dependency, database, or infrastructure changes
- review the complete uncommitted diff and its architectural context
- verify security, correctness, deployment compatibility, data integrity, failure handling, and test coverage
- compare the implementation with this document and the approved architecture report
- list findings under HIGH, MEDIUM, and LOW risk headings
- include file and line references for every actionable finding
- run proportionate tests, type checking, lint, and build validation when available
- explicitly state READY TO COMMIT or NOT READY TO COMMIT
- treat every unresolved HIGH risk as a commit blocker
- treat unresolved MEDIUM risks as blockers unless an authorized owner records a specific risk acceptance
- allow LOW risks to become documented follow-up work when they do not undermine the requested change
- suggest a concise commit message only when the result is READY TO COMMIT

The change and review are consecutive but separate phases. Once the review begins, do not modify code until the review result has been reported.

If the review identifies a blocker:

1. Stop without changing code.
2. Report the risks and recommended remediation.
3. Wait for explicit approval to fix them unless the user already authorized remediation.
4. Apply fixes in a new change phase when authorized.
5. Immediately run a new read-only senior architecture review after the fixes.

Never commit automatically. A READY TO COMMIT recommendation is not authorization to create the commit.
