# Gemini / Antigravity project guidance

Follow the shared policy in `AGENTS.md`. Keep Antigravity's native terminal sandbox, file access policy, and approval controls enabled. The workspace hook in `.agents/hooks.json` is an additional safeguard, not a complete security boundary. Delegate push verification to the actual Git pre-push hook; do not run the same suite twice.

Do not read household databases, secret environment files, `hub.conf`, encrypted `.age` backups, private credentials, or unrelated private directories without explicit authorization. Do not modify global agent configuration (such as `~/.gemini/config/`, `~/.config/opencode/`, `~/.claude/`, or `~/.codex/`), deploy, change Tailscale settings, or perform destructive Git or filesystem operations without user approval.
