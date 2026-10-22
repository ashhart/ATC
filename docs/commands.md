# Commands and outcomes

Start with `atc board --repo owner/name` from any directory. The shorter `atc --repo owner/name` runs the same board. A local clone is needed for `overlap`, `who`, agent presence and the offline initializer; repository reads and typed coordination can use `--repo` without one. `atc help` and `atc --help` show usage. `atc --version` prints the CLI version without a GitHub request.

Results have two forms. With `--json`, or whenever standard output is not a terminal, ATC prints validated JSON that contains numeric area references, snapshot-local contributor references, issue and pull request numbers, counts, timestamps, booleans, and fixed enums. The repository output is the fixed value `selected`. In a terminal, or with `--text`, ATC prints a readable view of the same result that adds issue and pull request titles, logins and file paths for the person running the command, after stripping control characters, escape sequences and bidi marks. Agents and scripts should always use `--json`. Do not infer success from an empty list or the process exit code alone.

## Contributor board

`atc board --repo owner/name` reads a repository without posting, modifying local files, or requiring maintainer setup. `atc --repo owner/name` selects the same command. Without `--repo`, ATC uses `ATC_REPO` or discovers the repository from the current clone, selecting the upstream for a fork.

The board combines GitHub assignments and open pull requests with replayed ATC agreements. It includes contributors who have never posted an ATC command. Its JSON does not include titles, usernames, descriptions, labels outside its fixed vocabulary, or file names; open the reported issue and pull request numbers through your normal GitHub tools to understand their contents. The readable view adds titles, logins and the files that several open pull requests change.

| Field | Meaning |
| --- | --- |
| `repository` | The fixed value `selected`, without echoing the repository input |
| `observedAt` | The snapshot's evaluation time, as an ISO timestamp |
| `complete`, `limitations` | Whether required reads completed, with fixed reasons for gaps |
| `coordinationEnabled` | Whether the repository has `.github/atc.json`, which ATC requires before posting |
| `summary` | Counts of contributors, represented issues, open issues, open pull requests, file overlaps, opportunities, fresh active agent sessions, duplicate attempts and stale claims |
| `contributors` | Snapshot-local references, `mine` flags, and their work, review, assignments, and pull requests |
| `issues` | Numbered issues, observed state, help-label flags, assignees, ATC claims, and linked pull requests |
| `pullRequests` | Pull request numbers, local contributor references, `mine`, draft state, linked issues, areas, changed-file counts, and creation and update times |
| `fileOverlaps` | Pairs of pull requests from different contributors that share files, with counts and areas |
| `areaOverlaps` | Pairs of pull requests from different contributors touching the same configured areas |
| `opportunities` | Numbered issues with a fixed reason, signal, and possible next actions |
| `sessions` | Fresh agent sessions: this clone's, plus everyone's shared through git when the repository sets `"presence": "git"`. Each has a contributor reference, issue, state, last check-in, expiry, and `local`, which is `true` for sessions on this clone |
| `proposals` | Pending typed collaboration proposals by ID, issue, kind, and numeric areas |
| `duplicateAttempts` | Open issues that open pull requests from more than one contributor link, with those pull request numbers |
| `staleClaims` | Work claims with no ATC activity for half the idle window and no linked open pull request from the claimant, with last activity and expiry |

Contributor `id` values are ordinal references within this snapshot, not GitHub account IDs. They can change on the next run and must not be used to track an account across runs. An assignee or claim identifies its contributor in `contributor`; claims also expose `role`, `areas`, `since`, and `lastActivity`. A claim may cover the whole issue without named areas. A reported issue `state: "unknown"` is not evidence that the issue is open or free.

An unavailable contributor reference is `null`. A pull request's `changedFiles` is `null` when ATC has no inspected file set for it; this differs from a checked set with zero files. Read `limitations` before interpreting empty area or overlap arrays. Pull request `createdAt` and `updatedAt` describe GitHub artifacts, not a contributor's current availability.

`fileOverlaps` compares actual file paths in memory. `areaOverlaps` is a broader possible collision: two pull requests can touch different files within the same configured area. Neither report establishes that changes conflict or that contributors intend to work together.

Opportunity `reason` values are `helpWanted`, `goodFirstIssue`, `unassigned`, and `activeClaim`; `signal` is `request` or `candidate`. An action can be `check`, `claim`, `proposePair`, `proposeReview`, or `proposeSplit`. Run the issue check and read the numbered GitHub artifacts before acting; a suggested action does not authorize a write or replace an accepted agreement.

`helpWanted` uses `signal: "request"` because the issue has the project's help label; the other reasons are candidates. Incomplete boards keep their observed work and opportunities but limit opportunity actions to `check`.

Board reads have fixed limits, and an empty overlap list cannot establish clear coverage when `complete` is false. Run the board again when you need a fresh snapshot. See [replay and limits](replay.md) for coverage and activity rules.

## Area references

Area values in JSON are numbers from `1` to `24`, for example `areas: [1, 2]`. They use the explicit `areaIds` mapping in the repository config. Use the displayed numbers in commands, such as `atc check 42 1` or `atc propose 42 split 2`.

Keep each area ID and its meaning fixed across config edits; adding or renaming an area must not reassign an existing number. Changing prefixes can still change scope, so review config changes with contributors. A named-area config without `areaIds` reports `configurationUnpinned`; area output is empty and coordination writes stop until the mapping is pinned. Contributor references are different: they are local to each board snapshot and can change even when the config stays the same.

The CLI also accepts a configured area label supplied as an argument for compatibility, resolves it internally, and emits only the numeric reference. Legacy incoming comments with named areas still replay under the config; new comments use numbers only. Raw configured labels never appear in CLI results or new posted commands.

## Read commands

| Command | Purpose |
| --- | --- |
| `atc board [--repo owner/name]` | Inspect contributors, work, collisions, and ways to help without maintainer setup |
| `atc doctor` | Read setup and repository health without posting comments |
| `atc status` | List claims, proposals for you, your proposals, and renewals due |
| `atc check <issue> [areaNumbers...]` | Check issue availability and overlap with other claimed areas |
| `atc overlap [--base <ref>]` | Compare local changes and your open pull requests with others' open pull requests and other local worktrees, and test-merge each overlap |
| `atc who <file>` | List open pull requests and other local worktrees that also change a file in this clone |

`doctor` returns `ready` and individual `checks` for Node.js, git, the clone, the GitHub CLI, authentication, repository discovery, the local remote, and configuration. Check results use fixed enums instead of raw tool output. `git` is `unsupported` below version 2.38, which `overlap` needs for `git merge-tree --write-tree`.

`status` uses `mine` booleans rather than usernames. Proposal IDs are GitHub comment IDs; read them from `proposalsForMe` or `myProposals`. A claim's `role` is `work` or `review`, and its `areas` describe its scope.

| Check advice | Action |
| --- | --- |
| `free` | Claim, or open a draft pull request that links the issue, before starting work |
| `yours` | You hold the ATC claim, or one of your open pull requests links the issue (see `myPullRequests`). Confirm your scope, then continue |
| `proposeInstead` | Offer a split, pair, takeover, or review |
| `takenOutside` | Coordinate with the existing assignee or linked pull request |
| `notOpen` | Choose an open issue |
| `incomplete` | Resolve incomplete coverage before acting |

An open pull request that links an issue with `Fixes #<issue>` or another `#<issue>` reference counts as a claim: yours gives `yours`, someone else's gives `takenOutside`. An ATC claim held by someone else still comes first. `areaOverlaps` lists other claims touching the requested areas.

`overlap` reports shared file counts and numeric area references for each matching pull request. A source is either `workingTree` or one of your pull request numbers; it never contains a local path. For up to 10 overlaps, ATC fetches the other pull request's head from `refs/pull/<number>/head` into a temporary ref, snapshots your working tree into a temporary commit without touching your index, and runs `git merge-tree`. Each overlap has `conflict` (`conflicts`, `clean` or `unknown`) and `conflictFiles`, the number of conflicting files or `null`. `worktrees` counts the other worktrees of this clone, and `worktreeOverlaps` lists those that change the same files as you, numbered within the run, with the same conflict fields. Snapshots of other worktrees use a temporary index, so they never lock or change another agent's index.

`who <file>` takes a path inside the clone and returns `pullRequests`, the open pull requests by others that change it, `worktrees`, how many other local worktrees change it, and `agents`, how many agent sessions shared through git from other clones change it. Pull request file lists come from the last `board` or `overlap` run in this clone, at most 30 minutes old; without one, `who` reports `pullFilesUnavailable`. It makes no GitHub requests.

## Write commands

| Command | Effect |
| --- | --- |
| `atc claim <issue> [areaNumbers...]` | Claim an issue, or update your existing work claim |
| `atc renew <issue>` | Renew your claim while preserving its role and scope |
| `atc release <issue>` | Release your work or review claim |
| `atc propose <issue> split <areaNumbers...>` | Offer to take specific areas |
| `atc propose <issue> pair` | Offer to work with the current claimant |
| `atc propose <issue> takeover` | Request the existing work claims |
| `atc propose <issue> review` | Offer to review the work |
| `atc accept <id>` | Accept a proposal as a work claimant on that issue |
| `atc decline <id>` | Decline a proposal as a work claimant on that issue |
| `atc withdraw <id>` | Withdraw your own proposal |
| `atc start <issue>` | Record a working agent session on this machine and return its numeric session ID |
| `atc pulse <issue> <session> <state>` | Report `working`, `reviewing`, or `blocked` for your session on this machine |
| `atc land <issue> <session>` | Remove your session on this machine |

Use `--dry-run` with a write command to preview the typed action without posting. The result has `posted: false` and `outcome: "dryRun"`, plus structured area, kind, or proposal values where relevant. The preview exposes no account identity or free-text comment body. The preview checks the current snapshot; it does not reserve work or guarantee that a later write will succeed.

Write results distinguish `posted` from `outcome`. A posted comment can lose a race, fail a replay rule, or remain `pending` while GitHub catches up. Success requires two matching complete observations of the target issue events. Confirm the result before acting, and reread `status` if confirmation remains pending. An ambiguous POST returns `posted: null` and `outcome: "uncertain"`; ATC does not retry it automatically. ATC refuses to post against an incomplete snapshot.

`start`, `pulse` and `land` record sessions as a small commit under `refs/atc/presence/local` in the clone's shared git directory, updated with `git update-ref` compare-and-swap, so every worktree of the clone sees the same sessions and concurrent agents never overwrite each other. Each session records the files its worktree is changing. They return `posted: false`. When the checked-out `.github/atc.json` sets `"presence": "git"`, they also push your sessions to `refs/atc/presence/<login>` on the repository's remote with `--force-with-lease`, merging sessions from your other machines, and add `sharing: "git"`, or `sharing: "unavailable"` when the push failed, in which case local presence was still updated. `start` and `pulse` return `command: "flight"`; `land` returns `command: "land"`. Session IDs are positive canonical integers of at most 15 digits. Keep the ID returned by `start` for later calls; a preview does not reserve it. Each issue supports at most five fresh sessions on one clone, and a session belongs to the issue it started on. Sessions don't need or change a claim.

The board includes these sessions when it runs inside a clone of the selected repository. Board `summary.activeAgents` counts fresh `working` and `reviewing` sessions, rather than contributor accounts. `blocked` sessions remain visible but do not count as active. Sessions expose `active` and `expiresAt`; they expire after five minutes without a check-in. Presence does not extend claim lifetime, and the CLI does not keep sending pulses after it exits.

| Outcome | Meaning |
| --- | --- |
| `claimed` | A new work claim was accepted |
| `claimUpdated` | Your existing work claim was updated |
| `renewed` | Your existing claim was renewed without changing scope or role |
| `proposed` | A proposal entered the pending list |
| `accepted`, `declined`, `withdrawn` | The proposal decision took effect |
| `released` | Your claim was released |
| `dryRun` | The write was previewed without posting |
| `pending` | The comment was posted but has not been confirmed in a complete replay |
| `incomplete` | ATC cannot safely decide from the available snapshot |
| `claimTaken`, `takenOutside` | Another claim or outside work prevents a new claim |
| `notClaimable` | The target is not an open issue |
| `claimLimit`, `proposalLimit`, `proposerAtLimit` | A configured or fixed limit prevents the action |
| `participantLimit` | Pairing or splitting would exceed 10 workers on the issue |
| `sharedClaim` | An explicit scope change would alter shared work |
| `notClaimed`, `nothingToRelease`, `nothingToRenew` | The required existing claim is absent |
| `alreadyInvolved`, `proposalExists` | The proposed involvement is redundant |
| `proposalNotFound` | The proposal is absent, expired, or no longer pending |
| `notAuthorized` | The current user cannot make this decision |
| `splitLeavesNothing` | The split would leave an existing worker without areas |
| `splitUnavailable` | The proposed areas are outside the current workers' combined scope |
| `unknownArea`, `invalid` | Replay rejected a command or area |
| `reset` | A maintainer reset cleared the issue |
| `checkedIn` | A session check-in was accepted |
| `landed`, `nothingToLand` | The session was removed, or was already absent |
| `flightLimit` | The issue already has five fresh sessions on this clone |
| `configurationUnpinned` | Configured areas have no stable numeric ID mapping |
| `readOnly` | The launcher disabled coordination writes |
| `notEnabled` | The repository has no `.github/atc.json`, so ATC does not post there |
| `uncertain` | A POST may have succeeded, with `posted: null` and no confirmed comment ID; inspect before retrying |

## Local setup

`atc init` creates missing starter configuration and skill files, adds a skill pointer to `AGENTS.md`, adds an agent section to `CONTRIBUTING.md` (or `.github/CONTRIBUTING.md` when that exists), and writes the Cursor rule `.cursor/rules/atc.mdc`, all at the local repository root without contacting GitHub. It preserves existing files and only appends missing sections. `atc init --check` checks setup without writing. Review changes and commit them through your normal workflow.

The result reports `command: "init"`, `check`, and `config`, `skill`, `agents`, `contributing` and `cursor` file statuses. File statuses are `created`, `present`, or `planned`; `agents` and `contributing` can also be `updated`. The outcome is `initialized` after writes, `ready` when no changes are needed, or `changesNeeded` when check mode finds missing setup.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command returned an operational result, or strict checks passed |
| `1` | Invalid arguments, invalid data, or a failed git or GitHub operation |
| `2` | With `--strict`, incomplete coverage, overlap, coordination advice, an unsuccessful write outcome, an unready doctor, or setup changes needed |

For the board, strict mode requires complete coverage and no actual file overlaps; shared areas alone do not fail it. For a check, it permits `free` and `yours` only, and fails if requested areas overlap another contributor's claim. For overlap, it requires complete coverage, no pull request overlaps and no worktree overlaps. For writes, a refused or pending result fails strict mode. A dry run succeeds only when its current preconditions pass.

`--strict` is useful for agent scripts and local checks. It does not post a different comment or change replay rules. Inspect JSON even when the exit code is zero.

## Comment grammar

The CLI posts `/atc` commands as the first line of issue comments, using numeric area references where needed, for example `/atc claim 1 2`. Only unedited comments from GitHub user accounts count. Posted bodies contain only the typed command. Following text in a manually written comment has no replay meaning.

The verbs are `claim`, `renew`, `release`, `propose`, `accept`, `decline`, `withdraw`, and `reset`. A maintainer can post `/atc reset` directly on an issue to clear its claims and proposals; only GitHub's owner, member, and collaborator associations authorize it. Reset is not a CLI command.

Agent presence is local and posts nothing. Older `/atc flight` and `/atc land` comments no longer parse and have no effect. ATC posts only to repositories with `.github/atc.json`. Set `ATC_READ_ONLY=1` to disable coordination posts in a trusted launcher; `0` allows the normal explicitly invoked CLI workflow. This setting is a process policy, not an operating-system sandbox.

Never edit a command to alter an agreement. Post the next typed command, so its effect has a distinct comment ID.
