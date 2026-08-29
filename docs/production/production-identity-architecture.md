# AIMS Production Identity Architecture and P1 Readiness

Status: P1 decision architecture. This document defines the production identity trust boundary and implementation prerequisites. It does not implement OIDC, select a vendor, authorize deployment, or change AIMS business authority.

## Non-negotiable boundary

```text
Corporate Identity Provider
        |
        | proves who the person is
        v
Verified authentication boundary
        |
        | supplies a stable, validated external identity
        v
AIMS identity mapping: (issuer, subject) -> active AIMS user
        |
        v
AIMS PostgreSQL business-authority lookup
        |
        | determines what Finance operations are permitted now
        v
Operation-specific backend and database authorization
```

External groups, job titles, departments, tenant membership, or role claims never grant Approval, Finance Control, Payment, Reporting, Finance Analysis, Policy administration, or another operational Finance authority. Technical `ADMIN` remains non-operational unless independent AIMS authority records explicitly grant a business capability.

## Current authentication architecture

```text
Local/competition browser selector
  -> browser sends x-aims-user on every API request
  -> AuthGuard reads the header
  -> users.external_subject lookup requires users.active=true
  -> user_roles build the request Principal
  -> services query independent current authority tables
  -> /session projects user, workspace entitlement, and capabilities
  -> frontend presents authorized workspaces
```

- Header: `x-aims-user`.
- Local and competition: the browser is deliberately allowed to select and send a synthetic subject. The catalogue is disabled when `NODE_ENV=production`.
- Production: startup requires `AUTH_TRUSTED_PROXY=true`; `AuthGuard` then accepts the same header. The application does not verify request source, proxy identity, a signed assertion, issuer, audience, expiry, or header stripping.
- Session: there is no server-side or cryptographic session. Authentication is repeated from the header and database on each request.
- Frontend: production omits `x-aims-user`, calls `/session`, clears protected state on `401`, and refreshes `/session` after `403`. Local workspace preference and a safe internal redirect are the only browser-stored navigation state.
- Logout: local logout clears client state. Production can redirect to `NEXT_PUBLIC_AIMS_LOGOUT_URL`, but there is no AIMS session to revoke and no approved IdP logout contract.
- Authorization: PostgreSQL remains authoritative. Requester ownership and operation-specific business-authority checks occur on the backend; frontend visibility is presentation only.

### Current production assessment

Production authentication is **unsafe if the API is reachable by an untrusted client**. `AUTH_TRUSTED_PROXY=true` is only a configuration assertion and does not establish a network trust boundary. The current implementation must not be deployed for real users until P2 implements one approved validation pattern and verifies proxy-bypass prevention.

## Target authentication architecture

### Recommended default: AIMS BFF/server session with direct OIDC validation

This is a recommendation, not an approved company decision.

```text
Browser -> TLS AIMS edge/BFF -> Authorization Code + PKCE -> Corporate IdP
                           <- validated callback (state, nonce, code)
Browser <- Secure, HttpOnly, SameSite session cookie
Browser -> cookie -> AIMS BFF/API -> server-side opaque session
                                   -> (issuer, subject) mapping
                                   -> active AIMS user
                                   -> current PostgreSQL authority checks
```

The server validates signature/JWKS, exact issuer, audience/client, expiry, not-before, allowed algorithms, state, nonce, and PKCE. Refresh credentials, if needed, remain server-side and encrypted through approved secret/session infrastructure. No access, ID, or refresh token is stored in browser local storage or exposed through `/session`.

### Acceptable alternative: trusted identity-aware proxy

This option is valid only after Company IT identifies the product and proves the complete contract:

```text
Client --TLS--> identity-aware edge
  edge authenticates with approved IdP
  edge deletes every inbound identity header
  edge injects its controlled identity assertion/header
  edge --TLS/private authenticated path--> AIMS API
  AIMS API accepts traffic only from that edge
  AIMS verifies proxy authenticity/assertion as approved
```

The API must not be publicly bypassable. Source-network allowlisting alone is insufficient when stronger workload identity or signed assertions are available. Health routes may be separately exposed only with safe output and without creating an authentication bypass.

### Pattern decision

IdP, direct OIDC versus trusted proxy, edge product, hosting topology, and session infrastructure are company decisions. P2 must implement only one reviewed primary pattern; it must not keep the raw client-settable header as a production fallback.

## Identity mapping model

### Stable key

The preferred immutable external key is the tuple `(normalized issuer, subject)`. Email and display name are mutable attributes and cannot be the identity key. Tenant or directory immutable object ID may be required as an additional validated constraint if the selected provider's policy requires it.

The current `users.external_subject UNIQUE` column supports one namespace but cannot safely distinguish identical subjects from different issuers. P2 should introduce a forward-only mapping table rather than rewrite history:

```text
identity_providers
  id, issuer UNIQUE, status, metadata/config reference

user_external_identities
  id, user_id, identity_provider_id, subject,
  status, first_seen_at, last_authenticated_at,
  UNIQUE(identity_provider_id, subject)
```

Provider secrets and raw tokens are not stored in these tables. `users.id` remains the stable AIMS audit actor and foreign-key identity. `users.external_subject` requires an explicit compatibility/migration plan; no schema change is made in P1.

### Provisioning

Recommended Production v1 model: **pre-provisioned only**. An authenticated but unmapped subject receives no AIMS account and no workspace. JIT authority provisioning is prohibited. A future directory synchronization process may update approved identity/display/lifecycle attributes, but cannot create Finance authority.

Organization ownership is unresolved because the present schema has departments but no explicit organization entity. Department assignment is maintained in AIMS until an approved HR/directory synchronization contract defines ownership. Department never grants Finance authority by itself.

### Collision and change rules

| Event | Required behavior |
| --- | --- |
| Same email, different subject | Do not merge; quarantine for identity-owner review. |
| Same subject, different issuer | Distinct identities unless an approved migration explicitly links them. |
| Duplicate provider identity | Unique constraint; fail closed and alert. |
| Changed email/display name | Update approved display attributes without changing identity or audit actor. |
| Renamed employee | Preserve mapping and `users.id`; refresh display attributes by approved process. |
| Rehire | Do not silently reactivate; identity owner reviews prior mapping and Finance reassigns authorities. |
| Provider migration | Dual-provider transition requires explicit link/reconciliation, audit, collision checks, and rollback; never match by email alone. |

## Claim policy

Exact claim names depend on the approved provider. The matrix is the minimum policy.

| Claim | Source | Required | Validated | Stored | Authentication use | Display use | Authorization use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Issuer (`iss`) | Signed IdP token/assertion | Yes | Exact allowlist | Provider mapping/reference | Identity namespace and trust | No | Never grants authority |
| Subject (`sub`) | Signed IdP token/assertion | Yes | Non-empty, issuer-bound | External identity mapping | Primary external key | No | Never grants authority |
| Audience (`aud`) | Signed IdP token/assertion | Yes | Exact registered audience | No | Token acceptance | No | None |
| Expiry/not-before | Signed IdP token/assertion | Yes | With approved clock skew | No | Token validity | No | None |
| Tenant/directory ID | Signed provider claim | Provider policy | Approved tenant allowlist | If needed for mapping/audit | Tenant constraint only | No | None |
| Email | Signed provider claim/directory | Optional | Format and verified status if used | Approved contact attribute | Never sole identity key | Yes | None |
| Name | Signed provider claim/directory | Optional | Size/type only | Approved display attribute | No | Yes | None |
| Employee ID | Approved directory claim | Optional/decision | Issuer-specific format | Only if approved | Secondary reconciliation | Optional | None |
| Department | Directory or AIMS | Optional | Synchronization contract required | AIMS department mapping | No | Yes | Never grants authority |
| Groups | Signed provider claim | No | May be observed only if required | Avoid by default | No | Avoid/raw groups not exposed | **Prohibited** |
| Job title | Directory | No | Display-quality only | Avoid or approved display field | No | Optional | **Prohibited** |
| Role (`approver`, `admin`, etc.) | External claim | No | Ignored for business access | No | No | No | **Prohibited** |

Dangerous claims such as `group=Finance`, `group=FinanceManager`, `jobTitle=Finance Director`, `department=Finance`, `role=approver`, or `role=admin` provide zero AIMS operational capability.

## Session architecture

Recommended, pending platform approval:

- Opaque server-side session identifier in a `Secure`, `HttpOnly`, `SameSite` cookie.
- Cookie scoped narrowly to the AIMS production host/path; no JavaScript access.
- Session ID rotated after authentication and privilege-sensitive reauthentication to prevent fixation.
- Idle and absolute lifetime, refresh policy, clock skew, concurrent-session policy, and recent-authentication requirements are **company security decisions**.
- Server-side logout revokes the AIMS session. IdP logout behavior is separately approved; local logout must not claim corporate logout when it only ends AIMS access.
- Cookie authentication requires CSRF protection for mutations: SameSite policy plus unpredictable CSRF token and Origin/Referer validation. Safe GET endpoints remain non-mutating.
- CORS allowlists only approved exact web origins. Never `*` with credentials.
- Browser storage contains no bearer, ID, or refresh tokens. Navigation preferences are non-authoritative.
- `/session` returns only the active AIMS identity projection and current capabilities; no raw token, provider token, refresh token, unnecessary claims, or raw groups.

If the approved platform instead mandates a trusted proxy session, equivalent expiry, rotation, logout, CSRF, and replay properties must be documented and tested.

## 401 and 403 contract

- `401 Unauthorized`: credentials/session missing, invalid, expired, wrong issuer/audience, mapping unavailable, unknown subject, inactive AIMS user, or authentication trust boundary unavailable. Frontend clears all protected state, preserves only a validated internal return path, and enters the approved authentication flow. Production never falls back to local/competition auth.
- `403 Forbidden`: authenticated active user lacks the current AIMS workspace or operation-specific business authority. Frontend clears inaccessible data, refreshes `/session`, and removes inaccessible routes/actions. Backend still denies the operation from current PostgreSQL authority.
- Authority revocation may produce `403` even while the corporate session remains valid. A user becoming inactive produces `401` on the next authenticated request.

## Lifecycle and revocation

```text
Corporate identity approved
  -> external identity pre-provisioned/mapped
  -> AIMS user activated
  -> department assigned independently
  -> Finance authorities assigned independently with scope/validity
  -> every sensitive operation rechecks current authority
  -> authority expires/revokes immediately at the next operation
  -> user inactive/employee leave invalidates access
```

- Hire/activation: mapping and AIMS user activation require the approved joiner process; no automatic Finance authority.
- Transfer: atomically update the department mapping and review/revoke every department- or organization-sensitive authority before access resumes. Existing records retain their original audit attribution.
- Temporary authority: existing active/validity rules remain authoritative; expiry is checked at each protected operation.
- Leave/deactivation: central IdP access is disabled and the AIMS user is made inactive. Active AIMS sessions must be revoked or rejected on their next request.
- Rehire: explicit identity and authority review; old authorities never silently reactivate.
- Revocation latency: operational authority changes take effect on the next backend operation because mutations query current authority. Long-lived tokens must never contain authoritative Finance capabilities.
- `/session` may be cached only for short presentation use. Cache invalidation/refresh cannot replace backend checks.

## Environment isolation

| Environment | Authentication | Identity data | Fail behavior |
| --- | --- | --- | --- |
| Local | Explicit local header adapter and synthetic users | Local database | Developer-controlled only |
| Competition | Guarded selector and synthetic competition users | Isolated `aims_competition` | No production data or credentials |
| Staging | Approved test IdP/tenant and production-like session/edge | Sanitized test identities and database | No local/competition fallback |
| Production | Approved corporate IdP through implemented validation boundary | Pre-provisioned real identities | Missing/misconfigured auth prevents startup or returns 401; never local fallback |

Production must reject the identity catalogue, competition reset/seed/verification, local header authentication, competition compatibility alias behavior, and direct API identity injection.

## Trusted edge contract

If a proxy pattern is selected, P2/P13 must jointly provide:

1. Client-to-edge TLS and approved HSTS policy.
2. IdP authentication at the edge with explicit issuer/client configuration.
3. Deletion of every inbound `x-aims-user` and future trusted identity header.
4. Injection of one canonical identity assertion derived only from verified credentials.
5. Edge-to-API TLS or stronger private authenticated workload connection.
6. Firewall/routing policy preventing direct API reachability.
7. API verification of proxy authenticity or signed assertion where supported.
8. Safe health-route policy and no alternate unguarded application route.
9. Negative tests from the public path and a simulated direct-bypass path.
10. Named Platform/Security ownership for configuration and rotation.

`AUTH_TRUSTED_PROXY=true` alone satisfies none of these controls.

## Authentication failure behavior

All failures are fail closed and safely logged using correlation IDs without tokens or full authentication headers.

| Condition | Result |
| --- | --- |
| Missing credentials/proxy assertion | 401 |
| Invalid signature, algorithm, issuer, audience, expiry, not-before | 401 |
| JWKS unavailable | New validation fails unless a still-valid cached trusted key and approved stale-key window apply |
| Unknown subject or mapping collision | 401 plus safe operational alert |
| Inactive AIMS user/deactivated employee | 401 and session revocation |
| Directory/identity-mapping database unavailable | 401/503 fail closed; no fallback identity |
| Malformed or excessive claims | 401 |
| Valid identity but no workspace | Authenticated `/session` projection with no workspace, or controlled 403 according to implementation contract |
| Current business authority missing/revoked/expired | 403 for the operation |
| IdP unavailable | Existing valid sessions follow approved lifetime; new login fails safely |
| Production auth configuration missing | Application startup fails |

## Telegram identity coexistence

Telegram bindings continue to map a verified Telegram account to the same `users.id`. Telegram is a channel identity, not an authority source. Every callback continues to resolve current AIMS Approval authority, step, request state, token validity, and segregation-of-duties rules. No Telegram redesign is required in P1; Production enablement remains a P9 decision.

## Service identities

P1 covers human identity only. Database runtime/executor credentials, migration jobs, Telegram delivery, workers, schedulers, and future service-to-service authentication remain separate workload identities. Human SSO never replaces the restricted PostgreSQL executor roles. Workload-identity and secret-injection selection is deferred to P5/P7/P13.

## Threat model

| ID | Threat and current exposure | Target control | Owner | Verification test |
| --- | --- | --- | --- | --- |
| T1 | Header spoofing: raw header is trusted when flag enabled | Remove public header trust; validate OIDC or enforce authenticated proxy, stripping and API isolation | Platform + Security + Engineering | Inject header through public and direct paths; both denied |
| T2 | Token theft: no production token model yet | HttpOnly server session, TLS, minimal scopes, no browser token storage, redacted logs | Security + Engineering | XSS/storage inspection and log scan expose no token |
| T3 | Token replay | Short validity, server session rotation/revocation, nonce/state/PKCE, provider replay controls | Security + Engineering | Reuse revoked/rotated session or callback fails |
| T4 | Expired identity reuse | Validate expiry/not-before and session idle/absolute lifetime | Security | Expired token/session returns 401 |
| T5 | Wrong issuer | Exact issuer allowlist bound to provider mapping | Security | Validly signed token from other issuer denied |
| T6 | Wrong audience | Exact registered audience validation | Security | Token for another client denied |
| T7 | Claim tampering | Signature and allowed-algorithm validation; no unsigned claims | Security | Modified payload/`alg` confusion denied |
| T8 | Identity collision: current subject lacks issuer namespace | Unique `(provider, subject)` mapping and manual collision workflow | Identity owner + Engineering | Same email/different subject and same subject/different issuer do not merge |
| T9 | Deactivated employee | IdP disable plus AIMS active check and session revocation | Company IT + AIMS owner | Active session loses access after deactivation |
| T10 | Department transfer | Controlled mover workflow; authority review before reactivation | HR/Identity + Finance | Old department scope and inappropriate authority denied |
| T11 | Authority revoked while session active | Query current AIMS authority for every protected operation | Finance owner + Engineering | Revoke authority, retain session, mutation returns 403 |
| T12 | ADMIN mapped to Finance claim/group | External claims prohibited for authority; ADMIN excluded from Finance workspace by itself | Engineering + Finance | ADMIN/group-only persona has no operational workspace/capabilities |
| T13 | Competition auth enabled in Production | Production code path rejects catalogue/aliases/local adapter | Engineering | Production matrix tests every competition flag/endpoint |
| T14 | Missing Production auth config | Startup validation requires complete selected pattern | Platform + Engineering | Missing each required setting prevents startup |
| T15 | Proxy bypass/direct API | Private API or mutually authenticated/signed edge path; firewall policy | Platform + Security | Direct API request cannot establish identity |
| T16 | Open redirect | Allow only validated same-origin internal return paths | Engineering | External, scheme-relative, encoded, and protocol redirects rejected |
| T17 | Session fixation | Rotate identifier at login/reauthentication; reject caller-supplied ID | Engineering | Pre-login ID differs from authenticated session |
| T18 | CSRF | SameSite plus CSRF token and Origin/Referer validation for cookie mutations | Engineering + Security | Cross-origin mutation denied |
| T19 | XSS token theft | HttpOnly cookie, CSP decision, output safety; no browser bearer storage | Engineering + Security | Browser storage/token exposure inspection |
| T20 | Logout incomplete | Revoke AIMS session; accurately distinguish IdP logout | Identity owner + Engineering | Old cookie denied; IdP logout behavior matches policy |
| T21 | Staging credentials in Production | Separate registrations, issuers, secrets, DNS and databases | Platform + Company IT | Staging token/issuer denied by Production |
| T22 | Log/token leakage | Structured allowlisted auth events; redact headers/codes/tokens | Security + SRE | Automated log/redaction test and operational sampling |

## Test persona matrix

`Capabilities` below are AIMS PostgreSQL assignments, never IdP claims.

| Persona | Authenticated | Mapped/active | Workspace | Expected capabilities | Required denials |
| --- | --- | --- | --- | --- | --- |
| Requester | Yes | Yes | Requester | Own-request creation/read | Other owners and Finance operations |
| Finance Analyst | Yes | Yes | Finance | Analysis/work queue | Approval, Control, Payment without separate authority |
| Manager Approver | Yes | Yes | Finance | Assigned approval route/scope/amount | Self/out-of-scope/other-step approval |
| Director Approver | Yes | Yes | Finance | Assigned director approval route | Missing/stale/out-of-scope approval |
| Finance Controller | Yes | Yes | Finance | Current scoped Finance Control | Approval/Payment without separate authority; prohibited self-control |
| Payment Operator | Yes | Yes | Finance | Current scoped/amount-bounded recording | Wrong scope/amount, duplicate, prohibited self-payment |
| Reporting Manager | Yes | Yes | Finance | Read-only authorized reporting | Operational mutations |
| Technical Administrator | Yes | Yes | None unless separately authorized | Technical policy administration only | All operational Finance capabilities by ADMIN alone |
| Multi-authority user | Yes | Yes | Derived from explicit records | Exact union of current AIMS authorities | Any unassigned capability and SoD violations |
| Inactive user | Corporate credential may be valid | No | None | None | `/session` and all protected routes |
| No-workspace user | Yes | Yes | None | None | Requester/Finance APIs |
| Unknown corporate identity | Yes at IdP | No | None | None | AIMS session establishment |
| Revoked user | Credential/session may remain | Inactive/revoked | None | None | Next request and old session |
| Department-transferred user | Yes | Yes after controlled move | Reviewed | Only newly approved scope | Old department and retained inappropriate authority |
| Expired-authority user | Yes | Yes | Presentation may refresh | No expired capability | Protected mutation despite cached UI |

## Negative security test plan

- Spoofed/multiple/case-varied `x-aims-user` through public edge and direct API.
- Missing authentication; forged signature; disallowed algorithm; wrong issuer/audience; expired/not-yet-valid token.
- Replayed callback, authorization code, rotated session, logged-out session, and fixed pre-login session ID.
- Unknown subject, duplicate identity, same email with different subject, inactive user, and mapping-database outage.
- External Finance/FinanceManager/approver/admin group or role claims with no AIMS authority.
- Revoked/expired Approval, Finance Control, Payment, Reporting, and Finance Analysis authority during an active session.
- Direct protected API calls, IDOR, cross-workspace routes, and stale frontend capability state.
- Production local catalogue, competition selector, reset/seed/verification, aliases, and missing-auth fallback.
- CSRF from an unapproved origin and CORS credential requests from unapproved origins.
- Open redirects, token/header logging, excessive claims, malformed claims, and staging credentials against Production.

Existing payment, Approval, Finance Control, requester ownership, segregation-of-duties, reporting, concurrency, and UAT suites remain mandatory P2 regressions.

## Staging prerequisites

| Dependency | P1 status |
| --- | --- |
| Approved corporate IdP | BLOCKING — Company IT/Security input required |
| Test tenant/application registration | BLOCKING |
| Protocol and validation boundary | BLOCKING |
| Exact issuer/audience and metadata/JWKS | BLOCKING |
| Stable subject claim and tenant policy | BLOCKING |
| Frontend/API staging and production hostnames | BLOCKING |
| Redirect and post-logout URIs | BLOCKING |
| Trusted edge product/topology if used | BLOCKING |
| TLS/DNS and direct-API exposure policy | BLOCKING |
| Session lifetime/logout/MFA policy | BLOCKING |
| Staging personas and sanitized data | BLOCKING |
| Identity, Security, Platform, and Finance owners | BLOCKING |
| Secret-manager injection | REQUIRED for P2 staging; implementation belongs to P5 or an approved interim staging mechanism |

Staging uses dedicated registrations, identities, secrets, issuer/audience constraints, and data. Production credentials are never used for staging development.

## Decision register D1-D22

| ID | Decision | P1 status |
| --- | --- | --- |
| D1 | Corporate IdP | COMPANY INPUT REQUIRED |
| D2 | Protocol/integration | COMPANY INPUT REQUIRED; OIDC recommended where supported |
| D3 | Validation boundary | COMPANY INPUT REQUIRED; direct AIMS validation recommended, controlled proxy acceptable |
| D4 | Stable identity key | RESOLVED ARCHITECTURALLY: `(issuer, subject)`; exact provider claims required |
| D5 | Identity mapping | RESOLVED ARCHITECTURALLY: unique provider/subject to `users.id` |
| D6 | Provisioning | RECOMMENDED: pre-provisioned only; approval required |
| D7 | Organization mapping | COMPANY INPUT REQUIRED; current schema has no organization entity |
| D8 | Department mapping | COMPANY INPUT REQUIRED; AIMS-owned until synchronization approved |
| D9 | Business authority ownership | RESOLVED: AIMS PostgreSQL |
| D10 | Deactivation | RESOLVED ARCHITECTURALLY: IdP disable plus inactive AIMS user/session denial |
| D11 | Department transfer | RESOLVED ARCHITECTURALLY: controlled move plus authority review |
| D12 | Authority revocation | RESOLVED: independent current AIMS checks on every operation |
| D13 | Session strategy | RECOMMENDED: opaque server-side secure-cookie session; platform approval required |
| D14 | Session lifetime | COMPANY SECURITY INPUT REQUIRED |
| D15 | Logout | COMPANY INPUT REQUIRED; AIMS revocation mandatory, IdP logout policy unresolved |
| D16 | Reauthentication | COMPANY SECURITY/FINANCE INPUT REQUIRED |
| D17 | MFA | COMPANY IT/SECURITY INPUT REQUIRED; rely on corporate IdP policy |
| D18 | Trusted proxy | COMPANY INPUT REQUIRED if selected: product, ownership, headers, network/TLS contract |
| D19 | Staging identity | EXTERNAL DEPENDENCY: test tenant, registrations, personas |
| D20 | Break glass | COMPANY SECURITY/FINANCE INPUT REQUIRED; never bypass AIMS authority |
| D21 | Production local catalogue | RESOLVED: disabled/prohibited |
| D22 | Competition identity mechanism | RESOLVED: competition-only and isolated |

## Implementation sequence

1. Company IT/Security resolves IdP, protocol, edge, stable claim, hostnames, registration, MFA/logout/session policy, and owners.
2. Approve the identity contract and pre-provisioning/joiner-mover-leaver process with Finance.
3. Create staging registration, test users, DNS/TLS, secret injection, and production-like edge isolation.
4. Add forward-only provider/subject identity mapping schema and audited administration/import path.
5. Implement the selected OIDC/BFF or trusted-proxy validation boundary with complete startup validation.
6. Implement secure session, CSRF, exact CORS, logout, lifecycle, and safe auth telemetry.
7. Remove/reject raw client identity headers in staging/production and keep local/competition adapters explicitly environment-bound.
8. Run negative identity, proxy-bypass, lifecycle, persona, authorization, concurrency, and UAT regressions.
9. Perform AIMS-UX-001 if login/session/logout/401/403 UI changes, then security review before P2 exit.

## Readiness conclusion

The architecture decision phase can pass because the trust and authority boundaries, threats, safe target options, mapping strategy, and test plan are explicit.

P1 implementation is **BLOCKED — COMPANY / IT INPUT REQUIRED**. Missing inputs are the approved IdP, protocol and validation boundary, application registration, issuer/audience/claim samples, hostnames and trusted edge topology, staging tenant/personas, session lifetime/logout/MFA policy, and named ownership. Writing placeholder SSO code before those inputs would increase risk.
