# Architecture

Fleck Home Hub is a modular monolith. Routes and Svelte components call server-side application logic; domain policies do not import presentation or database modules. Infrastructure provides SQLite, Better Auth and external integrations. Only create interfaces for real extension points. Calendar, chores, earnings ledger, notifications, meals/groceries, expenses and weather are future domains, not implemented services.

Identity uses Better Auth sessions and a `membership` row mapping a user to a household and role. Protected requests resolve the session server-side and check membership for the requested household. A missing session, membership, configuration or database denies access. The shared display currently renders synthetic data only; it has no financial information. Network access through Tailscale is not authorization.

A child's chore completion is a submission pending parent verification. A parent may verify or reject it. Pending rewards are not earned; eventual verification must atomically and idempotently produce exactly one financial credit. This invariant is documented for the future ledger and is not implemented yet.

Better Auth's Kysely schema migration is followed by the checked-in Drizzle household migration. Keep a verified backup before migrations. Authentication configuration and database files are local private state, never fixtures or repository files.
