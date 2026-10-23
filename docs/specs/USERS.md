# Users

## Registration

- [x] The first user to register is automatically granted the **admin** role.
- [x] Subsequent users can be added by the admin and should not be able to register themselves.

## Request validation

- [x] A missing, empty or malformed request body on session (login), user creation, own-password change and admin user update answers 400 with a "Missing: ..." (or Fastify body-parse) error instead of a 500.

## Passwords and login

- [x] Passwords set or changed (user creation, own-password change, admin update) must be at least 8 characters; a shorter password answers 400 with `Invalid: Password (minimum 8 characters)` and nothing is written.
- [x] Existing shorter passwords remain valid for login (no forced reset): the policy is enforced on set/change only, never on login.
- [x] A login for an unknown username performs a bcrypt comparison against a fixed dummy hash, so a miss costs the same as a wrong password and response timing does not reveal which usernames exist.
- [x] Unknown and existing usernames both answer the generic 403 `Authentication Failed`; the failed-login rate limiter is unchanged.

## Calendar feed (ICS)

- [x] `GET /api/users/calendar.ics` returns an RFC 5545 ICS feed of the authenticated user's tasks that have a due date, as all-day events (due date → due date + 1 day).
- [x] The feed accepts the user's API key via the `x-api-key` header or, for calendar clients that cannot send custom headers, via the `?apiKey=` query parameter (scoped to this route only).
- [x] Project visibility is enforced: non-admin users only see tasks from projects they can see; admins see everything.
- [x] Done tasks stay in the feed for 30 days after their last update (same Done-window convention as the dashboard).
- [x] Each event's SUMMARY carries `Project path / Task title` (project hierarchy is encoded in the project name); the event UID is stable so calendar clients update events in place.
- [x] Settings → Profile has a "Calendar feed" section with the subscribe URL in https and webcal variants, copy buttons, and API key regeneration (regenerating invalidates previously subscribed URLs).

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-23_
