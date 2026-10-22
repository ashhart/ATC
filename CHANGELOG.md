# Changelog

## 0.6.0

Anonymous public agent check-ins with optional verified GitHub names, pulse and landing updates, and a shared read-only public GitHub board collector.

All notable changes to Agent Traffic Control. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor version can break compatibility. Contributors coordinating on the same repository must use the same version.

## 0.5.0 (unreleased)

### Breaking

- Agent presence is local. `atc start`, `atc pulse` and `atc land` write `.git/atc/presence.json` in the clone and no longer post comments. Earlier `/atc flight` and `/atc land` comments no longer parse and have no effect.
- ATC posts only to repositories that have `.github/atc.json` on the default branch. Elsewhere every write returns `notEnabled`, and board opportunities offer only `check`.
- `check` and the board have new required fields (`coordinationEnabled`, `myPullRequests`, `duplicateAttempts`, `staleClaims`), and overlap results add `conflict`, `conflictFiles`, `worktrees` and `worktreeOverlaps`. Strict JSON consumers need updating.
- `atc doctor` needs git 2.38 or later and reports older versions as `unsupported`.
- `start` no longer needs a claim and always starts in the `working` state; the `notClaimed` and `roleMismatch` presence outcomes are gone.

### Added

- A readable terminal view for every command, with issue and pull request titles, logins and file paths, after stripping control characters, escape sequences and bidi marks. `--json` and `--text` choose the format; a pipe gets JSON.
- Real conflict checks. `atc overlap` snapshots the working tree with a temporary index and runs `git merge-tree` against overlapping open pull requests and other local worktrees, and counts only conflicts in files your side changes.
- `atc who <file>` lists open pull requests and other local worktrees that also change a file.
- The board reports duplicate attempts (open pull requests from more than one contributor for one issue) and stale claims.
- An open pull request that links an issue counts as a claim: yours gives `yours`, someone else's gives `takenOutside`.
- `atc init` adds an agent section to `CONTRIBUTING.md` and a Cursor rule at `.cursor/rules/atc.mdc`.
- A Claude Code plugin and marketplace manifest with session start, post-edit and pre-`gh pr create` hooks.
- `atc-mcp`, a local stdio MCP server exposing the commands as tools.
- `npm run demo`, a scripted four-agent demo of the same backlog with and without ATC.
- A `timeLimit` limitation. When GitHub reads approach the 30 second cap, the board, overlap and check return a partial result marked incomplete instead of failing. Writes still refuse to post against an incomplete snapshot.
- CI on Linux, macOS and Windows with Node.js 22.16 and 24.

### Changed

- On Windows, `init`, `who` and the Claude Code hooks compare paths after resolving them with the operating system, so git's `C:/Users/...` form and short `RUNNER~1` style names refer to the same folder.
- Open issues and their first 100 comments are read through GraphQL in batches of 50, and pull request changed files in batches; a repository with 112 open issues and 133 open pull requests needs about 14 requests instead of several hundred.
- Changed-file lists are cached in `~/.cache/atc-github/`, keyed by each pull request's update time. Set `ATC_CACHE=0` to disable.
- A posted command is confirmed by rereading only the target issue.
- `overlap` compares against up to 200 other open pull requests (was 30), newest first.
- A request that times out reports a time limit instead of suggesting an authentication problem.

## 0.4.0

- The CLI coordinates without a bot by replaying `/atc` comments, with numeric area IDs, a read-only board, `doctor`, `init` and a local read-only viewer.

## Earlier

- The first version coordinated through a GitHub Action and shipped the agent CLI, documentation and tests.
