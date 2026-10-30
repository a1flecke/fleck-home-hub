# Family calendar

Household members can view events and the to-schedule inbox; only parents can create, edit, schedule, archive or cancel them. All requests require a Better Auth session and household membership. Calendar responses are not cached, and mutations require the configured origin. Participants and tentative owners must belong to the same household.

Events have a household-local date and either all-day status or a same-day start and end time, plus optional location, description and participants. Select weekdays to repeat an event; no selected weekdays means a one-off event. An optional end date bounds a series. Parents can cancel a single occurrence or the whole series; editing changes the series as a whole. A cancelled occurrence stays cancelled when the series is edited. Overlapping events are allowed.

Dates and times are stored as local calendar values, not converted to UTC. Changing the household time zone changes the interpretation of future entries. A weekly event retains its wall-clock time across daylight-saving changes. There are no instant-based reminders, so ambiguous or nonexistent clock times during DST transitions are displayed as entered and are not resolved to an instant; avoid scheduling such times until explicit DST disambiguation is implemented. Events currently cannot cross midnight.

The inbox stores commitments without dates. A parent can edit or archive an item, or turn it into an event. Scheduling and marking the item scheduled happen in one SQLite transaction. The authenticated shared display can show events explicitly selected by a parent; see [display.md](display.md).

Migration `0004_calendar` adds the calendar tables without changing authentication, chores or financial records. Stop the service and verify a backup before migrating an existing database. `mise run test` and `mise run e2e` use synthetic databases; actual household and device validation remain separate.
