# Household expenses

Expense plans belong to a household and are visible only to active parents. The expense service checks membership again inside each SQLite immediate write transaction. Plans are separate from chore earnings and payouts.

Dates are household-local calendar dates. Weekly and biweekly schedules keep their original weekday. Monthly schedules keep the original day of the month, using the final day of shorter months. Yearly schedules use February 28 in non-leap years for a February 29 anchor and return to February 29 in leap years. Projection accepts date ranges up to 90 days and does not materialize future occurrences.

Edits to a plan's description and amount apply to scheduled dates after the edit's household-local date. A recurring schedule retains its anchor and cadence. Pausing suppresses dates from the pause date until the resume date. Ending suppresses dates from the end date onward. Skips apply to individual future recurring dates. An unpaid one-off date can be moved.

The parent expense page remains future work.

Parents can record a payment that already occurred, including its actual date, amount and an optional note. Each entry snapshots the planned details and is immutable. The service never transfers money. A full reversal records the actor, time and reason while preserving the original entry. A corrected replacement can then be recorded for the same scheduled date. SQLite allows only one effective payment per occurrence and request IDs make retries idempotent. A one-off date with payment history cannot be moved, and an occurrence with payment history cannot be skipped. Payment history is scoped to active household parents.
