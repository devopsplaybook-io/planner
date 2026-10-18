# Users

## Registration

- [x] The first user to register is automatically granted the **admin** role.
- [x] Subsequent users can be added by the admin and should not be able to register themselves.

## Calendar feed (ICS)

- [x] `GET /api/users/calendar.ics` returns an RFC 5545 ICS feed of the authenticated user's tasks that have a due date, as all-day events (due date → due date + 1 day).
- [x] The feed accepts the user's API key via the `x-api-key` header or, for calendar clients that cannot send custom headers, via the `?apiKey=` query parameter (scoped to this route only).
- [x] Project visibility is enforced: non-admin users only see tasks from projects they can see; admins see everything.
- [x] Done tasks stay in the feed for 30 days after their last update (same Done-window convention as the dashboard).
- [x] Each event's SUMMARY carries `Project path / Task title` (project hierarchy is encoded in the project name); the event UID is stable so calendar clients update events in place.
- [x] Settings → Profile has a "Calendar feed" section with the subscribe URL in https and webcal variants, copy buttons, and API key regeneration (regenerating invalidates previously subscribed URLs).

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-17_
