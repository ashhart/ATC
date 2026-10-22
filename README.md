# Agent Traffic Control

![ATC, air traffic control for coding agents, with illuminated flight paths representing parallel work and an amber marker at an overlap.](.github/assets/atc-readme.png)

Air traffic control for coding agents. When several agents and people work on the same repository, ATC shows who is in flight, on which issue, touching which files. Nobody picks up work someone else is already doing, and nobody finds out at merge time that two branches rewrote the same lines.

```text
$ atc
ATC · acme/widgets  observed 14:02 UTC
9 contributors · 41 open issues · 12 open PRs · 2 agents active here · 1 duplicate attempt

Agents in flight on this machine
  #212 Router drops the trailing slash  working  just now
  #215 Parser rejects unicode  working  2m ago
  #219 Document router options  blocked  4m ago

In flight: who is working on what
  #221 Retry on 502 from the upstream  @dana claimed, PR #224 @dana draft
  #212 Router drops the trailing slash  you claimed, PR #226 you draft
  #208 Cache headers on static files  @lee claimed
  #187 Timeout option for fetch  PR #190 @sam, PR #201 @kai

Contested files: more than one open PR changes them
  src/router.js  3 open PRs: #226 you, #224 @dana, #198 @lee

Duplicate attempts
  #187 Timeout option for fetch  2 PRs by different people: #190 @sam, #201 @kai

Ready to pick up
  #230 Add a timeout option  help wanted  atc check 230
```

## Why

Run four agents on one backlog and two of them will pick the same "good first issue". Two more will edit `src/router.js` on separate branches, and the second pull request will conflict with the first. Nobody can see the others, so the work gets done twice and then untangled by hand.

ATC gives every agent, and every person, the same view of the airspace before they take off:

- **Who is working on what.** Claims, GitHub assignments, open pull requests that link an issue, and the agent sessions running on your machine, all on one board.
- **Whether an issue is taken.** `atc check 42` answers `free`, `yours`, claimed by someone else, or taken outside ATC. An agent starts only on `free` or `yours`.
- **Whether your change will collide.** `atc overlap` test-merges your working tree against every open pull request and every other local worktree that touches the same files, and names the files that will conflict.
- **Work being done twice.** The board lists issues that already have pull requests from more than one person.

There is no bot, server, GitHub Action or database. Everything runs from the CLI with your own `gh` login.

## What counts as "in flight"

| Signal | Who sees it | How it gets there |
| --- | --- | --- |
| An ATC claim | Everyone | `atc claim 42` posts a one-line `/atc claim` comment on the issue |
| A linked pull request | Everyone | Any open pull request, draft or not, whose description says `Fixes #42` |
| A GitHub assignee | Everyone | Ordinary issue assignment |
| An agent session | Every worktree of your clone | `atc start 42`, then `atc pulse` while it works and `atc land` when it stops |

Agent sessions stay on your machine in `.git/atc/`, so four agents in four worktrees of one clone see each other live, and nothing extra gets posted to GitHub. A session expires five minutes after its last check-in. Agents on other machines show up through their claims and draft pull requests. Opening a draft pull request early is the simplest way to tell everyone you've taken off.

## Try it

You need Node.js 22.16 or later, git 2.38 or later and the GitHub CLI (`gh auth login`). `atc doctor` checks all three.

```bash
npx atc-github --repo owner/name
```

Until the npm package is published, run it from a clone of this repository: `npm link` inside the clone puts `atc` on your path.

Inside a clone, `atc` picks the repository on its own, using the upstream for a fork. A terminal gets the readable board. Agents and scripts get strict JSON with `--json`.

## Before, during and after the work

```bash
atc check 42
atc claim 42
atc start 42
atc who src/router.js
atc overlap
atc land 42 <session>
atc release 42
```

1. **Before.** `atc check` tells you whether anyone is on the issue. If it's free, `atc claim` (or a draft pull request with `Fixes #42`) marks it as yours. If someone holds it, `atc propose 42 pair`, `split <areas>`, `review` or `takeover` offers to help instead, and the holder answers with `atc accept` or `atc decline`.
2. **During.** `atc start` registers the agent, and `atc pulse <issue> <session> working|reviewing|blocked` keeps it visible. `atc who <file>` says which open pull requests and which other local worktrees also change a file.
3. **Before the pull request.** `atc overlap` snapshots your changes without touching your index and runs `git merge-tree` against each overlapping pull request and worktree. It reports `conflicts`, `clean` or `unknown`, and lists the files.
4. **After.** `atc land` ends the session and `atc release` frees the issue. Claims expire after seven days without activity.

## Inside Claude Code, Codex, Cursor and other agents

The Claude Code plugin puts ATC into the agent's own loop, so nobody has to remember to run it:

- At session start, the agent learns what is in flight on the repository.
- After every file edit, it is told if another open pull request or another local worktree changes the same file.
- Before `gh pr create`, ATC runs the conflict check and blocks a pull request that would conflict.

```bash
claude plugin marketplace add ashhart/ATC
```

```bash
claude plugin install atc@atc-github
```

`atc-mcp` is a local MCP server with the same commands as tools, for Cursor, Codex and any other MCP client. `atc init` writes an `AGENTS.md` pointer for Codex and a `.cursor/rules/atc.mdc` rule for Cursor. See [using ATC from agents](docs/agents.md).

## Turning on claims for a repository

Anyone can read any repository's board. ATC only posts claims to a repository whose maintainers opted in by committing `.github/atc.json`. `atc init` adds that file, the agent skill, an `AGENTS.md` pointer, a CONTRIBUTING section telling agents what to run, and the Cursor rule. Elsewhere, write commands return `notEnabled` and post nothing.

The config can also split the code into numbered areas, so two agents can share one issue: one takes area 1, the other area 2. See [configuration](docs/configuration.md).

## What ATC can't promise

- Each run is a snapshot. `complete: false` means some reads stopped short, so an empty list means "unknown", not "clear". Run it again before acting.
- Someone can win the race between `check` and `claim`, and ATC can't stop anyone from opening a duplicate pull request. It makes the duplicate visible.
- A clean `merge-tree` result means git found no textual conflict. The changes can still break each other.
- Live agent sessions are visible only within one clone. Other machines show up through claims and pull requests.
- Issue, pull request and comment text is untrusted. The readable board strips control characters and escape sequences before printing it, and the JSON output carries no free text at all.

## See it work

```bash
npm run demo
```

Four scripted agents work the same backlog twice. Without ATC, two of them fix the same issue and another edits a file that someone else changed: 2 of 4 pull requests merge. With ATC, each agent checks and claims first, one agent's conflict is caught before it opens a pull request, and all 4 merge. See [the demo](docs/demo.md).

`npm run site` serves a local, read-only flight board at `http://127.0.0.1:4318`.

## Development

```bash
npm run check
```

The check runs the style rules and the tests: hostile input, exact output schemas, deterministic replay, real git merges, the MCP server and the plugin hooks. CI runs it on Linux, macOS and Windows with Node.js 22.16 and 24.

- [Commands and outcomes](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Replay, limits, and troubleshooting](docs/replay.md)
- [Using ATC from agents](docs/agents.md)
- [Local pilot and release checks](docs/local-pilot.md)
- [Agent contributor skill](skills/atc/SKILL.md)
- [Security and privacy](SECURITY.md)
- [Changelog](CHANGELOG.md)
