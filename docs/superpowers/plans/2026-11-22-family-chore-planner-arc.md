# Family Chore Planner and Management Implementation Plan

> **For agentic workers:** Use TDD for each behavior. Deliver four reviewable PRs in dependency order. State each PR's base branch and never treat a stacked PR as merged until its commits are verified on `main`.

**Goal:** Give a busy parent one phone-friendly place to see the coming week of chores for every child, correct or cancel unstarted work, revise a repeating schedule, and reuse existing chores for several children.

**Architecture:** Extend the existing `chore` and `recurring_series` domains and the existing `/chores`, `/verify`, and `/dashboard` routes. Reuse server-side parent authorization, the verification state machine, the one-credit constraint, bounded household-local date queries, and immediate SQLite transactions. Do not add a second task framework, notification system, or generic recurrence engine.

**Tech Stack:** SvelteKit 3, Svelte 5, better-sqlite3, Drizzle migrations, Vitest, Playwright.

**Baseline:** `origin/main` at `d7ac218` (includes #109 and #111).

---

## PR 1 — Weekly family chore board

**Base branch:** `main` (commit `d7ac218` at start)

**User outcome:** A parent opens `/chores/week` on a phone, sees seven household-local days grouped by child, filters by child or status, and adds a real one-off chore that appears on the correct day.

**Data changes:** None.

**Files:**
- Create `src/lib/chores/week.ts`: Sunday-based week start, seven dates, bounded shift, labels, date validation.
- Create `src/lib/server/chore-week.ts`: parent-only bounded board query, child/status filters, occurrence-aware rows; validates the child filter against active household members.
- Create `src/routes/chores/week/+page.server.ts`: load, week navigation, filters, quick-add action, validation recovery redirect to the created week.
- Create `src/routes/chores/week/+page.svelte`: week nav, direct date jump, filters, seven day sections with child subgroups, statuses, reward/repeat labels, links, empty state, quick-add form.
- Modify `src/routes/dashboard/+page.svelte`: add a parent navigation link to the weekly board.
- Create `tests/chore-week.test.ts`: pure week math and invalid dates.
- Create `tests/chore-week-board.integration.test.ts`: authorization, date bounds, grouping, recurrence vs one-off, skip/pause visibility, filters, cross-household isolation, duplicate generation.
- Create `e2e/chore-week.spec.ts`: mobile parent journey, child/anonymous authorization, no-JavaScript quick add, invalid recovery, delayed hydration of the quick-add form.
- Update `docs/chores.md` and `docs/architecture.md`.

**Rules:**
- Generate occurrences only for dates from `max(weekStart, today)` through `weekEnd`; never backfill a past week through the board.
- Read only the selected seven dates. Exclude skipped and paused/ended future unstarted occurrences through the existing `choreVisibility` rules.
- Quick add calls the existing `createChore`. Submission still never earns.
- Keep native links and forms usable without JavaScript; use `resolve()` with the full query string.

**Verification:** Focused unit/integration tests, lint, typecheck, the new browser journey, then the existing chores and verification journeys.

---

## PR 2 — Edit and cancel individual chores

**Base branch:** PR 1 branch (stacked); state this in the PR. Rebase onto `main` after PR 1 merges.

**User outcome:** A parent corrects an unstarted one-off chore's title, description, child, due date or reward, or cancels it after explicit confirmation. The board reflects the change; a child cannot submit cancelled work; earnings never change.

**Data changes:**
- Add a forward migration for cancellation metadata and edit audit rather than rebuilding the `chore` table: `cancelled_at`, `cancelled_by` columns on `chore`, and a bounded `chore_revision` audit table (chore, actor, timestamp, changed fields as JSON).
- Cancellation is an orthogonal lifecycle marker, not a new verification state. The existing status CHECK and state machine remain intact; all chore reads reject or hide cancelled rows, and `changeChore` rejects submission of cancelled work.
- Migration test must prove an existing verified chore earning survives unchanged and `foreign_key_check` stays clean.

**Files:**
- Create `drizzle/0020_chore_edit_cancel.sql` and journal entry; create `tests/chore-edit-migration.test.ts`.
- Modify `src/lib/chores/domain.ts` or add `src/lib/chores/edit.ts` for pure edit validation and cancelled-work rules.
- Modify `src/lib/server/chores.ts`: transactional `updateChore`, `cancelChore`; optimistic `updated_at` concurrency; active membership recheck under the writer lock; audit rows.
- Modify `src/lib/server/my-day.ts` and `src/lib/server/chore-week.ts` so cancelled rows do not appear in scopes or boards.
- Modify `src/routes/chores/week/+page.server.ts` and `+page.svelte`: edit/cancel actions scoped to one-off unstarted rows, confirmation, stale-conflict recovery, links to series management for occurrences.
- Add integration tests for edit, cancel, submitted/verified rejection, stale edits from two parents, child/anonymous/cross-household/disabled rejection, and rollback.
- Add a no-JavaScript and delayed-hydration browser journey, including an invalid edit recovery.
- Update `docs/chores.md`.

**Rules:**
- Only `todo`, uncancelled, non-recurring chores may be changed. Submitted, rework, verified and recurring occurrences are immutable here.
- Do not delete rows, transitions or earnings.
- A stale `updated_at` must fail rather than overwrite newer work.
- Cancelled rows create no earning and cannot transition.

---

## PR 3 — Edit recurring chore schedules

**Base branch:** PR 2 branch (stacked); rebase after earlier merges.

**User outcome:** A parent changes "Take out trash" from Monday/Wednesday to Tuesday/Thursday with an effective date, sees a readable old/new preview, and keeps completed work and earnings unchanged.

**Data changes:**
- Add a forward migration for append-only `recurring_schedule_revision` records: series, actor, effective date, old/new start/end/weekdays, created_at.
- Persist obsolete future unstarted occurrences as cancelled occurrences (using the PR 2 lifecycle marker) or an explicit series exception record; never delete history and never allow them to regenerate.
- Unique series/date occurrence key continues to guarantee one new occurrence per date.

**Files:**
- Modify `src/lib/chores/recurrence.ts` (or add pure helpers) for effective-date validation and schedule preview.
- Modify `src/lib/server/recurring.ts`: `reviseSeriesSchedule` inside one immediate transaction; preserve today's/historical/submitted/rework/verified occurrences; cancel only upcoming unstarted occurrences that no longer match; write revision audit; regenerate new dates exactly once.
- Modify `src/routes/chores/series/+page.server.ts` and `+page.svelte`: editable weekdays/end date, effective date defaulting to the next household-local day, preview of old/new pattern/first affected date/changed upcoming occurrences, explicit confirmation.
- Modify `/chores/week` to link an occurrence to its series.
- Add unit tests for previews and edge dates; integration tests for schedule change, same-day protection, skips/pauses/ended series/disabled members, stale/multi-parent edits, old-date non-revival, new-date single generation, and unchanged earnings.
- Add browser coverage for native and hydrated flows, invalid recovery, and mobile.

**Rules:**
- Preserve series identity and auditability.
- Today's occurrences keep their old values. Only future unstarted occurrences may change.
- Do not rewrite earned rewards, payouts, transitions or historical occurrences.

---

## PR 4 — Reuse and multi-assign chores

**Base branch:** PR 3 branch (stacked); rebase after earlier merges.

**User outcome:** A parent searches recent chores, chooses "Clean bedroom", selects three children and Saturday, reviews the full batch, and creates one independent to-do chore per child. Each child sees only their own work and earns only after verification.

**Data changes:**
- Add a forward migration for a batch/request key so retries and double-clicks cannot duplicate a batch. Individual chores remain ordinary `chore` rows.

**Files:**
- Create `src/lib/server/chore-reuse.ts`: bounded recent-chore search (deduplicated by title/description/reward, limited rows), batch preview, idempotent transactional creation.
- Create `src/routes/chores/reuse/+page.server.ts` and `+page.svelte`: search, empty state, source selection, multi-child selection, date, editable confirmation preview, success count.
- Link from `/chores/week` and the dashboard; return to the affected week.
- Add domain tests for batch validation, deduplication and idempotency; integration tests for all-or-nothing rollback, disabled assignee, cross-household source, stale retry, and separate rows with no copied transitions or earnings.
- Add full Playwright parent-to-child journey: parent assigns to multiple children, children see their own chores, one child submits, parent verifies, exactly one credit appears.
- Update `docs/chores.md`.

**Rules:**
- Copied chores start `todo` with no transitions and no earnings.
- Reject the whole batch if any assignee loses access or another prerequisite changes before commit.
- One submission-key style idempotency key per reviewed batch; repeated save returns the original result.

---

## Cross-PR verification checklist

- [ ] `mise run lint`
- [ ] `mise run typecheck`
- [ ] Focused Vitest files for each changed domain/query/migration
- [ ] `mise run test`
- [ ] Focused Playwright journeys, then `mise run e2e` for affected areas
- [ ] `mise exec -- pnpm audit --audit-level moderate`
- [ ] Review the full diff for unrelated changes
- [ ] Open PR with base branch, screenshots and evidence; do not merge without authorization
- [ ] After any merge, verify the feature commits are reachable from `origin/main` and inspect post-merge CI
