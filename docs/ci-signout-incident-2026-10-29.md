# Post-merge sign-out failure

Main run [40905994582](https://github.com/a1flecke/fleck-home-hub/actions/runs/40905994582) failed in the rework browser journey after PR #9 merged. Its browser failure correctly failed the merge gate. The preceding [PR run](https://github.com/a1flecke/fleck-home-hub/actions/runs/40890421527) passed. PR head `e0b4167` and squash merge `495d204` have identical Git trees; the application, tests and workflow did not change between those revisions.

The captured trace records the final verification POST succeeding, followed by a Sign out click with no sign-out request. Earlier sign-outs returned 200. The dashboard rendered an enabled button with only a JavaScript click handler. Its HTML could therefore accept a click before hydration attached that handler. A no-JavaScript test deterministically reproduced the same inert sign-out behavior. The precise hydration timing of the original runner is an inference from the trace, not directly instrumented evidence.

Sign-out now uses a native POST form and server endpoint. The endpoint checks the configured origin, delegates revocation to Better Auth, forwards its cookie-clearing headers, and redirects only on success. The regression submits a chore with JavaScript disabled, signs out, checks the redirect, and checks that a separately retained session cookie has been revoked. It also rejects a forged origin. Sign-in was the only other JavaScript-only control found in the current routes; it already disables submission until hydration, and a regression now protects that behavior.

The original journeys also switched accounts without checking every mutation's result. They now assert the affected chore's state before navigating away. Repeated scenarios use distinct titles and record-scoped locators so persistent synthetic records do not make assertions ambiguous. Repetition exposed an unscoped locator in the new test and a fixed title in the existing authorization scenario; these were test-isolation defects rather than application failures. The paid-chore journey now checks balance changes instead of assuming an empty ledger. Injected identity failures also verify that sign-out cannot redirect as though it succeeded or expose internal errors when revocation fails.

PR CI ran the browser suite once, so a timing-sensitive bug could pass it. The deterministic regression now runs in the existing required browser job for both PR and main events. No sleeps, retries, timeout increases, or weakened checks are used. Repetition is additional evidence; the deterministic pre-hydration test is the lasting prevention. AGENTS.md adds this requirement for all agents through the existing shared-policy references. These instructions guide engineering; the browser regression provides executable enforcement.

Main remains on the failing revision until a fix is merged and the subsequent main run passes. A green fix-PR run alone does not establish green main or resolve the separate independent-review trust limitation.

## Validation evidence

- The original no-JavaScript regression reproduced the inert sign-out before the implementation changed.
- After the native-form fix, five repetitions each of rework and no-JavaScript sign-out passed (10/10).
- Full repository verification passed: 70 unit/integration tests, seven browser tests, lint, typecheck, build, policy/tool parity, workflow and secret scanning, and the high-severity dependency gate. The audit still reports one low and one moderate advisory.
- Three additional identity-failure tests passed.
- Expanding repetition to all chore scenarios stopped at the second authorization scenario because of its fixed-title locator. After correcting the title, all four scenarios passed three repetitions each (12/12). No retry or timeout relaxation was added.
