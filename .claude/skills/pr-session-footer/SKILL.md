---
name: pr-session-footer
description: Append the agent harness session id (Claude Code, Codex) as the last line of a pull request body. Load this skill before you run gh pr create or gh pr edit --body, or write any PR description.
---

# PR session footer

Every PR body an agent writes or rewrites ends with the session id of the harness that wrote it:

```text
Claude Code session: 4f1c03f1-e404-4936-a8c9-50e19c734c0c
Codex session: 0199a213-81c0-7800-8aa1-bbab2a035a53
```

1. Write the full PR body, including any attribution lines, to a scratch file.
2. Pipe it through the script, which appends the footer as the last line:

   ```sh
   node .claude/skills/pr-session-footer/session-footer.mjs < body.md > body-final.md
   ```

3. Pass `body-final.md` to `gh pr create --body-file` or `gh pr edit --body-file`.

- Exit 0: `body-final.md` holds the body plus the footer. If that exact footer line is already in the body, the body comes back unchanged.
- Exit 1: no session id in the environment. Stderr names the env vars it checked. Do not invent an id or drop the step silently: tell the user the PR has no session footer and why.

## Harnesses

`HARNESSES` in `session-footer.mjs` maps each harness to the env var its shell commands inherit. First match wins.

| Harness | Env var |
|---|---|
| Claude Code | `CLAUDE_CODE_SESSION_ID` |
| Codex | `CODEX_THREAD_ID` |

To support another harness, add its label and env var to `HARNESSES`, to this table, and a case to `session-footer.test.mjs`.
