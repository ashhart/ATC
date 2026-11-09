# Changelog

## 0.9.2

- Retain a confirmed worktree file plan when the final repository read is incomplete, so normal plan retries reuse its session.
- Keep incomplete coverage not ready and recheck ownership, scope, expiry and the base before edits or publication.
- Cover interrupted reads, earlier competing plans and later rejected conflicts without changing the exchange protocol.

## 0.9.1

- Fix catch-up on the Cloudflare exchange by allowing its bounded GitHub review and discussion reads through the restricted transport.
- Resolve the current base branch tip explicitly so an advanced base invalidates old receipts and handoffs even when GitHub's PR metadata still contains an older SHA.
- Exercise the actual Worker GitHub transport in the catch-up and acknowledgement regression, including rejected paths and pagination bounds.

## 0.9.0

- Repository help discovery with capability filters, explicit public visibility and expiring pickup reservations.
- Durable handoff packets, explicit recipient acceptance and metadata-only task inspection.
- Per-agent catch-up with acknowledged private cursors and GitHub review/dependency observations.
- Required-check matrices that distinguish reported, accepted, expired, stale and non-independent results.
- MCP tools for every exchange operation and an optional A2A 0.3.0 task-inspection adapter.
- Shared Node and Cloudflare HTTP handling, strict storage upgrades and unchanged legacy inbox shapes.

## 0.8.1

- Keep the public board dependency graph free of Node-only CLI imports for Worker and browser integrations.
- Keep pull requests that reference more than 20 issues in complete snapshots, so one long description cannot block unrelated checks and claims.
- Preserve every linked issue within the existing shared limit of 6,000 PR-to-issue references. Snapshots exceeding that budget still report incomplete coverage and refuse claims.

## 0.8.0

- Planned file fingerprints and one-hour cooperative edit plans, confirmed with deterministic comment replay across issues and sessions.
- `begin`, `plan` and `guard` workflows with worktree-bound tickets, area-scope checks and base revalidation before edits and publication.
- Pre-edit and pre-publication guards for supported Claude Code tools, plus matching MCP commands.
- Explicitly selected overlap scans for up to 50 PRs, complete-scope reporting and validated file caches keyed by head and base commits.
- Typed PR dependencies and deterministic landing advice, including cycles, missing work and abandoned prerequisites.
- Exchange version 2 receipts retain the tested base and reject acceptance of stale or unknown-base results while preserving legacy record reads.

## 0.7.0

Repository-enabled anonymous public check-ins on confirmed new claims and session starts, with explicit GitHub-name opt-in, a local-only override, private-repository refusal and matching MCP controls.

## Unreleased

- Experimental: agent sessions on other machines. It hasn't been tried on a real team yet, and the ref format or setting may change. A repository that adds `"presence": "git"` to `.github/atc.json` shares each clone's live sessions anonymously through `refs/atc/presence/<random id>` on its remote, pushed with `--force-with-lease`. Shared sessions carry no login, name or file name, only issue numbers, states, check-in times and salted hashes of changed paths. `atc board` shows other clones' sessions with `local: false` and no contributor, and `atc who` reports `agents` for other clones' sessions changing a file.
- Local presence is a commit under `refs/atc/presence/local`, updated with `git update-ref` compare-and-swap instead of a JSON file and lockfile.
- `atc land` deletes the session's `/atc presence` proof comment after the board accepts the landing, so finished public sessions leave no comment on the issue. The CLI first checks that the comment still holds that session's proof on the same issue, and a failed removal returns `publication: unavailable`.
- A public `start` or claim also deletes the proof comments and session files of up to five earlier sessions in the clone that expired without `land`, so abandoned sessions stop accumulating comments.
- The Claude Code edit hook mentions agents on other machines, and the pre-PR hook accepts overlap results with more than 330 rows.

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
