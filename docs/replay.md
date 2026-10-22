# Replay, limits, and troubleshooting

ATC derives current coordination state by replaying eligible comments on the inspected current open issues in ascending comment ID order. An unedited first line must match the `/atc` grammar, and the author, ID, timestamp, and issue reference must pass validation. Bot comments, edited comments, and unrelated prose do not become coordination events.

ATC reads open issues in batches of 50 through a fixed read-only GraphQL query that also returns each issue's first 100 comments. An issue with more comments is read again through the REST issue comment endpoint, which supports `page` and `per_page` with at most 100 comments per page. See the [list issue comments API reference](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#list-issue-comments). ATC sorts the combined events by comment ID before replay. Requests run through the authenticated `gh api` command with explicit HTTP methods, as documented in the [GitHub CLI manual](https://cli.github.com/manual/gh_api). The GraphQL transport accepts only read queries with validated owner, name, cursor, and issue number variables, and refuses any document that mentions a mutation or subscription.

## Board activity and coverage

The board reads ordinary GitHub assignments and open pull requests alongside replayed ATC claims. No maintainer setup is needed. Its `observedAt` value records the run's evaluation time; GitHub can change between endpoint reads, so a board is not an atomic or continuously updated view.

ATC claims expose `since` and `lastActivity`; pull requests expose `createdAt` and `updatedAt`. These timestamps describe observed artifacts, not someone's current coding session or availability. A recent update can come from automation, and old activity does not establish abandonment. An issue with `state: "unknown"` has no confirmed open state in the returned coverage.

Agent presence is explicit and local. `atc start` and `atc pulse` record a session in the clone's `.git/atc/presence.json`, shared by all worktrees of that clone, and post nothing. A session is fresh for five minutes, and `land` removes it. The board shows these sessions only when it runs inside a clone of the selected repository. `summary.activeAgents` counts fresh working and reviewing sessions, so several sessions can belong to one contributor; blocked sessions are listed but excluded from that count. Presence is not part of the replay and never renews a claim. Earlier versions posted `/atc flight` comments; those no longer parse.

`fileOverlaps` counts shared paths between pull requests by different contributors. `areaOverlaps` identifies shared configured areas even when the changed paths differ. Help labels and unassigned issues provide routes to investigate; a potential pair, split, or review is not an accepted agreement.

Contributor references are local to a snapshot. They do not print GitHub account identifiers and can change on the next run. Open the numbered GitHub artifacts for context under your normal untrusted-source rules; do not infer persistent identities from the ordinal references.

Area references use explicit stable `areaIds` in the config. Preserve each ID and its meaning across edits, unlike snapshot-local contributor references. Missing area mappings make a named-area config incomplete; ATC suppresses area output and blocks writes until it is pinned. Existing named-area comments still replay, but the CLI emits numeric areas in output and new posts.

## What determines an answer

The replay depends on retained comments for the inspected current open issues, repository configuration, the current issue and pull request snapshot, the CLI version, and the evaluation time. Given the same inputs and rules, every machine calculates the same state. Machines with different read times or snapshots may differ, especially around expiry or simultaneous writes.

An issue's earliest valid claim wins. A later claim from someone else does not replace it. An existing claimant can renew without changing role or scope. Agreements to pair, split, take over, or review require a pending proposal and an authorized acceptance.

Claims normally expire after seven days without successful ATC activity from the claimant. Pull request updates do not renew claims, and rejected commands do not keep them active. Proposals normally expire after seven days. Repository config can change those durations.

Current closed issues have no claimable work, so their comments are outside the current replay. Comment edits and deletions change the inputs to future replays. ATC is a calculation over the current GitHub record, not an immutable event log or a historical archive.

## Bounded reads

ATC discovers up to 1,000 current open issues, 50 per request, together with their first 100 comments. Issues with more than 100 comments share a budget of 120 REST comment requests, including pagination probes, with at most 30 pages for one issue. A repository with 112 open issues and no long threads therefore needs three issue requests instead of one request per issue. Closed-issue history does not consume the comment budget. ATC does not use a rolling time window, because renewals and split agreements depend on earlier comments. Open pull request discovery reads up to 300 open pull requests. Exceeding a read limit makes coverage incomplete rather than establishing that no work overlaps.

The board reads up to 1,000 open issues and compares files for up to 200 open pull requests, with up to 300 changed files per pull request. It reads changed files for 50 pull requests per GraphQL request. A pull request with more than 100 changed files, a renamed or copied file, or a file list that fails validation is read again through the REST pull request files endpoint, which also supplies former paths. Additional issues or pull requests make board coverage incomplete. An empty overlap list then means no overlap was found in the inspected data, not that all work is clear.

Overlap compares the working tree and up to 10 of your open pull requests with up to 30 other contributors' open pull requests, with up to 300 files per pull request. Local changes include the diff from the merge base and untracked files, with both paths included for a local rename. Pull request renames include the former path when GitHub supplies one. Ignored files do not enter the local comparison. A pull request description is limited to 65,536 characters and 20 unique issue references; overflow makes discovery incomplete.

A complete read covers the retained history returned by GitHub. It cannot recover deleted comments. When long comment threads on inspected open issues exceed the shared comment budget, ATC refuses new coordination writes rather than reconstructing claims from an incomplete record.

`complete: false` means a required read stopped short or an overlap source could not be inspected. Check results return `advice: "incomplete"`; write commands return `outcome: "incomplete"` without posting. After posting, ATC confirms by rereading only the target issue and replaying its fresh events alongside the other issues' events from the snapshot taken before the post. A confirmed post remains `pending` if those reads fail or are incomplete, or if the issue is no longer open. Success requires two matching complete observations of the target issue events. This improves detection of inconsistent reads but is not an atomic reservation: matching stale responses can still miss an earlier comment, so contributors must recheck before consequential work and coordinate any later disagreement. A failed POST with an unknown outcome returns `posted: null` and `outcome: "uncertain"`; inspect GitHub before retrying, because ATC does not automatically repeat an ambiguous write. Do not interpret empty claims or overlaps as a clear result when coverage is incomplete.

The GitHub transport also caps a run at 500 requests and 30 seconds. Readers stop starting new pages when too little of that time is left, and a request cut off by the cap ends the read early instead of failing the command. Either way the result reports `timeLimit`, is incomplete, and blocks writes. The viewer gives its collector 20 seconds; a slow or failed collection becomes an explicit stale or disconnected state. Busy repositories may exceed these budgets, so incomplete coverage must remain visible.

The `limitations` list contains fixed reason enums:

| Limitation | Coverage gap |
| --- | --- |
| `inconsistentComments` | The fetched comments disagree with GitHub’s advertised count; retry before acting |
| `commentsLimit` | Issues with more than 100 comments exceed the shared REST read budget |
| `pullRequestsLimit` | More than 300 open pull requests exist |
| `openIssuesLimit` | More open issue entries exist than the board can inspect |
| `boardPullRequestsLimit` | More than 200 open pull requests need board file comparisons |
| `pullFilesLimit` | A pull request has more than 300 changed files |
| `myPullRequestsLimit` | More of your open pull requests exist than overlap can inspect |
| `otherPullRequestsLimit` | More other contributors' open pull requests exist than overlap can inspect |
| `workingTreeUnavailable` | The local working tree or comparison base could not be inspected |
| `invalidFiles` | A file source contained data that failed validation |
| `invalidPulls` | Pull request data failed validation or exceeded the description or issue-reference bounds |
| `contributorReferencesUnavailable` | A board record has no safe snapshot-local contributor reference |
| `pullFilesUnavailable` | A board pull request has no inspected file set |
| `configurationUnpinned` | Configured areas have no explicit stable numeric IDs |
| `timeLimit` | GitHub reads stopped at the 30 second cap; run again, and the changed-file cache makes the next run faster |

## Troubleshooting

| Result or symptom | Next step |
| --- | --- |
| A GitHub CLI request fails | Run `gh auth status`, confirm repository access, and check `--repo owner/name` |
| The board is older than the work you are considering | Rerun it, then check the selected issue before claiming |
| The board reports unknown issue state | Read the limitation reasons and inspect the numbered issue before acting |
| An opportunity suggests pair, split, or review | Investigate the issue and confirm an agreement through typed ATC commands |
| A contributor reference changes | References are snapshot-local; use the issue and pull request numbers for context |
| Repository discovery selects the wrong target | Pass `--repo owner/name` or set `ATC_REPO` |
| Invalid `.github/atc.json` | Compare the file with the [configuration bounds](configuration.md) and remove unknown fields |
| Unknown area | Read `atc status` and use one of its numeric area references |
| `claimTaken` after a free check | Another comment won the race; check again and propose an agreement |
| `pending` after posting | Run `atc status` again and confirm the claim or proposal before starting |
| A proposal is missing | Check whether it expired, was withdrawn, was decided, or lost its issue's claim |
| An old claim disappeared | Inspect expiry, edits, and deletions, then check before creating a new claim |
| `sharedClaim` | Keep the agreed scope or release and coordinate a new agreement |
| `splitLeavesNothing` | Propose fewer areas or use a takeover if all work should transfer |
| `splitUnavailable` | Propose areas held by the existing workers |
| `participantLimit` | Coordinate within the existing workers, offer review, or arrange a takeover |
| Overlap cannot inspect the working tree | Run inside the clone and pass an existing local ref with `--base` |
| Git cannot find the merge base | Fetch the intended base through your normal workflow, then rerun with `--base` |
| Overlap reports shared files | Review the referenced pull request and agree scope before pushing or opening another |
| A read exceeds its limit | Resolve the fixed coverage reason; do not bypass it by treating partial results as free |
| Contributors see different state | Compare CLI version, config, repository, evaluation time, and GitHub snapshots |

ATC returns fixed errors rather than printing raw GitHub or git output, because those tools can return untrusted text. Run the underlying diagnostic command yourself when needed, and avoid pasting private details into public coordination comments.
