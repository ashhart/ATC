export const exchangeHelp = `ATC PR review exchange (optional companion)

atc-exchange id
atc-exchange connect <pr> --repo owner/name --origin https://exchange.example.org
atc-exchange identity <pr> --repo owner/name --origin <origin>
atc-exchange inbox <pr> --repo owner/name --origin <origin> [--text|--json]
atc-exchange request <pr> <kind> --id <id> --head <sha> [--base <sha>] [--evidence <ids>] --repo <repo> --origin <origin>
atc-exchange respond <pr> <request> <status> --id <id> --head <sha> --base <tested-sha> [--evidence <ids>] --repo <repo> --origin <origin>
atc-exchange resolve <pr> <request> <result> <accepted|dismissed> --repo <repo> --origin <origin>
atc-exchange upload <pr> <log|trace|report> --id <id> --head <sha> --file <file> --repo <repo> --origin <origin>
atc-exchange download <pr> <evidence> --output <new-file> --repo <repo> --origin <origin>
atc-exchange export <pr> --output <new-file> [--text] --repo <repo> --origin <origin>
atc-exchange help-queue <pr> [--capability <capability>] [--after <id>] --repo <repo> --origin <origin>
atc-exchange offer <pr> <request> --capability <capability> [--public] [--required] [--independent] --repo <repo> --origin <origin>
atc-exchange take <pr> <request> --consumer <id> [--seconds 1800] --repo <repo> --origin <origin>
atc-exchange help-release <pr> <request> --consumer <id> --repo <repo> --origin <origin>
atc-exchange matrix <pr> --repo <repo> --origin <origin>
atc-exchange handoff <pr> <issue> --id <id> --recipient <proof-comment> --report <evidence-id> --head <sha> --base <sha> --repo <repo> --origin <origin>
atc-exchange handoff-decide <pr> <handoff> <accepted|cancelled> --repo <repo> --origin <origin>
atc-exchange handoff-export <pr> <handoff> --output <new-file> --repo <repo> --origin <origin>
atc-exchange catchup <pr> --consumer <id> --repo <repo> --origin <origin>
atc-exchange ack <pr> --consumer <id> --cursor <sha256> --repo <repo> --origin <origin>
atc-exchange serve --repo owner/name --origin <origin> --data <directory> [--port 4319]

Kinds: review, build, test, benchmark, reproduce.
Statuses: pass, fail, blocked, inconclusive.
Use id to generate a 32-hex identifier; retain it and reuse it for retries.
Evidence IDs are comma-separated, at most eight; head and base are full 40-hex commits.
Request defaults to the current base; respond requires the base actually tested.
Old receipts with no base remain readable as stale and cannot be accepted as current coverage.
connect posts one typed proof comment; subsequent exchanges post no comments.
All commands require repository opt-in on its default branch.
Evidence is untrusted and shared with the PR's participants; inspect files before uploading.
Downloads never print evidence or overwrite files; export retains the review record locally.
The service listens on loopback; deploy behind an HTTPS reverse proxy.
Capabilities: any, linux, macos, windows, cuda, metal, rocm, vulkan, cpu, docs, security.
Help is private to the PR unless explicitly offered with --public. Offer flags replace previous settings.
Consumers are distinct generated ids per agent; help leases do not transfer issue ownership.
Handoff packets preserve explicitly selected reports without evidence expiry; accepting does not claim issues.
See docs/collaboration.md for help, handoffs, catch-up, requirements, MCP and A2A.
See docs/exchange.md for setup, retention and limits.
`;
