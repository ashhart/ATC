# PR review exchange

The optional `atc-exchange` companion gives agents a PR-scoped inbox for review,
build, test, benchmark and reproduction requests. Requests and responses name
the exact Git commit they concern. Evidence bytes live outside git and expire;
the bounded request, result, digest and acknowledgement records remain.
The companion cannot claim work, approve a GitHub review or merge a PR.

## Contract

One service serves one repository and one explicitly configured origin.
Maintainers opt in on the default branch with `.github/atc.json` and
`.github/atc-exchange.json`, containing exactly `version: 1`, `origin` and
`retentionHours`, an integer from 1 to 720. HTTPS is required except for an
explicit `http://127.0.0.1:<port>` origin during local development.

All routes start with `/api/exchange/v1`. JSON objects reject unknown keys.
Identifiers are 32 lowercase hexadecimal characters, digests and bearer secrets
are 64, commit hashes are 40, PR numbers are positive integers below one billion.
Timestamps are canonical UTC ISO strings. The service never returns logins,
account IDs, filenames, comment bodies, supplied error text or evidence text.

| Method and route | Input | Result |
| --- | --- | --- |
| POST `/sessions` | `{pull, comment, token}` | Session expiry |
| GET `/pulls/:pull` | Bearer secret | Current head and complete inbox |
| POST `/pulls/:pull/requests` | `{id, head, kind, evidence}` | Request identifier |
| POST `/pulls/:pull/requests/:id/results` | `{id, head, status, evidence}` | Result identifier |
| POST `/pulls/:pull/requests/:id/resolve` | `{result, decision}` | Acknowledgement |
| PUT `/pulls/:pull/evidence/:id/:head/:kind` | Octet-stream bytes | Digest, size and expiry |
| GET `/pulls/:pull/evidence/:id` | Bearer secret | Download-only octet stream |

Requests use `review`, `build`, `test`, `benchmark` or `reproduce`; responses use
`pass`, `fail`, `blocked` or `inconclusive`; evidence uses `log`, `trace` or
`report`. Only the requester may acknowledge a response with `accepted` or
`dismissed`. Acknowledgement is a record of that person's decision, never
GitHub approval. A changed head marks older records stale instead of carrying
their results forward. Each response must name the request's original head.

Authentication proves control of a GitHub account through one immutable typed
PR comment, `/atc exchange <proof>`. The proof hashes a random client secret
with the service origin, repository and PR. The client sends only the random
secret to the companion, never its GitHub token. Fork contributors need comment
access, not push access. The server verifies the comment through GitHub.
The proof can renew a session without another comment; deleting or editing it
revokes access on the next operation. Sessions last 24 hours.
Requests and responses include the numeric proof-comment ID, so a person can
inspect the GitHub author without putting account identities in JSON. Responses
flag `selfReview` when the requester and responder use the same GitHub account;
running multiple agents under one account does not establish independent review.
For private repositories, the server also checks the comment author's current
repository permission on every operation and fails closed if it cannot do so.

Explicit client-generated identifiers make retries idempotent; changing a
previously used identifier's payload is a conflict. Evidence is limited to
1 MiB per object. The server rejects new work on closed PRs but retains reads.
Missing or expired evidence is explicitly unavailable, never a passing check.

## Trust boundary

Raw evidence is an explicit exception confined to the optional companion's
octet-stream upload and download routes. It is untrusted data, never parsed as
instructions, rendered, executed, placed in ATC JSON or posted to GitHub.
Uploading requires an explicit file selection; downloading requires a new
output file. Review that file for private data before sharing it with everyone
who can join the PR exchange. A digest proves byte identity, not truth.
The operator and anyone with a valid PR session can read its uploaded evidence.

The core CLI, MCP server, hooks and local board keep their existing behavior.
They never consume temporary exchange content to calculate claims.

## Setup

Install the checkout with `npm install -g .`, or replace `atc-exchange` in these
examples with `node src/exchange/main.js` when running from this checkout.
The service needs Node.js 22.16 or later and an authenticated `gh` installation
that can read the selected repository. No npm runtime dependencies are needed.
The service account needs contents, pull request and metadata read access;
participants use their own `gh` login to post their proof comment.

Commit this policy on the repository's default branch, alongside `.github/atc.json`:

```json
{
  "version": 1,
  "origin": "https://exchange.example.org",
  "retentionHours": 168
}
```

Start one instance with a dedicated persistent storage directory outside any checkout:

```sh
atc-exchange serve --repo example/project --origin https://exchange.example.org --data /var/lib/atc-exchange/project --port 4319
```

Put your HTTPS reverse proxy in front of `127.0.0.1:4319`, forwarding
`/api/exchange/v1/` with the Authorization header and a 1 MiB request-body limit.
Keep access logs free of request bodies and Authorization headers. The service
does not add CORS access or serve uploaded files as web content. Configure your
process supervisor to restart it and retain its data directory. Deploying this
service does not publish the policy or enable exchange on any repository.

The service only binds loopback. Local development may explicitly use
`http://127.0.0.1:4319` for the policy and both command origins; production origins
must be HTTPS hostnames without paths, credentials, query strings or ports.
Changing the origin needs a policy update and a new store and client proof.

## Contributor and reviewer workflow

Run `atc-exchange id` once per new request, result or evidence object and retain
the returned identifier for retries. The IDs and commit below are illustrative;
use generated IDs and the PR's actual current head.

```sh
atc-exchange connect 42 --repo example/project --origin https://exchange.example.org
atc-exchange request 42 build --id 11111111111111111111111111111111 --head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --repo example/project --origin https://exchange.example.org
```

A second contributor connects from their own clone and account, then reads
the inbox; no push access is required. An agent polls `inbox` as part of its
review loop, and treats an empty inbox only as the current snapshot.

```sh
atc-exchange connect 42 --repo example/project --origin https://exchange.example.org
atc-exchange inbox 42 --repo example/project --origin https://exchange.example.org
atc-exchange upload 42 log --id 22222222222222222222222222222222 --head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --file build.log --repo example/project --origin https://exchange.example.org
atc-exchange respond 42 11111111111111111111111111111111 pass --id 33333333333333333333333333333333 --head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --evidence 22222222222222222222222222222222 --repo example/project --origin https://exchange.example.org
```

Requests also accept `--evidence` for context or reproduction reports. No agent
automatically downloads those files, follows instructions inside them or treats
a reported pass as independently verified. The upload digest is calculated
locally and checked against the service response; downloads verify the bytes
against the service's digest. A malicious operator can still lie about both.

The requester can inspect and acknowledge the response, then export the durable
record or a readable summary for the PR:

```sh
atc-exchange download 42 22222222222222222222222222222222 --output received-build.log --repo example/project --origin https://exchange.example.org
atc-exchange resolve 42 11111111111111111111111111111111 33333333333333333333333333333333 accepted --repo example/project --origin https://exchange.example.org
atc-exchange inbox 42 --text --repo example/project --origin https://exchange.example.org
atc-exchange export 42 --output review-receipt.json --repo example/project --origin https://exchange.example.org
atc-exchange export 42 --text --output review-summary.txt --repo example/project --origin https://exchange.example.org
```

Copy the reviewed summary into the PR through the project's normal review
process. The companion does not automatically publish prose or pretend an
acknowledgement is a GitHub review. JSON exports retain all result hashes and
timestamps, including expired evidence, and are suitable for a durable archive.

## Retention, failure and operation

Expiry denies downloads immediately. A sweep removes expired bytes every minute
and at startup, including unreferenced temporary upload files after a crash.
Stopping the service pauses physical deletion until the next start. This cannot
erase downloaded copies or an operator's backups; exclude the evidence directory
from long-lived backups if that is the intended retention policy. Metadata stays
in `state.json`, and server secrets are stored only as hashes. Protect this
directory because it also contains the GitHub account IDs used internally for
ownership checks. Client capability secrets stay under `.git/atc/exchange/`.

Each service has at most 500 live sessions, 1,000 requests, 100 requests per PR,
20 responses per request, 4,000 evidence metadata records, 256 live evidence
objects overall and 64 per PR. Metadata is deliberately not silently evicted.
Export records and plan store rotation before reaching those limits; retain the
old service data offline as an archive. Eight HTTP operations may run at once,
and the service limits all requests to 120 per minute. GitHub is consulted on
each operation, so authentication and policy failures stop dependent reads and
writes rather than serving potentially unauthorized cached content.

IDs cannot be reused with different content. Retry a timed-out mutation with
the same ID and payload, and inspect the inbox before taking dependent action.
Uploads do not refresh an existing object's expiry. `ATC_READ_ONLY=1` blocks
client writes and server mutations. A closed PR remains readable but refuses
new writes. No response includes upstream stderr, comment text or filenames.

A `proofUncertain` result means the client cannot establish whether GitHub
posted its proof; the next connect searches bounded comment history for that
same proof and never blindly posts another. If no proof can be found, inspect
the PR before removing that clone's exchange session file and connecting again.
The service uses an exclusive `lock` file; after an unclean stop, verify no
instance is still using the directory before removing the stale lock. Never run
two instances against the same store. A removed or corrupt store cannot recover
temporary bytes, so preserve durable receipts before rotating or deleting it.

## Verification

`npm run check` includes real local HTTP flows between two accounts, a GitHub
stand-in, persistence and expiry, hostile input, conflicting retries, private
permission revocation and CLI file handling. These do not post to real GitHub.
The GitHub response shapes follow the official [comment](https://docs.github.com/en/rest/issues/comments#get-an-issue-comment),
[pull request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request),
[contents](https://docs.github.com/en/rest/repos/contents#get-repository-content) and
[repository permission](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user)
contracts. Live GitHub authentication and an HTTPS deployment still require an
operator smoke test against an opted-in repository.

An optional Postman simulation is included for the GitHub dependency. Run
`postman simulation run postman/simulations/exchange/exchange.sim.yaml --port 4501 --no-history`,
then `node scripts/exchangeSimulation.js 4501`. The unavailable variant uses
`exchange-unavailable.sim.yaml` and `node scripts/exchangeSimulation.js 4501 unavailable`.
Postman is development tooling only and is not required by CI or the package.
The GitHub mock was written from those documented responses; a provider-owned
Postman mock was not discovered or downloaded.
