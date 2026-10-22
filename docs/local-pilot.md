# Local pilot and release checks

This checkout prepares a local pilot. Automated tests and a functioning local website do not establish production readiness, live GitHub reliability, or support for every platform.

## Start locally

Use Node.js 22.16 or later, git, and an authenticated GitHub CLI. In a reviewed checkout at the agreed revision:

```bash
npm run check
npm link
atc --version
npm run site
```

Open [the local viewer](http://127.0.0.1:4318). Its fictional demo works offline and labels its data as a demo. Selecting a GitHub repository switches to read-only collection through the local GitHub CLI; the page accepts no token, account profile, or free-text coordination message.

The viewer binds to loopback and polls every 30 seconds, with an event stream for connected pages. Its collector uses `ATC_READ_ONLY=1`, and the server exposes no GitHub write endpoint. It displays validated snapshots and cannot claim work, approve proposals, or arbitrate an agreement. This is a local service, with no deployment or hosted coordination service implied.

## Inspect before any write phase

```bash
ATC_READ_ONLY=1 atc board --repo owner/name
ATC_READ_ONLY=1 atc check 42 --repo owner/name
atc claim 42 --repo owner/name --dry-run
```

Use a repository and issue the human has chosen for the pilot. Confirm `complete`, limitation reasons, the observed time, and current issue state. Configured areas need explicit stable `areaIds`; an unpinned config must stay incomplete rather than inventing a mapping.

Review the JSON boundary for numeric artifact IDs, local contributor references, numeric areas, canonical timestamps, booleans, and fixed enums. No repository name, account identity, title, description, path, signature, or mention should be copied into the result or a new coordination comment.

## Exercise coordination in an authorized pilot

When the human has authorized the write phase in a suitable test repository, use the normal claim, proposal, decision, renewal, overlap, and release commands. Reuse that authorization within its scope; the workflow does not require repeated permission prompts.

Have two contributors attempt the same claim and confirm that both observe the same winner. Exercise pair, split, review, decline, withdraw, and takeover decisions with separate GitHub identities. A shared worker must not alter another worker's scope; resolve that scope through release and a new agreement.

After a claim succeeds, record agent sessions from inside the clone. These commands are local and must not create any GitHub comment:

```bash
atc start 42
```

Keep the returned `session` and use it for explicit pulses and landing:

```bash
atc pulse 42 123456789012345 working
atc pulse 42 123456789012345 blocked
atc land 42 123456789012345
atc release 42 --repo owner/name
```

Replace the example session number with the value returned by `start`. Start a second session from another worktree of the same clone and check that `atc board` run in either worktree counts two fresh agents. Check that blocked sessions do not increase `activeAgents`, that an unrefreshed session disappears after five minutes, and that the issue's comment list is unchanged. A session check-in must not prolong its underlying claim.

Check the conflict path too. Change a line in your working tree that another contributor's open pull request also changes, then run `atc overlap --base <remote>/<default branch>` and confirm `conflict: "conflicts"`. Confirm that `git for-each-ref refs/atc/` is empty afterwards and that `git status` shows only your own change.

On a repository without `.github/atc.json`, confirm that `atc claim` returns `notEnabled` and that nothing is posted.

Stop a confirmation read after a known post and verify `pending`, then inspect the issue before continuing. An ambiguous POST must return `posted: null` and `uncertain` without automatic retry. Never retry blindly: GitHub may already have accepted the first comment.

## Release evidence still required

Record the tested revision, CLI and platform versions, fixed outcome enums, and pass or fail for each scenario. Keep private evidence outside the public project and do not paste account identities, credentials, or raw GitHub responses into reports.

A release needs a completed live GitHub pilot, race and eventual-consistency observations, rate-limit and request-budget checks on a busy repository, and validation on each supported operating system. Verify local viewer behavior on fresh, stale, disconnected, and incomplete snapshots and test its loopback, origin, host, and feed-validation boundaries.

Run `npm run check` after the final source changes. Review any package or deployment artifact separately before publication. A local test pass is evidence for that checkout and environment, not a claim that other platforms or live GitHub have passed.
