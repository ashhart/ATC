export const helpText = `Agent Traffic Control for GitHub

See who is working on what, and catch conflicting changes before they happen.

Start here
  atc [--repo owner/name]             the traffic board: work, collisions, duplicates, open issues
  atc overlap [--base <ref>]          test-merge your changes against open PRs and local worktrees
  atc who <file>                      which open PRs and local worktrees also change a file

Setup
  atc init [--check]                  add config, the agent skill, a CONTRIBUTING section and a Cursor rule
  atc doctor                          check runtime, clone, authentication and config
  atc --version                       print the CLI version without network access

Coordinate (writes need .github/atc.json in the repository)
  atc check <issue> [areas...]        is it free, yours, claimed, or taken outside ATC?
  atc claim <issue> [areas...]        claim an issue, or update your existing scope
  atc status                          your claims, offers for you and renewals due
  atc renew <issue>                   renew work or review without changing scope
  atc release <issue>                 release your work or review claim
  atc propose <issue> <kind> [areas]  kind is pair, split (with areas), takeover or review
  atc accept <id> | decline <id>      decide an offer on an issue you hold
  atc withdraw <id>                   withdraw your offer

Agents in flight on this machine (local only, nothing is posted)
  atc start <issue>                   start a session and print its number
  atc pulse <issue> <session> <state> check in as working, reviewing or blocked
  atc land <issue> <session>          end the session

Options
  --repo owner/name                   choose the repository, or set ATC_REPO
  --json                              structured output for agents and scripts
  --text                              readable output even when piped
  --dry-run                           preview a coordinating write without posting
  --strict                            exit 2 when coordination needs attention
  --help, -h                          show this help without network access

A terminal gets readable text with titles, names and paths; pipes and agents get validated JSON
with numbers and fixed words only. An open pull request that says "Fixes #<issue>" counts as a claim.
Comments contain typed /atc commands only. Exit codes: 0 result, 1 failure, 2 strict attention.
`;
