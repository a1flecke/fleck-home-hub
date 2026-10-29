# Claude Code project guidance

Follow the shared policy in `AGENTS.md`. Keep native sandbox and permission checks enabled. Project hook checks are additional safeguards, not a complete shell security boundary. Delegate push verification to the actual Git pre-push hook; do not run the same suite twice.
