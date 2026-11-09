# OpenCode approval smoke test

Run this opt-in test from the Fleck Home Hub worktree whose hard policy you want to check. Use a disposable OS account or isolated machine for runtime validation. The fixture uses synthetic Git repositories and a verified plugin release, with a separate loopback server and state directory for each process. It evaluates permission requests through the API without running the proposed commands.

Download and verify the v0.5.1 plugin archive using the checksum and attestation from its [release](https://github.com/a1flecke/opencode-auto-approval/releases/tag/v0.5.1). Use the installed OpenCode 2.2.6 executable and pass absolute paths.

```sh
mise exec -- node scripts/opencode-approval-smoke.mjs /path/to/opencode /path/to/a1flecke-opencode-auto-approval-0.5.1.tgz
```

The test waits for the released plugin to register its permission hook. It checks that the repository's ordinary merge deny prevents review and that the native policy blocks an otherwise allowed merge request. OpenCode 2.2.6 can call the reviewer before returning the native deny when the ordinary rule allows the request. The test requires a final denial even after a synthetic reviewer recommends approval.

It checks trusted-script decisions against two linked worktrees using one session. It then exercises missing reviewer credentials, an HTTP error, malformed output, and a timeout. Pending requests must be visible only in their originating session and server. One process shuts down and removes its state while the other still has a pending request. Each invocation allocates its own fixture directories and loopback ports, so agents can run the command concurrently from separate worktrees.

Only synthetic inputs and sanitized decision codes are used. The result describes the supplied executable and plugin release in the synthetic configuration. The desktop service and its effective managed or user configuration require separate validation.
