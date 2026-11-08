# Tailscale Serve validation

Model: **Mac service bound to loopback → Tailscale Serve HTTPS → authenticated household browsers.** No Funnel, no router port forwarding, no unauthenticated household endpoints. Tailnet membership is network reachability, not application authorization: every route still requires a person's session or a paired display credential.

Commands below were checked against the official [`tailscale serve` reference](https://tailscale.com/docs/reference/tailscale-cli/serve) on 2026-11-08 (re-check before use; Tailscale changes). **None has been run by this project on the real host, and this repository never runs a command that changes Serve, Funnel or ACLs.** The Claude Code hook in this repository asks for approval before any `tailscale` command, which is intended.

## 1. Read-only inspection first

```bash
tailscale status
tailscale serve status
tailscale serve status --json > "$HOME/serve-before.json"
```

Look for existing Serve or Funnel entries that belong to other things; leave them alone. Save the "before" JSON privately so you can restore the earlier state by hand.

Evaluate a saved document without touching Tailscale:

```bash
mise run pilot-tailscale-check -- --origin https://<machine>.<tailnet>.ts.net --port 3000 --serve-json "$HOME/serve-before.json"
```

or let it run exactly the two read-only commands (`tailscale serve status --json`, `tailscale status --json`):

```bash
mise run pilot-tailscale-check -- --origin https://<machine>.<tailnet>.ts.net --port 3000 --run
```

It checks: no Funnel entry enabled; the route for the `AUTH_ORIGIN` host proxies **only** to `http://127.0.0.1:<port>`; other Serve routes and raw TCP forwards are flagged for your review; the node's MagicDNS name matches `AUTH_ORIGIN`; the backend is Running. The JSON field names (`Web`, `Handlers`, `Proxy`, `AllowFunnel`, `TCP`) follow Tailscale's serve config but are **not documented on the CLI page**, so confirm the checker agrees with your own `serve status --json` output. ACLs, sharing, device approval and who can reach the node are reported UNKNOWN/WARN: review them in the admin console.

## 2. Manually enabling the route (your decision, not scripted)

Only after the preflight shows no FAIL and the app is healthy on loopback:

1. Confirm the intended HTTPS origin and set `AUTH_ORIGIN` to it exactly (scheme + MagicDNS name, no path). Rebuild with it exported, because the origin is baked in at build time, then restart.
2. Expose the loopback port privately, as in the reference: `tailscale serve --bg 3000` (background; HTTPS on 443 is the default for a port target). Do **not** run `tailscale funnel`.
3. Re-run `tailscale serve status` and the checker above; compare with the "before" file.
4. To remove only this route later, repeat the same `serve` command with `off` appended and the same flags, per the reference; avoid `tailscale serve reset`, which clears everything including other people's routes.

## 3. Checks that need a real device (see the [pilot test plan](pilot-test-plan.md))

- A phone off your home network, on the tailnet, opens the HTTPS URL without a certificate warning.
- A device **not** on the tailnet cannot reach it.
- The sign-in page requires credentials; household pages redirect or return 401/403 anonymously.
- Cookies: the normal session cookie is Secure/HttpOnly; the display credential cookie is scoped to `/display` and a signed-in person cannot pair a screen without signing out. Inspect with Safari Web Inspector or a desktop browser's storage panel; compare names and scopes with [display](display.md).
- `mise run pilot-health -- --config-file … --probe-https` from the Mac reports the HTTPS origin answering, which proves only that the Mac reaches itself.
- Change the origin in `AUTH_ORIGIN` without rebuilding, and confirm the preflight `build-origin` check fails (guards the build-time origin mistake).
