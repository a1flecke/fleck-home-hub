# ADR 0007: Bounded display sharing choices

Status: accepted for review.

## Context

`/display/settings` rendered one share form for every non-cancelled calendar event in the household and for every chore ever shared through `display_chore`, which is never cleaned up. The page grew with the household's whole history. [ADR 0006](0006-bounded-my-day-history.md) bounds My Day the same way: a bounded overview plus paginated access to everything else.

## Decision

`displayChoices()` in `src/lib/server/display.ts` returns two lists for an active parent of the household:

- **Window**: what the display can show from today through seven days ahead, with each record's current state. Events are active series that can occur in the window and one-off events that start in it. Chores are due in the window, excluding skipped and paused unstarted recurring occurrences as the display projection does. A shared chore appears on the display on its due date.
- **Shared outside this window**: every other current selection (earlier, later, cancelled or skipped), newest first, 20 per page through `?sharedPage=`. A page past the end shows the last page. Each item can be removed.

The two lists are disjoint, so a record never has two forms. Unshared records outside the window are not listed. The display projection (`sharedProjection`) and `setDisplayVisibility` are unchanged; the share action still checks parent membership and household inside its write transaction. Forms carry both `household` and `sharedPage`.

## Consequences

The page's size depends on the window and on the number of current selections, not on unshared history. A parent cannot pre-share an event or chore more than a week ahead from this page; they can share it once it enters the window. Migration `0019_display_choice_indexes` adds household indexes for the sharing tables, `calendar_event` and chore due dates. Pagination is page-number based, so a change between visits can shift later pages. A long-running repeating series stays in the window list while it is active.
