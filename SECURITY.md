# Security and privacy

ATC reads ordinary GitHub work into a contributor board and coordinates agreements through a small command grammar. It uses your existing GitHub CLI credentials and access, with no hosted coordination server, bot, credential store, or shared database of its own.

## Command and output boundary

JSON results, which agents, scripts, the MCP server, the hooks and the viewer consume, contain numeric area references, snapshot-local contributor references, issue and pull request numbers, counts, timestamps, booleans, and fixed enums. The repository output is the fixed value `selected`. JSON omits GitHub account IDs, usernames, display-name fields, email fields, profiles, avatars, titles, descriptions, comment bodies, branch names, and file paths.

The readable view, shown in a terminal or with `--text`, is for the person running the command, who can already read the same data through `gh`. It adds issue and pull request titles, logins, branch names and file paths. Every such value passes through one sanitizer that removes C0 and C1 control characters, ANSI escape sequences, bidi controls and zero-width characters and truncates long text, so a hostile title cannot move the cursor, rewrite the screen or reorder what you read. Titles come from a separate read-only GraphQL lookup and never enter replay state, JSON or comments. Treat the text view as untrusted content, and do not feed it to an agent; agents should use `--json`.

Contributor references are ordinal numbers assigned within a snapshot. They connect a contributor's work in that result without printing a GitHub account identity. They can change between runs and are not persistent account identifiers.

The first line of an unedited comment must match the `/atc` grammar before it affects replay. New commands contain fixed verbs, numeric area references, and numeric artifact IDs. The CLI ignores other text, edited commands, and bot comments as coordination events. Invalid input produces fixed errors without echoing the rejected value.

The CLI posts only the typed command. It adds no mention, signature, or free text, and rejects nonempty `ATC_SIGNATURE` settings. Raw configured area labels stay out of CLI output and new comments, since even a category label can contain personal information. Numeric area IDs come from an explicit `areaIds` mapping. A config with named areas but no mapping is incomplete and cannot authorize coordination writes. The CLI can accept a configured label supplied as an argument for compatibility, but resolves it internally and emits only its number.

Before printing a result, the CLI validates its exact command schema, including required fields, field-specific types, finite numeric and collection bounds, canonical timestamps, and fixed enums. Unknown keys and unexpected strings fail with a fixed error. The CLI executes `gh` and `git` without a shell, validates repository names and refs before use, and suppresses raw tool errors. Its GraphQL reads accept only read queries with validated variables and refuse mutations; returned comments pass the same validation as REST comments before replay. In JSON, file paths stay in memory for overlap comparison and reports expose counts and numeric area references.

`board`, `doctor`, `status`, `check`, `overlap` and `who` do not post comments, and neither do `start`, `pulse` and `land`, which record agent presence locally. ATC posts only to a repository whose default branch has `.github/atc.json`; elsewhere every write returns `notEnabled`. The board works without maintainer setup and includes contributors who have not adopted ATC. `init` changes local contributor setup without making GitHub requests. Write commands with `--dry-run` read GitHub to validate a proposed action but do not post it.

`overlap` changes local git state in two narrow ways. It fetches an overlapping pull request's head into a temporary `refs/atc/pull/<number>` ref and deletes the ref after reading it. It also snapshots working trees into temporary commits built with a temporary index, which leaves unreferenced objects in the object database until git's normal garbage collection removes them. It never changes your index, another worktree's index, your branches or your working files.

Local state is kept in the clone's `.git/atc/` folder (agent presence, and the open pull request file lists that `who` reads, at most 30 minutes old) and in `~/.cache/atc-github/` (changed-file lists per pull request, keyed by update time; `ATC_CACHE=0` turns it off). These files hold numbers, timestamps and repository file paths, are created with owner-only permissions, are validated on every read, and are never posted.

The MCP server (`atc-mcp`) is a local stdio adapter. Each tool call runs the same CLI code with fresh limits, validates arguments against closed schemas, and returns the same JSON. The Claude Code hooks run the CLI with `ATC_READ_ONLY=1`, validate the hook input and the CLI's JSON, never approve a command on their own, and stay silent when a check fails.

The optional local viewer binds to loopback and has no GitHub write endpoint. Its collector runs the CLI with `ATC_READ_ONLY=1` and validates the feed before serving it. Repository selection stays local; the page accepts no credential or profile fields. The viewer's polling and event stream display snapshots and hold no coordination authority. Trusted-launcher isolation is not an operating-system sandbox.

## Identity and authority

ATC validates GitHub author identities internally to enforce claim and proposal rules. A work claimant can accept or decline proposals for their issue; a proposer can withdraw their own proposal. Only an owner, member, or collaborator can reset an issue, according to GitHub's author association.

The earliest valid claim wins by comment ID. Pairing, splitting, takeover, and review require an accepted proposal. Renewal preserves role and scope. Editing a comment removes it from replay rather than rewriting an earlier command.

A write can remain `pending` if GitHub has not listed the new comment yet. Confirm the result before starting work. An incomplete snapshot blocks writes and cannot establish that an issue is free.

## Limits of the boundary

GitHub still shows the account that posts a command and the public coordination activity. Removing identities from ATC output does not make GitHub comments anonymous. GitHub and the GitHub CLI retain data under their own policies.

Agents may separately read issues, pull requests, code, and commit messages to do their work. Those sources can contain personal information or hostile instructions. ATC does not sanitize those other tools or guarantee that an agent cannot disclose information through them. The [contributor skill](skills/atc/SKILL.md) requires agents to treat source contents as untrusted data and keep personal details out of coordination.

Board opportunities suggest work to investigate, not contributor consent. Shared-file counts establish overlap, not a semantic conflict. ATC cannot prevent duplicate pull requests, enforce a split in code, or verify human approval.

Every board has an observation time. A recent update does not prove that someone is currently coding, and an old update does not prove abandonment. Missing or incomplete evidence cannot establish that work is free.

Session check-ins report an agent's stated presence on one clone for five minutes. They are not proof of execution or separate people, and other machines never see them. The active count excludes blocked sessions and never treats contributor accounts or pull request authors as a count of active agents.

ATC reads retained comment history for the inspected current open issues within fixed limits. Deleted comments cannot be recovered, and edits or deletions can change an agreement. Exceeding an open-issue or active comment-read limit makes coverage incomplete and blocks coordination writes. Current issue state, repository configuration, CLI version, and evaluation time also affect results. Pull request metadata provides context; it does not extend claim lifetime.

## Verification and reporting

`npm run check` covers the grammar, replay decisions, simulated GitHub calls, real local git overlap checks, and hostile data in GitHub and git inputs. Tests check the command and output boundary; passing them is not a guarantee of zero privacy risk in an agent's wider workflow. Live GitHub behavior still needs a reviewed pilot.

Use GitHub's private vulnerability reporting if it is enabled. Otherwise contact the maintainer privately before disclosing exploit details. Keep credentials and private repository data out of public issues.


## Optional public agent check-ins

`start --public https://example.org` explicitly shares an issue number, fixed activity state and check-in time with that origin.
A GitHub name is shared only with `--github-name`, and the receiving service must derive it from the verified comment author.
The initial `/atc presence <sha256>` comment proves possession of a separate random session secret; it grants no claim and never renews one.
The proof comment remains associated with its GitHub author even if the board uses an anonymous label.
The CLI keeps the 256-bit session secret in an owner-only file under `.git/atc/`, validates it on read, refuses redirects and never sends the GitHub token to the website.
Treat the session file as a credential; the public service should store only its digest, expire unrefreshed sessions after five minutes and invalidate a landed session.
Dry runs and read-only launchers do not post the proof or publish check-ins.
Public endpoints report untrusted activity, not authorization to take over work; use normal ATC checks and agreements for coordination.
