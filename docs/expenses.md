# Household expenses

Expense plans belong to a household and are visible only to active parents. The expense service checks membership again inside each SQLite immediate write transaction. Plans are separate from chore earnings and payouts.

Dates are household-local calendar dates. Weekly and biweekly schedules keep their original weekday. Monthly schedules keep the original day of the month, using the final day of shorter months. Yearly schedules use February 28 in non-leap years for a February 29 anchor and return to February 29 in leap years. Projection accepts date ranges up to 90 days and does not materialize future occurrences.

Edits to a plan's description and amount apply to scheduled dates after the edit's household-local date. A recurring schedule retains its anchor and cadence. Pausing suppresses dates from the pause date until the resume date. Ending suppresses dates from the end date onward. Skips apply to individual future recurring dates. An unpaid one-off date can be moved.

This planning service does not yet provide the parent page or recorded payments. The payment implementation must preserve planned snapshots and prevent date changes or skips that would change payment history.
