# Family calendar

Household members can view events and the to-schedule inbox; only parents can create, edit, schedule, archive or cancel them. All requests require a Better Auth session and household membership. Calendar responses are not cached, and mutations require the configured origin. Participants and tentative owners must belong to the same household.

Events have a household-local date and either all-day status or a same-day start and end time, plus optional location, description and participants. Select weekdays to repeat an event; no selected weekdays means a one-off event. An optional end date bounds a series. Parents can cancel a single occurrence or the whole series; editing changes the series as a whole. A cancelled occurrence stays cancelled when the series is edited. Overlapping events are allowed.

The calendar screen offers Previous, Today and Next controls that move by one day, seven days or one calendar month according to the selected view. Today comes from the household's configured time zone, not the visitor's browser. Month navigation clamps the selected day to the last valid day of the destination month, and navigation works on year, leap-year and daylight-saving boundaries because dates remain local calendar values. The `date` and `view` query parameters stay in every navigation link and in the add, edit, cancel and inbox action URLs, so the selected range survives ordinary form submissions. A native GET form remains available for direct date jumps and view changes without JavaScript.

The day view is a single agenda. The week view groups occurrences under each weekday, including empty days. On wide screens the month view is a Sunday-first seven-day grid with a bounded preview of three occurrences per date and a `+N more` link; on phones the same month becomes a date-grouped agenda that shows every occurrence instead of a truncated grid. Occurrences sort by date, then all-day first within a date, then by start time, title and stable event identity. Month previews and date headings link to the day agenda, where parents find edit and cancel controls; children remain read-only. Layouts use native links and forms so they work before hydration and without JavaScript.

Both parent and child My Day dashboards show a **Coming up** card for the household-local today through the following six dates. It reuses the calendar service and its recurrence and cancellation rules, and projects only event ID, date, title, start and end time and all-day status; descriptions, locations and participants are not sent to the dashboard. Up to five occurrences appear grouped by date, with a `+N more` link and a full week-calendar link. Event links open the relevant day agenda. Parents also get a link to add an event on the calendar page; children remain read-only.

Dates and times are stored as local calendar values, not converted to UTC. Changing the household time zone changes the interpretation of future entries. A weekly event retains its wall-clock time across daylight-saving changes. There are no instant-based reminders, so ambiguous or nonexistent clock times during DST transitions are displayed as entered and are not resolved to an instant; avoid scheduling such times until explicit DST disambiguation is implemented. Events currently cannot cross midnight.

The inbox stores commitments without dates. A parent can edit or archive an item, or turn it into an event. Scheduling and marking the item scheduled happen in one SQLite transaction. The authenticated shared display can show events explicitly selected by a parent; see [display.md](display.md).

## Importing calendars (`.ics`)

Parents can open **Import calendar (.ics)** (`/calendar/import`) to upload a `.ics` file or paste iCalendar text (for example, school calendars, youth sports schedules, or emailed event invites). Imports are parent-only, served with `no-store`, and bounded to 256 KB and 100 `VEVENT` entries per import. The server never fetches remote calendar URLs or stores third-party credentials.

Previewing parses the RFC 5545 `VEVENT` subset without writing to the database:

- Line unfolding and text unescaping (`\\`, `\,`, `\;`, `\n`) are applied, and nested `VALARM` blocks are ignored.
- UTC timestamps, IANA `TZID`s, common U.S. Windows `TZID`s, and floating local timestamps are converted to the household's configured IANA time zone.
- `FREQ=DAILY` and `FREQ=WEEKLY` rules (with `INTERVAL=1`, optional `BYDAY`, `UNTIL`, or bounded `COUNT` up to 366 occurrences) map to the calendar's weekday recurrence model and require at least one valid occurrence.
- Multi-day all-day spans, midnight-spanning timed events, missing end times, unknown `TZID`s, `STATUS:CANCELLED`, `RECURRENCE-ID` overrides, `EXDATE`, and unsupported `RRULE`s are surfaced with warnings and default to **Skip** so parents can edit or omit them.
- Existing non-cancelled household events are matched by previously imported `UID` or normalized title, date, start time, and weekdays, and duplicates within the same file are flagged; matched rows default to **Skip** and existing events are never overwritten.

Confirming runs in one SQLite immediate transaction that rechecks active parent membership, validates active rows and participants, verifies duplicates under the writer lock (returning HTTP `409` with edits preserved if a matching event was added concurrently), and records a payload-hashed confirmation key in `calendar_import_batch` so retries are idempotent and mismatched key reuse is rejected. Imported events are private by default and stay off `/display` until a parent explicitly shares them.

Migration `0004_calendar` adds the calendar tables without changing authentication, chores or financial records. Migration `0027_calendar_import` adds `calendar_import_batch` and `calendar_import_item` without altering existing tables. Stop the service and verify a backup before migrating an existing database. `mise run test` and `mise run e2e` use synthetic databases; actual household and device validation (including iOS file-picker behavior) remain separate.
