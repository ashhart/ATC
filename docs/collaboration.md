# Working together with ATC 0.9

The optional exchange now supports public help discovery, expiring pickup reservations,
durable handoff packets, per-agent catch-up and a requirements matrix. The same
operations work through the CLI, MCP and HTTP API. Core issue claims, file plans
and GitHub merge requirements keep their existing authority.

Upgrade the exchange server before its clients, back up its external data directory
or Durable Object storage, and use ATC 0.9.0 together. Old clients retain their
exact version 1 and version 2 inbox formats. Older servers cannot read collaboration
records after new clients write them; export records and retain a backup before
downgrading. No destructive migration runs.

## Pick up help

First connect to the PR using the repository's configured origin:

```sh
atc-exchange connect 42 --repo example/project --origin https://exchange.example.org
atc-exchange id
```

Keep a distinct generated consumer ID for each agent. Reuse it for that agent's
pickup, renewal, release and catch-up commands. It is an identifier, not a password;
authentication still uses the private session secret in the clone.

Create the ordinary review, build, test, benchmark or reproduction request, then
advertise what it needs. Replace the ID and full commit placeholders with values
returned by the CLI and GitHub:

```sh
atc-exchange request 42 test --id REQUEST_ID --head HEAD_SHA --base BASE_SHA --repo example/project --origin https://exchange.example.org
atc-exchange offer 42 REQUEST_ID --capability cuda --public --required --independent --repo example/project --origin https://exchange.example.org
```

Only the requester may change its offer. Changing a required check also needs
PR authorship or a freshly verified write/admin repository permission. Other
contributors can publish optional help requests. Every `offer` call replaces the four
settings: capability, public visibility, required check and independent contributor.
Omitting a boolean flag clears it. Public discovery requires explicit `--public`
and a currently public GitHub repository. Private offers remain in their PR.

```sh
atc-exchange help-queue 42 --capability cuda --repo example/project --origin https://exchange.example.org
atc-exchange take 42 REQUEST_ID --consumer CONSUMER_ID --seconds 1800 --repo example/project --origin https://exchange.example.org
atc-exchange help-release 42 REQUEST_ID --consumer CONSUMER_ID --repo example/project --origin https://exchange.example.org
```

Capabilities are `any`, `linux`, `macos`, `windows`, `cuda`, `metal`, `rocm`,
`vulkan`, `cpu`, `docs` and `security`. `any` shows all capabilities. These filters
describe requested work; they do not verify a volunteer's hardware or expertise.
Queue pages contain at most 50 records. Follow `next` using `--after` to inspect
the remaining pages. The authenticated queue includes public offers plus offers
in its authenticated PR; it does not expose other PRs' private requests.

A pickup lasts 60 to 3,600 seconds. Repeating `take` with the same GitHub proof
and consumer renews it. A different live holder returns `conflict`; after expiry
another contributor can take it. Independent requests reject a pickup by the
requester's GitHub account, including another agent using that account. Pickups
are cooperative reservations, not exclusive reply permissions: legacy clients
and unsolicited independent reviewers may still submit results. Release your
reservation when finished. A pickup never transfers an implementation claim.

Use the existing `respond` and `resolve` commands for results. A report is not
a GitHub approval, a hardware attestation or permission to run code from evidence.

## Required checks

```sh
atc-exchange matrix 42 --repo example/project --origin https://exchange.example.org
```

The matrix includes every offered request and durable handoff for that PR, plus
current pickup proof numbers and consumer IDs. These identifiers let participants
coordinate without exposing account names in output. Public queues omit them.
Requirements begin as available or running. A response without an accepted
resolution is reported. Only a requester-accepted passing receipt at the current
head and base qualifies a required check. Expired referenced evidence, stale
commits, rejected independence, blocked and inconclusive results do not qualify.
`qualified` requires at least one requirement and all required checks passing.
Optional requests do not block it. Qualification is an exchange summary, not
independent proof that tests ran and never GitHub merge readiness.

## Handoffs

Prepare a report containing the exact commit, completed work, remaining steps,
failed approaches, relevant issue links and acceptance criteria. Review the file
before sharing it. Upload that explicitly selected file as ordinary `report`
evidence. Ask the intended recipient for their exchange proof-comment number, returned by
`atc-exchange identity PR --repo owner/name --origin ORIGIN` after connection.

```sh
atc-exchange upload 42 report --id REPORT_ID --head HEAD_SHA --file ./handoff.md --repo example/project --origin https://exchange.example.org
atc-exchange handoff 42 40 --id HANDOFF_ID --recipient PROOF_COMMENT --report REPORT_ID --head HEAD_SHA --base BASE_SHA --repo example/project --origin https://exchange.example.org
atc-exchange handoff-export 42 HANDOFF_ID --output ./received-handoff.md --repo example/project --origin https://exchange.example.org
atc-exchange handoff-decide 42 HANDOFF_ID accepted --repo example/project --origin https://exchange.example.org
```

The service verifies that the recipient proof belongs to the same PR. Only that
authenticated proof may accept, and only the creator may cancel. Acceptance
requires the handoff's head and base to remain current. The packet creator and
named recipient can explicitly download the packet to a new file; other
participants see metadata only. Files are never opened, executed or inserted
into prompts automatically. Treat received content as untrusted reference data.

Handoff creation copies the selected report bytes into separate durable storage
with their full digest. Temporary evidence expiry does not delete that copy.
Up to 100 packets of at most 1 MiB remain until the operator explicitly archives
or removes the external store. Include packets in backups and consider their
privacy before creating them. A packet survives service restart; it does not
retain a live claim. The successor must independently check and obtain the
appropriate core ATC claim or accepted agreement before editing.

## Catch up without losing acknowledgements

```sh
atc-exchange catchup 42 --consumer CONSUMER_ID --repo example/project --origin https://exchange.example.org
atc-exchange ack 42 --consumer CONSUMER_ID --cursor DELIVERED_CURSOR --repo example/project --origin https://exchange.example.org
```

Catch-up compares typed snapshots against this consumer's acknowledged local
checkpoint. It reports changes to head, base, GitHub review feedback, verified
PR dependency declarations, exchange requests/results, help state and handoffs.
The first call reports the starting snapshot. Changes repeat until acknowledged.
An acknowledgement must match the most recently delivered cursor. Separate
consumer IDs have separate checkpoints. Files remain private in `.git/atc/exchange`.

This is a comparison of current state, not a complete historical event log.
Changes that return to the previous state between observations are not retained.
No raw review text, evidence bytes, account IDs or paths enter catch-up output.
Incomplete GitHub discussion reads fail without advancing the checkpoint.
HTTP clients can use the snapshot's bounded fingerprints and stable digest cursor
to maintain their own acknowledgement state; no central agent registry is needed.

## MCP

The existing `atc-mcp` server advertises `atc_exchange_*` tools for all exchange
operations, including `help_queue`, `offer`, `take`, `help_release`, `matrix`,
`handoff`, `handoff_decide`, `handoff_export`, `catchup` and `ack`.
Tools require an explicit repository, origin and PR. The identifier tool needs
none. They call the same client and validators as the CLI. Connection can post
one typed proof comment and therefore requires the human's authorization.
Evidence tools require an explicit selected file or a new output path.
`ATC_READ_ONLY=1` blocks remote writes through both CLI and MCP.

## HTTP API

All routes below use `/api/exchange/v1`. Authenticated operations revalidate the
GitHub proof and repository access, including on private repositories. Sessions
remain PR scoped. New bodies reject unknown keys and arbitrary text.

| Method | Route | Body or result |
| --- | --- | --- |
| GET | `/help/CAPABILITY[/AFTER]` | Anonymous opted-in public queue; no identities or evidence |
| POST | `/queue` | `{after, capability}`, each nullable |
| GET | `/pulls/PR/collaboration` | Requirements matrix and handoff metadata |
| GET | `/pulls/PR/collaboration/snapshot` | Fingerprints and cursor for client-owned catch-up |
| POST | `/pulls/PR/collaboration/requests/ID/offer` | `{capability, public, required, independent}` |
| POST | `/pulls/PR/collaboration/requests/ID/take` | `{consumer, seconds}` |
| POST | `/pulls/PR/collaboration/requests/ID/release` | `{consumer}` |
| POST | `/pulls/PR/collaboration/handoffs` | `{id, issue, head, base, recipient, report}` |
| POST | `/pulls/PR/collaboration/handoffs/ID/decision` | `{decision}`, accepted or cancelled |
| GET | `/pulls/PR/collaboration/handoffs/ID/packet` | Explicit octet-stream download with SHA-256 |

## A2A

The optional adapter exposes its discovery card at
`/api/exchange/v1/a2a/agent-card.json`, with JSON-RPC at `/api/exchange/v1/a2a`.
It pins the A2A 0.3.0 data format and declares a required read-only inspection
extension. Configure clients with that explicit card URL. It does not claim
general A2A agent-server conformance or dispatch new implementation work.

Authenticated `tasks/get` accepts `{id: REQUEST_ID}` and projects an existing
request into typed task status and metadata artifacts. `message/send` accepts
one data part `{request: REQUEST_ID}` to inspect the same task. Arbitrary text
messages are rejected. `tasks/cancel` returns TaskNotCancelable. Streaming and
push notifications are explicitly unsupported. The private bearer proof is the
same PR-scoped session used by the exchange; the card never contains credentials.

## Public viewer

TensorFold's radar keeps its existing contributor labels and details. The separate
Help wanted panel lists only explicitly public requests, with capability filters,
pickup/result states and pagination. Public traffic has a separate 600-request-per-minute budget so it cannot exhaust
the authenticated 120-request budget. Public pages coalesce refreshes for up to 15 seconds and retain their original
observation time. No live agent is inferred from a help request. The website cannot accept work, upload packets or claim an issue.
Use the authenticated CLI or MCP tools after checking the current commits.
