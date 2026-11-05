# Use ATC from your agent

ATC works from any agent that can run a command. The Claude Code plugin goes further: it puts ATC checks into the agent's own loop, so nobody has to remember to run them.

Every route below needs Node.js 22.16 or later available as `node`, git, and an authenticated GitHub CLI (`gh auth status`).

## The contributor skill

[skills/atc/SKILL.md](../skills/atc/SKILL.md) is the shared workflow for starting or
resuming issues, opening or updating PRs, reviewing other contributors' work and
handing off a session. It also explains the optional PR exchange when enabled.
Agents read the board and their status first, confirm issue ownership before
implementation and check conflicts before publishing PR changes.

For a newly adopting repository, `atc init` copies this skill and adds pointers in
`AGENTS.md`, the contribution guide and Cursor's always-applied rule. For an
existing adoption, keep its established skill path and project-specific rules:
compare its copy with the current skill and merge the relevant updates through
the repository's normal workflow. Running `atc init` or upgrading the CLI does
not overwrite an existing skill or instruction file.

Repositories using another path, such as `docs/atc/SKILL.md`, should point their
`AGENTS.md` at that file. The pointer should tell agents to read it before issue
implementation and PR work; the presence of `.github/atc.json` alone does not
ensure every agent will discover the skill.

## Claude Code plugin

This repository, [ashhart/ATC](https://github.com/ashhart/ATC), is a Claude Code plugin and a one-plugin marketplace:

```bash
claude plugin marketplace add ashhart/ATC
```

```bash
claude plugin install atc@atc-github
```

Inside a session, `/plugin marketplace add ashhart/ATC` and `/plugin install atc@atc-github` do the same. To use a local checkout, pass its path to `claude plugin marketplace add`. To try the plugin for one session without installing it, start Claude Code with `claude --plugin-dir /path/to/atc-github`.

The plugin adds four things:

- The ATC contributor skill from `skills/atc/SKILL.md`.
- A session start hook. In a clone with a GitHub remote, it tells Claude which ATC commands exist and summarizes the last board snapshot. It refreshes that snapshot in a detached background process at most every ten minutes, so the session never waits on GitHub. The snapshot keeps only counts and a timestamp, under the plugin's data directory.
- A hook after each file edit. It runs `atc who` on the edited file. When an open pull request or another local worktree also changes that file, Claude sees a note with the pull request numbers.
- A hook before `gh pr create`. It runs `atc overlap`. When ATC finds a merge conflict with an open pull request or another local worktree, the hook denies the command and tells Claude to coordinate or rebase first. When files are shared without a conflict, Claude gets a note and the command continues through the normal permission prompt. The hook never approves a command by itself.

The hooks run the CLI with `ATC_READ_ONLY=1`, so they never post to GitHub. When a check fails or times out, the hook lets the action continue and says that ATC could not check.

The plugin also registers the ATC MCP server from `src/mcp/server.js`.

ATC 0.8 adds a pre-edit work-ticket guard and rechecks active tickets before
explicit pushes and PR publication. Start with `atc begin ISSUE FILES --json`
to opt a worktree into those checks. The MCP server exposes the same `begin`,
`plan`, `guard`, scoped `overlap`, `depends` and `landing` commands; see
[parallel-agent workflows](workflows.md).

## Codex

Codex reads `AGENTS.md`. `atc init` adds a section there that points agents at `skills/atc/SKILL.md`, so Codex follows the same workflow as other contributors.

To give Codex the ATC tools over MCP, register the server:

```bash
codex mcp add atc -- node /path/to/atc-github/src/mcp/server.js
```

The same entry can live in `~/.codex/config.toml`:

```toml
[mcp_servers.atc]
command = "node"
args = ["/path/to/atc-github/src/mcp/server.js"]
```

## Cursor

Cursor reads project rules from `.mdc` files in `.cursor/rules/`. A rule that always applies keeps Cursor agents on the ATC workflow. `atc init` writes one at `.cursor/rules/atc.mdc` when it's missing. A minimal version looks like this:

```markdown
---
description: Coordinate issue work with Agent Traffic Control
alwaysApply: true
---

Before starting an issue or opening a pull request, follow skills/atc/SKILL.md.
```

Register the MCP server in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "atc": {
      "command": "node",
      "args": ["/path/to/atc-github/src/mcp/server.js"]
    }
  }
}
```

## Other MCP clients

The server speaks MCP over standard input and output. Configure a stdio server whose command is `node` and whose only argument is the absolute path to `src/mcp/server.js`. Start it from inside the repository clone you want to coordinate, because ATC reads the clone's git remotes and working tree.
