# ADR 0006: Bounded My Day and paginated chore and payment history

Status: accepted for review.

## Context

My Day originally loaded every chore, payout, recurring series and skip for the household. That made the page grow with years of activity, buried current work under completed records, and left old records reachable only if the whole collection fit in one response.

## Decision

My Day is a bounded overview. Full history lives on separate, authorized, paginated routes:

- `/chores/history` exposes `review`, `overdue`, `today`, `upcoming`, `later`, `rework` and `verified` views with stable ordering and 25 items per page.
- `/chores/series` owns recurring schedule creation, editing, pause/end and skip management. It loads 10 schedules per page and previews at most five skips and one next occurrence per schedule.
- `/earnings/[childId]` exposes verified balances, pending totals and recorded payments with 20 payments per page, including correction controls for parents.
- `/dashboard` renders at most 10 chores from each actionable view and the 10 most recently verified chores. It shows recent payments only; the full ledger remains on the payment history route.

The bounded reads share one visibility rule: household scope, child scope for a child session, skip exclusion, and the existing paused/ended unstarted-occurrence rule. Scopes are disjoint so a chore appears once on My Day:

| Scope | Meaning |
| --- | --- |
| `review` | Submitted work waiting for parent verification, regardless of due date |
| `overdue` | Incomplete work whose due date has passed |
| `today` | Incomplete work due today |
| `upcoming` | Incomplete work due tomorrow through seven days ahead |
| `later` | Incomplete work due after that horizon |
| `rework` | Work a parent returned with a reason |
| `verified` | Completed and verified work |

Every scope has an aggregate count, and each overview section links to its full paginated view when records exceed the preview. Counts and balances are aggregate SQL queries over all matching records; they are never derived from the displayed page. `later` prevents a far-future chore from becoming invisible. The child filter on history never widens a child session's audience; a parent filter is validated against the household.

## Invariants

1. Financial totals continue to come from the complete append-only ledger: earned credits, non-reversed payouts and their difference.
2. Pending rewards and pending counts are separate aggregates and do not contribute to owed money.
3. Verification and correction mutations remain in their existing transactional services. Pagination changes reads only.
4. Historical payout correction checks that the payout belongs to the child in the route before reversing it.
5. Routes set `cache-control: no-store`; child and cross-household access is rejected at the server boundary.

## Consequences

The page stays responsive with large households, but an operator must follow a link to see historical detail. Query plans depend on the covering indexes added in migration `0017_my_day_indexes`; removing them would degrade large-history reads even though correctness would remain. The recurring page is a new navigation stop for parents. Pagination is intentionally page-number based, not cursor based; records inserted between visits can shift later pages, so pages are deterministic for a single response, not a stable snapshot across requests.
