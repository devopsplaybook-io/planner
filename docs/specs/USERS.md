# Users

## Registration

- [x] The first user to register is automatically granted the **admin** role.
- [x] Subsequent users can be added by the admin and should not be able to register themselves.
- [x] Usernames are unique at the database level (unique index on `users.name`): a duplicate answers 409 `Username Already Exists`, also when two requests race between the pre-check and the insert (e.g. concurrent first-user bootstraps). Usernames stay case-sensitive. Duplicates written before the constraint are de-duplicated during the upgrade by renaming the newer rows to `<name>#<id>` (the oldest row keeps the name).

## Request validation

- [x] A missing, empty or malformed request body on session (login), user creation, own-password change and admin user update answers 400 with a "Missing: ..." (or Fastify body-parse) error instead of a 500.

## Passwords and login

- [x] Passwords set or changed (user creation, own-password change, admin update) must be at least 8 characters; a shorter password answers 400 with `Invalid: Password (minimum 8 characters)` and nothing is written.
- [x] Existing shorter passwords remain valid for login (no forced reset): the policy is enforced on set/change only, never on login.
- [x] A login for an unknown username performs a bcrypt comparison against a fixed dummy hash, so a miss costs the same as a wrong password and response timing does not reveal which usernames exist.
- [x] Unknown and existing usernames both answer the generic 403 `Authentication Failed`; the failed-login rate limiter is unchanged.

## Login with code

- [x] Planner implements the cross-device "login with a code" standard from `@devopsplaybook.io/common-utils` 2.12.0 (`docs/login-with-code.md`): the protocol routes come from the library and Planner supplies only the storage adapter (`LoginCodesStore` over `DbUtils`), the settings, the interactive-session resolver and the session minting.
- [x] The `users_login_codes` table is created by migration `init-0030` (SQLite and PostgreSQL) using the library reference DDL (TEXT columns, camelCase identifiers, unique request-token and code hashes, status/expiry index, no foreign key on the approver).
- [x] `GET /api/users/login-codes/capabilities` reports `enabled`, `available`, code length (8), rotation (30 s), grace (60 s), TTL (300 s), poll interval (2 s) and the step-up flag; every login-code response (including rate-limit rejections) carries `Cache-Control: no-store`, `Pragma: no-cache` and `Vary: Authorization`.
- [x] `POST /api/users/login-codes` creates a request and answers 201 with the request token, the 8-character base20 code and the code/request expiries; the code rotates every 30 seconds while polling, the previous code stays valid for the 60-second grace window, and the request expires after 300 seconds. `POST /poll` returns `pending` (optionally rotated code), `approved` (redeeming the session exactly once), `expired`, `cancelled` or `failed`; redeeming twice answers 409 `ALREADY_USED`.
- [x] The state machine is `pending → approved → consumed` plus `cancelled`/`expired`/`failed`, enforced with compare-and-set SQL: one approval wins, a consumed or approved request cannot be approved or cancelled again, and five code submissions exhaust the request (`attempts_exceeded`).
- [x] The request store is replica-safe without Redis: a single conditional INSERT enforces the instance-wide pending cap (default 100) and answers 429 when full, serialized by a `pg_advisory_xact_lock` on PostgreSQL; lazy cleanup during create removes rows older than 24 hours (bounded to 100 per call).
- [x] Preview and approve require an interactive JWT session: anonymous callers get 401 `UNAUTHENTICATED`, and API keys (including a request that carries both) get 403 `FORBIDDEN`. Preview reveals only the parsed device label, user agent and timestamps for a code that matches a live pending request, and it consumes one attempt; the approver's password is additionally required when `LOGIN_CODE_APPROVE_REQUIRE_PASSWORD` is enabled.
- [x] Redemption re-reads the approving user at poll time and issues a normal Planner JWT (`AuthGenerateJWT`, 30-day validity, current `tokenVersion`); a user deleted between approval and redemption fails the request closed (`approver_missing`).
- [x] Codes and request tokens are never stored or logged in plaintext: the database holds HMAC hashes keyed by `JWT_KEY` (rotating `JWT_KEY` invalidates outstanding requests), audit events contain only the request id, acting user, device label, reason and IP, and neither codes nor tokens appear in audit records or logs.
- [x] Rate limits are configurable (`LOGIN_CODE_RATE_LIMIT_CREATE_MAX` 10/60 s per IP, `LOGIN_CODE_RATE_LIMIT_POLL_MAX` 120/60 s per request token, `LOGIN_CODE_RATE_LIMIT_APPROVE_MAX` 10/60 s per IP for preview/approve/cancel) and reject with 429 `RATE_LIMITED`; the feature can be disabled with `LOGIN_CODE_ENABLED=false`, which the capabilities endpoint and the UI reflect.
- [x] The library store conformance suite (`registerLoginCodesStoreConformance`) runs against a real temporary SQLite database in `LoginCodesData.spec.ts`; `LoginCodesRoutes.spec.ts` pins the protocol behaviour (statuses, rotation grace, attempts, pending cap, rate limits, step-up, secret-free events).

## Calendar feed (ICS)

- [x] `GET /api/users/calendar.ics` returns an RFC 5545 ICS feed of the authenticated user's tasks that have a due date, as all-day events (due date → due date + 1 day).
- [x] The feed accepts the user's API key via the `x-api-key` header or, for calendar clients that cannot send custom headers, via the `?apiKey=` query parameter (scoped to this route only).
- [x] Project visibility is enforced: non-admin users only see tasks from projects they can see; admins see everything.
- [x] Done tasks stay in the feed for 30 days after their last update (same Done-window convention as the dashboard).
- [x] The feed is bounded to the 1000 tasks with the nearest due dates (ordered by due date): larger accounts receive a truncated feed instead of an unbounded response. The 30-day Done window still applies.
- [x] Each event's SUMMARY carries `Project path / Task title` (project hierarchy is encoded in the project name); the event UID is stable so calendar clients update events in place.
- [x] Settings → Profile has a "Calendar feed" section with the subscribe URL in https and webcal variants, copy buttons, and API key regeneration (regenerating invalidates previously subscribed URLs).

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-11-25_
