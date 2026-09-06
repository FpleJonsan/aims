# P13.2 Corporate Authentication Transaction State

Migration `060_p13_corporate_auth_transactions` adds the provider-neutral,
pre-authentication persistence prerequisite for a future corporate OAuth/OIDC
adapter. It does not implement login routes, select an identity provider, or
create authenticated AIMS identity or business authority.

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

The shared local `aims` database is intentionally not migrated by this work.
Migration and privilege proofs use disposable `aims_test_*` databases only.
