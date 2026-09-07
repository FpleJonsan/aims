# P13.2 Corporate Authentication Transaction State

Migration `060_p13_corporate_auth_transactions` and the P13.2 application
boundary provide provider-neutral corporate login initiation, callback,
verified `(issuer, subject)` mapping, and fresh opaque AIMS session creation.
No corporate identity provider is selected or configured, so protected
corporate login remains deliberately non-operational.

## Security classification and lifecycle

`corporate_auth_transactions` contains short-lived sensitive authentication
material. The browser receives a high-entropy opaque OAuth state; PostgreSQL
stores only its SHA-256 digest. The PKCE verifier remains recoverable because a
future server-side callback needs it for code exchange, so it is stored as
ephemeral plaintext protected by database access control. The nonce is stored
as a digest. No access token, refresh token, ID token, authorization code,
client secret, user identity, role, or generic metadata is stored.

The application creates a bounded transaction through
`create_corporate_auth_transaction`. Database time sets creation and expiry,
the maximum lifetime is 15 minutes, and the current recovery generation is
obtained inside the database. Return destinations are bounded relative AIMS
paths. Provider adapter and expected issuer fields are bounded but deliberately
vendor-neutral.

`consume_corporate_auth_transaction` performs one atomic conditional update.
It returns the callback material only when the state digest is present,
unconsumed, unexpired, and bound to the current recovery generation. A replay,
concurrent second consumer, expired transaction, or pre-recovery-generation
transaction returns no row. Cleanup is not required for correctness.

## Privileges and recovery

The table is owned by `aims_owner`; PUBLIC and every runtime have no raw table
access. `aims_app` receives only EXECUTE on the two fixed-search-path trusted
functions. Because established Finance and Payment executors inherit the
`aims_app` capability, each function also requires the exact login
`session_user` to be `aims_app`; specialist runtimes therefore fail closed.
No new LOGIN role is introduced.

Recovery-generation advancement remains unchanged and migrator-only. Old rows
may remain physically present, but generation mismatch makes them unusable.
Expired and consumed rows should be removed by a future approved operational
retention policy; no scheduler, worker, Redis dependency, or long-term audit
use is introduced here.

## Application trust boundary

Initiation generates high-entropy state, a PKCE S256 verifier/challenge, and a
nonce, then creates the transaction only through Migration 060. Callback
consumes it before code exchange and accepts only a cryptographically verified,
bounded identity from the configured adapter. Issuer and adapter must match the
server-bound transaction. Provider token material is neither persisted nor
propagated through AIMS.

Only an exact pre-provisioned mapping for adapter, issuer and subject can
establish a session, and the mapped AIMS user must be active. Email, provider
groups, roles, job title and department cannot create AIMS Finance authority.
Every success creates a fresh opaque AIMS session through the existing cookie,
recovery-generation, revocation and current-authority architecture. State is
durably consumed in a short transaction before provider I/O; a second short
generation-locked transaction rejects recovery-generation changes before
mapping and session insertion. Cookies are emitted only after commit. Corporate
session lifetime is a distinct bounded policy and must be explicit before a
protected adapter can operate.

The provider HTTP transport foundation requires a fixed server-configured HTTPS
destination, bounded timeout/body, cancellation, disabled redirects and
sanitized failures. The cryptographically signed deterministic adapter is
test-only and rejects staging and Production. Local identity remains
development/test-only; protected environments have no fallback.

## Open company inputs

The approved corporate IdP, Production and staging issuer/tenant, client
registration owner, callback domains, client authentication method,
MFA/conditional-access owner, allowed user population, logout policy, session
policy, and identity revocation/incident process remain unresolved. No vendor,
endpoint, secret or operational threshold is invented.

Migration 060 remains frozen and schema remains 60. No Migration 061, frontend,
financial logic, workflow, provider configuration, Redis state or second
session/state model is introduced.
