# ADR 0001: Initial foundation

Status: provisional; validate on the target Mac and tailnet before production use.

- **SvelteKit and a PWA:** a responsive browser UI can serve phones and a shared display from one codebase; native macOS distribution is unnecessary for the initial slice. Offline synchronization is deferred.
- **Modular monolith:** domain boundaries preserve testability without distributed services, queues, or speculative interfaces.
- **SQLite and Drizzle:** a single host permits local transactions and simple backups. Better Auth owns its Kysely schema migration; the household schema uses a checked-in Drizzle migration. Back up and test restoration before updates.
- **Identity:** Better Auth handles passwords and sessions; application membership records enforce parent/kid and household authorization server-side. Signup is disabled in the server; local provisioning creates accounts.
- **Toolchain:** mise and committed cross-platform lockfiles pin Node, pnpm and security tools; frozen pnpm installs avoid a separate CI toolchain.
- **Agent governance:** shared guidance plus narrow hooks and policy checks supplement native permissions. The user's existing approval plugin is not replaced, and arbitrary wrappers are never trusted.
- **CI supply chain:** use minimal permissions, immutable action commits, locked tooling, security scans and an always-running fail-closed gate. Configure branch protection separately.
- **Private hosting:** bind the app to loopback and use Tailscale Serve for private HTTPS. Tailscale establishes reachability, not application permissions. No Funnel or router forwarding.
