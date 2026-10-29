# Fleck Home Hub

A self-hosted household hub built with SvelteKit, SQLite and Better Auth. The initial shared display uses example data. Parent and child accounts have household-scoped server authorization; full household features are future work.

**Not production-ready yet.** Read [security](docs/security.md) and [deployment](docs/deployment.md) before using real data. Remote Tailscale access, iOS installation, reboot and sleep behavior require the documented manual validation.

## Development

Install [mise](https://mise.jdx.dev/getting-started.html), review `mise.toml`, and trust the project if prompted. Run `./scripts/bootstrap.sh`, then `mise run dev`. Node, pnpm and security tools are pinned in `mise.toml` and `mise.lock`; dependencies use `pnpm-lock.yaml`.

Use `mise run lint`, `mise run typecheck`, `mise run test`, `mise run build`, `mise run e2e`, and `mise run verify`. See [development](docs/development.md), [architecture](docs/architecture.md), [agent workflows](docs/agent-workflows.md), and [decisions](docs/adr/0001-foundation.md).
