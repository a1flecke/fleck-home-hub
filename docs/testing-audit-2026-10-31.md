# Testing audit — 2026-10-31

Scope: chore transitions and authorization, recurring chores, payout accounting, calendar workflows, browser form recovery and shared agent guidance. This is a targeted review, not proof that every path is covered. All fixtures examined were synthetic.

## What already has useful evidence

- Chore domain tests exercise permitted transitions and selected invalid ones. SQLite integration tests cover parent/child authorization, rework, immutable earnings and competing approvals from independent processes.
- Payout integration tests cover partial payments, repeated requests, reversal, invalid amounts and competing payments against a real database. Browser workflows exercise payment and correction through parent and child sessions.
- Identity integration tests use Better Auth sessions and membership data; browser tests exercise SvelteKit action requests, anonymous and cross-origin rejection. Calendar tests cover date recurrence, cancellation, household isolation and upgrades from an earlier database.
- Browser workflows cover sign-in, chores, payouts, recurring chores, calendar and selected hydration and no-JavaScript behavior. CI passing establishes that those specific checks passed in that run; it does not establish independent review or future stability.

## Findings and changes

1. **Confirmed form-recovery defects.** A rejected one-off chore, recurring chore creation/edit, or payment correction could close its form and lose input. A stale payment form likewise lost details after another tab reduced the balance. Independent PRs #19, #20, #21 and #23 reproduce and address these cases; they are based on main and remain subject to review and integration. The failure was not in the core database rule: the browser/server action boundary had not been exercised for ordinary invalid input or stale state.
2. **Confirmed weak authorization assertion.** The child chore-creation browser test accepted any non-200 response, which alone did not prove the intended action failure. It now uses a valid assignee and checks the SvelteKit failure type and application status, then checks no chore appeared. Real authorization tests remain necessary; a unit test of a helper cannot replace them.
3. **Unit boundary coverage.** The transition unit tests omitted repeat submission while pending and operations after verification. Targeted cases now check those likely invalid interactions without multiplying browser journeys.
4. **Guidance gap.** Shared policy called for TDD and browser safeguards but did not explain the testing pyramid, which boundary belongs at which layer, or how to select tests. `AGENTS.md` now points all agents to practical testing and frontend guidance. Instructions and parity checks cannot themselves guarantee agent compliance or independent review.

## Remaining work and uncertainty

- Payday, time-zone and other dashboard forms also return generic failures without restoring submitted values. Their user-visible behavior has not all been reproduced in this audit; test realistic errors before deciding fixes. PR #23 addresses the reproduced stale-balance payment case, not every possible payment failure.
- Calendar documentation describes floating local times and leaves DST gaps and ambiguities unresolved. Existing recurrence tests check dates around DST, not whether an event's local time exists or occurs twice. Agree on product behavior and test those specific transitions before claiming DST correctness.
- The shared display and its refresh tests are in open PR #18 and were not on this audit branch. Review its integration and post-merge CI separately.
- Independent GitHub review protection and effective OpenCode approval policy remain unverified risks described in the existing security audit. A green workflow and the project policy checker do not prove either boundary.

No coverage percentage, green run or written rule proves the absence of defects. Keep future checks tied to concrete user or security risks and remove redundant cases when equivalent lower-level evidence suffices.
