# Fleck Home Hub

A self-hosted household hub built with SvelteKit, SQLite and Better Auth. Families can manage chores, groceries, dinner plans, calendars, and a paired family display. Payment records do not transfer money.

**Not production-ready yet.** Read [security](docs/security.md) and [deployment](docs/deployment.md) before using real data. Remote Tailscale access, iOS installation, reboot and sleep behavior require the documented manual validation.

## Set up a family

On a new installation, open the hub and choose **Set up our family**. Pick a family name and time zone, create your parent account, and enter the one-time setup code provided by the host operator. You can invite another parent, add children without email addresses, and try an activity or go straight to the dashboard. If you stop partway through, sign in again and choose **Continue family setup**.

On a supported Apple-silicon Mac with mise installed and Tailscale connected, run `mise run setup` from a trusted checkout. It prepares the installation and prints the private HTTPS address and one-time setup code. See the [deployment guide](docs/deployment.md) for prerequisites and hosting details.

## Development

Install [mise](https://mise.jdx.dev/getting-started.html), review `mise.toml`, and trust the project if prompted. Run `./scripts/bootstrap.sh`, then `mise run dev`. Node, pnpm and security tools are pinned in `mise.toml` and `mise.lock`; dependencies use `pnpm-lock.yaml`.

Use `mise run lint`, `mise run typecheck`, `mise run test`, `mise run build`, `mise run e2e`, and `mise run verify`. See [development](docs/development.md), [architecture](docs/architecture.md), [agent workflows](docs/agent-workflows.md), and [decisions](docs/adr/0001-foundation.md).
