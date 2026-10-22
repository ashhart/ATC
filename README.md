# Agent Traffic Control

Run several coding agents on one repository without them redoing each other's work or editing the same lines.

ATC reads a GitHub repository and your local worktrees and shows who is working on what. It test-merges your changes against every overlapping pull request and every other local worktree, so a conflict shows up before anyone opens a PR. Agents can claim issues through short `/atc` comments. There is no bot, server, GitHub Action or database. Everything runs from the CLI with your own `gh` login.

```text
$ atc --repo acme/widgets
ATC · acme/widgets  observed 14:02 UTC
9 contributors · 41 open issues · 12 open PRs · 3 agents active here · 1 duplicate attempt

Agents on this machine
  #212 Router drops the trailing slash  working  just now
  #215 Parser rejects unicode  working  2m ago
  #219 Document router options  blocked  4m ago

Files several open PRs change
  src/router.js  3 open PRs: #224 you, #221 @dana, #198 @lee

Duplicate attempts
  #187 Retry on 502  2 PRs by different people: #190 @sam, #201 @kai

Ready to pick up
  #230 Add a timeout option  help wanted  atc check 230
```

## Try it

You need Node.js 22.16 or later, git 2.38 or later and the GitHub CLI (`gh auth login`). `atc doctor` checks all three.

```bash
npx atc-github --repo owner/name
```

Until the npm package is published, run it from a clone of [ashhart/ATC](https://github.com/ashhart/ATC): `npm link` inside the clone puts `atc` on your path.

Inside a clone, `npx atc-github` picks the repository on its own, using the upstream for a fork. A terminal gets the readable view above. Agents and pipes get strict JSON with `--json`.

## Several agents on your own repository

This is the case ATC handles best. Give each agent its own worktree, then:

- `atc overlap` snapshots your working tree and runs `git merge-tree` against each overlapping open PR and each other local worktree. It reports real conflicts and the files involved, not just shared paths.
- `atc who <file>` says which open PRs and which other worktrees also change a file. It's fast enough to run on every edit.
- `atc start <issue>`, `atc pulse <issue> <session> <state>` and `atc land <issue> <session>` record what each agent is doing in `.git/atc/`, shared by all worktrees of the clone. Nothing is posted to GitHub, and a check-in expires after five minutes.

## Inside Claude Code, Codex, Cursor and other agents

ATC ships as a Claude Code plugin. Its hooks run inside the agent's loop:

- At session start, the agent learns the repository is coordinated and gets a one-line board summary.
- After each file edit, the agent is told if another open PR or local worktree changes the same file.
- Before `gh pr create`, ATC runs the conflict check and blocks the command if the PR would conflict.

```bash
claude plugin marketplace add ashhart/ATC
```

```bash
claude plugin install atc@atc-github
```

`atc-mcp` is a local MCP server with the same commands as tools, for Cursor, Codex and any other MCP client. `atc init` writes an `AGENTS.md` pointer for Codex and a `.cursor/rules/atc.mdc` rule for Cursor. See [using ATC from agents](docs/agents.md).

## Coordinating on a shared repository

A maintainer opts in by running `atc init`. That adds `.github/atc.json`, the agent skill, an `AGENTS.md` pointer, a CONTRIBUTING section telling agents what to run, and the Cursor rule. ATC never posts to a repository without `.github/atc.json`, so on other projects it only reads.

```bash
atc check 42
atc claim 42
atc overlap
atc release 42
```

- `check` answers `free`, `yours`, `proposeInstead`, `takenOutside`, `notOpen` or `incomplete`. Start only on `free` or `yours`.
- An open pull request that says `Fixes #42` already counts as your claim. Opening a draft PR early is the simplest way to claim work, and it also gives the conflict check something to compare against.
- If someone holds a claim, offer to `pair`, `split` the configured areas, `review` or `takeover` with `atc propose`. The holder answers with `atc accept <id>` or `atc decline <id>`.
- For maintainers, the board lists duplicate attempts (several people's PRs for one issue) and claims that have gone quiet.

Claims are `/atc` comments that every copy of the CLI replays the same way. The earliest valid claim wins. Claims expire after seven days without activity. See [commands and outcomes](docs/commands.md) and [replay and limits](docs/replay.md).

## What ATC can't promise

- Each run is a snapshot. Activity can be stale. `complete: false` means some reads stopped short, and an empty list then means "unknown", not "clear". Run it again before acting.
- Someone can win the race between `check` and `claim`. ATC can't stop anyone from opening a duplicate PR. It can only make the duplicate visible.
- A clean `merge-tree` result means git found no textual conflict. The changes can still break each other.
- Suggestions on the board aren't consent from the people involved, and they don't authorize work.
- Issue, PR and comment text is untrusted. The readable view strips control characters and escape sequences before printing it. The JSON output carries no free text at all.

## The local viewer

```bash
npm run site
```

[The viewer](http://127.0.0.1:4318) runs on loopback, shows a demo or read-only snapshots of a repository, and has no write endpoint.

## Development

```bash
npm run check
npm run demo
npm link
```

`npm run check` runs the style rules and the tests. These cover hostile input, exact output schemas, deterministic replay, real git merges, the MCP server and the plugin hooks. `npm run demo` plays two runs of four scripted agents on the same backlog, first without ATC and then with it. See [the demo](docs/demo.md).

- [Commands and outcomes](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Replay, limits, and troubleshooting](docs/replay.md)
- [Using ATC from agents](docs/agents.md)
- [Local pilot and release checks](docs/local-pilot.md)
- [Agent contributor skill](skills/atc/SKILL.md)
- [Security and privacy](SECURITY.md)
