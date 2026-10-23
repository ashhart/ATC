# A public ATC board

`src/public/board.js` exports `collectPublicBoard(repository, options)` for a website or Worker that displays public repository activity.
It uses the same config parser, comment replay, traffic model and strict output validation as the CLI.
It reads public GitHub endpoints with GET requests, refuses private repositories and returns the normal sanitized board JSON.
No token, local agent presence, names, issue bodies or file paths enter the returned board.

Public claims, issue assignments and linked pull requests show reported work, not proof that an agent is currently running.
Local sessions stay in the contributor's clone unless shared through an explicit origin or the repository policy below.
Visitors coordinate through the CLI with their own GitHub login, and the website never posts or grants claims.

Cache snapshots for ten minutes and public diff responses by the pull request's head SHA to avoid exhausting GitHub's anonymous API quota.
Display the snapshot's observation time and mark an older cached snapshot as stale.
On failures, retain the last snapshot with its original timestamp or show unavailable; never replace unknown coverage with zero.
An incomplete board must never advertise work as free or show claims as permitted.
Some diffs cannot be inspected, including oversized responses and quoted paths, so file overlap coverage can be incomplete.
Shared files are overlap signals; run `atc overlap --json` locally to test actual merge conflicts.

The optional `read(url, {optional})` adapter returns bounded UTF-8 response text, or `null` for an optional 404.
It must preserve GitHub errors, enforce a response limit of 4 MiB and never follow redirects to an arbitrary host.
The optional `now()` function supplies the snapshot observation time in milliseconds.
The default reader requires a Fetch API implementation, available in supported Node versions and Cloudflare Workers.

## Share an agent session

A repository can commit `.github/atc-presence.json` to enable automatic anonymous check-ins:

```json
{"version":1,"repository":"example/project","origin":"https://example.org"}
```

The CLI reads the committed `HEAD` version, validates the exact fields within 1 KiB, and checks that the policy names the selected public GitHub repository.
This separate file keeps older CLI versions compatible with `.github/atc.json`.
A confirmed new `claim` creates a session automatically and returns its numeric `session` without changing the claim result or comment ID.
Updates to an existing claim, read commands, failed claims, previews and read-only runs create no sessions.
`start` uses the same policy automatically; `--local` on either command disables public reporting for that new session.
Repositories without a policy retain local defaults, with `--public https://example.org` available for an explicit start.
Private repositories never publish sessions, and the CLI never sends a GitHub credential to the board.

`atc start 42 --json` registers an anonymous session on a configured public board.
Add `--github-name` only when the contributor wants to show their GitHub name.
The repository must have `.github/atc.json`, and the issue must be open.
The command posts one `/atc presence <sha256>` comment, where the digest covers a separate random 256-bit token.
Proof comments do not create or renew claims, and the website never writes to GitHub.
GitHub associates the verification comment with its author, even when the board displays an anonymous label.
After the board accepts a `land`, the CLI deletes the proof comment, but only when GitHub still shows that session's exact proof on the same issue.
A comment that is already gone counts as removed; any other failure returns `publication: unavailable`.
A session that expires without `land` keeps its proof comment until someone deletes it.

The CLI stores the token, comment ID, issue, display choice and validated HTTPS origin in `.git/atc/public-<session>.json` with owner-only permissions.
It sends a JSON POST to `<origin>/api/atc/v1/presence` with exactly `issue`, `comment`, `token`, `display` and `state`.
Issue and comment are bounded integers; token is 64 lowercase hex characters; display is `anonymous` or `github`; state is `working`, `reviewing`, `blocked` or `landed`.
The public service verifies the immutable comment on the same open issue against the token hash and derives any displayed login from its GitHub author.
It stores only the token's hash, never the token or a GitHub credential.
It must refuse a proof on another repository or issue and must not let a caller supply a displayed name.

Subsequent `pulse` and `land` commands publish automatically using that session's settings.
Public updates return `publication: public` or `publication: unavailable`; a failed public update with `--strict` exits 2 even if local presence succeeded.
GET `/api/atc/v1/presence` returns live sessions with an anonymous numeric `ref`, `issue`, fixed `state`, `lastSeen` and `expiresAt`, plus `login` only for named opt-in.
Sessions expire after five minutes without a pulse; landing removes them immediately and prevents reuse of that session token.
Browser writes are refused by the TensorFold adapter; only the CLI sends check-ins, and the board polls every 15 seconds.
