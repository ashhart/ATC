# Coordinating parallel agents

ATC 0.8 adds planned files, work tickets, scoped overlap scans and PR dependencies.
Contributors must use the same pinned version and repository configuration.
All claims and edit plans still derive from validated GitHub comments; neither
the public viewer nor the exchange service can grant a claim or a merge.

## Start a task

Give concurrent agents separate clones or worktrees. Tickets bind to worktree
roots, so two processes editing the same worktree share its ticket and files.

After inspecting the board and status, name the issue and exact repository files
you intend to change:

```sh
atc begin 42 src/router.js tests/router.test.js --json
```

`begin` checks prerequisites and complete claim coverage, confirms your claim,
starts an agent session when needed and posts a typed edit plan before creating
a worktree-bound ticket. It never steals another claimant's issue or returns a
ready ticket for a pending or uncertain post. A dry run previews the workflow
without posting, starting presence or writing a ticket, and returns `ready: false`.

An existing open PR can establish that the work is yours; `begin` also creates
the explicit ATC work claim needed to anchor its plan. `plan` requires a claim
you already hold and never acquires an unclaimed issue.

Plans hold at most 32 distinct file fingerprints for one hour. They are
cooperative reservations, not GitHub file locks. The earliest valid overlapping
plan wins under deterministic replay, including when two sessions use the same
GitHub account. A later plan receives `scopeTaken` and must coordinate with the
existing session. Releasing the claim, closing the issue, changing its agreed
area scope, clearing the plan or reaching expiry releases the planned scope.

Only bounded salted fingerprints, a commit SHA and a numeric session are posted;
filenames stay local. Fingerprints use the selected repository as their salt so
shallow clones and forks targeting the same upstream compute the same values.
Hashes do not make predictable repository paths secret.

`begin` respects an existing area split. A scoped claimant cannot declare or
edit files outside its agreed areas, and symlink aliases, traversal and git
administrative paths are rejected. New files are allowed within the worktree.
The posted plan also binds a fingerprint of the ATC area policy and selected
comparison ref, so editing a local ticket cannot switch its base-check mode.

## Recheck before editing and publishing

```sh
atc guard src/router.js --json
atc guard --publish --json
```

An active ticket must still match an accepted plan, a live claim, the selected
repository, its planned files and comparison base. Changed files outside the
plan block readiness, even when a different planned file is being edited.
Publishing also runs the actual PR and worktree conflict checks; conflicts,
unknown merge results and incomplete coverage block an active ticket.

By default the base is read freshly from the selected GitHub repository's
default branch. If it changes, rebase or otherwise inspect the new work and run
`begin` again; a previous ticket cannot silently certify the new base.
An explicit `--base <ref>` on `begin` or `plan` instead selects a local comparison
ref, so its freshness is limited to the ref the operator supplied.

Refresh the same session's plan before expiry or before expanding its scope:

```sh
atc plan 42 src/router.js src/headers.js tests/router.test.js --json
```

Both commands honor `ATC_READ_ONLY=1`, and `--local` keeps newly created presence
on the machine. Stop presence with `atc land 42 SESSION --json` and release the
claim when stopping work. Do not keep pulsing idle agents.

The Claude Code plugin runs guards before Edit, Write, MultiEdit and NotebookEdit
and before explicit `git push` or `gh pr create/new/edit` commands. Active tickets
fail closed when the guard cannot run or validate its result. Without a ticket,
existing workflows and the original PR-create conflict gate remain available;
`guard` reports `noTicket`, not an inspected reservation.
Other clients can use the same CLI or MCP tools. Arbitrary shell aliases,
external tools and agents that ignore ATC are outside these hook guarantees.

## Scan a selected set of PRs

```sh
atc overlap --pulls 123,124,125 --json
```

This reads at most 50 explicitly selected PRs directly, avoiding global issue
and PR discovery. It compares the local working tree with those PRs and other
local worktrees, pins merge checks to the inspected commits and caches complete
file lists by repository, PR head and base SHA. Cache contents are validated on
every read; a changed head or base forces a fresh file inspection.

`coverage.requested` and `coverage.inspected` list the selected PR numbers;
`coverage.scope` is `selectedPullRequests`, and `repositoryComplete` is always
false. Here `complete: true` applies only to that selected scope. Missing PRs,
changed heads, truncated files and unavailable merge checks remain incomplete.
An uninspected PR is never inferred to be clear. This command does not bypass
the separate complete-history requirements for issuing claims or work plans.

## Describe prerequisites and landing order

```sh
atc depends 125 123 124 --json
atc landing 125 --json
```

`depends` posts `/atc depends 123 124` on PR 125. Only the PR author or a verified
maintainer can change that dependency list; the latest eligible unedited comment
wins. `atc depends 125 --json` clears the list. Closed or missing PRs, read-only
mode and repositories without `.github/atc.json` cannot accept the write.

`landing` inspects up to 64 reachable PRs and computes a deterministic order.
Cycles, abandoned prerequisites and missing coverage are explicit; merged
prerequisites are satisfied, while open prerequisites must land first. Its
readiness is dependency advice only. GitHub approvals, branch protections and
required CI remain the actual merge requirements; ATC does not merge anything.

## Bind review evidence to its tested base

The exchange's new client requests version 2 receipts. Both a request's head
and its base are retained, and responses must explicitly name the base that
was tested:

```sh
atc-exchange respond PR REQUEST pass --head HEAD_SHA --base TESTED_BASE_SHA --id RESULT --repo owner/name --origin https://example.org
```

The current PR head and base determine `freshness`: changing either makes the
receipt stale. Accepting stale or unknown-base evidence is refused, while
dismissal and historical inspection remain possible. A new request defaults
to the current base unless the caller explicitly selects one.

Legacy records stay readable and are marked `unknownBase` rather than inferred
to cover the current target. Old clients retain the exact version 1 inbox
shape through response negotiation. Existing disk and SQLite records upgrade
without destructive migration; after writing new base fields, an old server
binary cannot read those records, so retain exports and backups before any
server downgrade. Temporary evidence still expires independently of receipts.
