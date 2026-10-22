# Repository configuration

ATC reads any repository without a config file, but it posts coordination comments only to a repository that has `.github/atc.json` on its default branch. The file is how maintainers opt in. Without it, every write returns `notEnabled`, `check` and the board report `coordinationEnabled: false`, and board opportunities offer only `check`. An empty object, `{}`, opts in with the default limits and no areas.

`atc init` creates missing starter config and skill files, adds a skill pointer to `AGENTS.md`, adds a "Coding agents and Agent Traffic Control" section to `CONTRIBUTING.md` (or `.github/CONTRIBUTING.md` when that exists), and writes a Cursor rule at `.cursor/rules/atc.mdc`. It never rewrites existing content; it only appends the missing section. Review the changes before committing them. `atc init --check` checks setup without writing.

```json
{
  "areas": {
    "core": ["src/core/"],
    "cli": ["src/cli/"],
    "docs": ["docs/", "README.md"],
    "tests": ["tests/"]
  },
  "areaIds": { "core": 2, "cli": 1, "docs": 3, "tests": 4 },
  "maxClaimsPerUser": 3,
  "maxPendingProposalsPerUser": 5,
  "idleDays": 7,
  "proposalDays": 7
}
```

## Fields and bounds

| Field | Default | Accepted values |
| --- | --- | --- |
| `areas` | `{}` | Up to 24 names, each mapped to 1 to 20 path prefixes |
| `areaIds` | `{}` | Exactly the configured area keys, each assigned a distinct integer from 1 to 24 |
| `maxClaimsPerUser` | `3` | Integer from 1 to 20 |
| `maxPendingProposalsPerUser` | `5` | Integer from 1 to 20 |
| `idleDays` | `7` | Integer from 1 to 90 |
| `proposalDays` | `7` | Integer from 1 to 30 |
| `presence` | local | `"git"` shares agent sessions through refs on the repository's remote |

Unknown fields and invalid values fail with a fixed configuration error. GitHub config content is bounded to 64 KiB. There is also a fixed maximum of 10 pending proposals per issue and 10 workers per issue. Per-user limits are CLI admission checks; they do not rewrite authoritative per-issue replay when another issue is absent from coverage.

An area name has 1 to 24 lowercase ASCII letters, digits, or single hyphens. It starts with a letter and ends with a letter or digit. Commands accept at most eight distinct configured areas.

Each path prefix has 1 to 200 ASCII letters, digits, underscores, periods, hyphens, or slashes, and starts with a letter, digit, underscore, period, or hyphen. Absolute paths, `.` or `..` path segments, and repeated slashes are invalid. A trailing slash selects files beneath that directory; a prefix without one matches that path and its descendants. One path may belong to several areas.

ATC uses the explicit `areaIds` mapping in comments and reports, never area labels or path prefixes. Keep each ID assigned to the same area when adding or renaming keys; do not reuse a number for a different scope. CLI arguments can use a displayed ID or a configured label supplied locally, which ATC resolves before posting.

A missing mapping is safe only when no areas are configured. Named areas without `areaIds` make coverage incomplete with `configurationUnpinned`; reports suppress area arrays and writes stop until the mapping is added. When migrating numeric comments from the earlier sorted-key format, assign the IDs that those comments already used, then keep them fixed.

## Sharing agent sessions

With `"presence": "git"`, `atc start`, `atc pulse` and `atc land` push this clone's live sessions to `refs/atc/presence/<random id>` on the clone's GitHub remote, and `atc board` and `atc who` fetch everyone's. The CLI reads this setting from the clone's checked-out `.github/atc.json` for check-ins and from the default branch for the board. Sharing needs push access. Shared sessions are anonymous: no login or name, and file paths only as salted hashes. See [security and privacy](../SECURITY.md) for the exact contents.

## Scope and timing

A new claim without areas covers the whole issue. A split proposal must name areas, and the accepting workers must retain some work after the split. `pair`, `takeover`, and `review` proposals take no area arguments. Review roles do not use a work-claim slot.

Renewal keeps the existing role and areas. `claim` without areas also preserves an existing worker's scope. Explicit areas can update a sole worker's claim; a differing scope on shared work returns `sharedClaim`, so release and coordinate again to change the agreement.

`idleDays` controls claim expiry after the claimant's last successful ATC activity. Pull request updates do not renew a claim. `proposalDays` controls pending proposal expiry. ATC reads retained comments for current open issues within its coverage budget so renewals and accepted agreements retain their original context.

Changing config changes how ATC interprets history. Review config changes with contributors, upgrade all participants together, and keep the CLI version pinned. Numeric area comments require version 0.3 or later; upgrade every participant before posting them. The former `windowDays` setting is no longer accepted.

## Local options

`--repo owner/name` selects the GitHub repository and takes precedence over `ATC_REPO`. With neither set, ATC asks the GitHub CLI for the current repository and selects the upstream for a fork.

Comments contain typed commands only. A nonempty `ATC_SIGNATURE` setting is rejected, and ATC adds no mentions or free-form text to comments.

`--base <ref>` selects the local git base for `overlap`. Refs use a bounded allowlist and cannot start with `-`, contain `..` or `@{`, or contain repeated slashes. Use a branch or ref that exists in your clone.

`ATC_READ_ONLY=1` prevents coordinating posts and local presence writes in a trusted launcher. The optional local viewer and the Claude Code hooks always enable it; it is a process policy rather than an operating-system sandbox.

`--json` forces structured output and `--text` forces the readable view. Without either, a terminal gets text and a pipe gets JSON.

The CLI caches each open pull request's changed-file list in `~/.cache/atc-github/` (or `$XDG_CACHE_HOME/atc-github/`), keyed by the pull request's last update time, so repeated boards only refetch pull requests that changed. Set `ATC_CACHE=0` to turn the cache off. The cache is validated on every read and is never posted.
