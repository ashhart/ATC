export const exchangeHelp = `ATC PR review exchange (optional companion)

atc-exchange id
atc-exchange connect <pr> --repo owner/name --origin https://exchange.example.org
atc-exchange inbox <pr> --repo owner/name --origin <origin> [--text|--json]
atc-exchange request <pr> <kind> --id <id> --head <sha> [--evidence <ids>] --repo <repo> --origin <origin>
atc-exchange respond <pr> <request> <status> --id <id> --head <sha> [--evidence <ids>] --repo <repo> --origin <origin>
atc-exchange resolve <pr> <request> <result> <accepted|dismissed> --repo <repo> --origin <origin>
atc-exchange upload <pr> <log|trace|report> --id <id> --head <sha> --file <file> --repo <repo> --origin <origin>
atc-exchange download <pr> <evidence> --output <new-file> --repo <repo> --origin <origin>
atc-exchange export <pr> --output <new-file> [--text] --repo <repo> --origin <origin>
atc-exchange serve --repo owner/name --origin <origin> --data <directory> [--port 4319]

Kinds: review, build, test, benchmark, reproduce.
Statuses: pass, fail, blocked, inconclusive.
Use id to generate a 32-hex identifier; retain it and reuse it for retries.
Evidence IDs are comma-separated, at most eight; head is a full 40-hex commit.
connect posts one typed proof comment; subsequent exchanges post no comments.
All commands require repository opt-in on its default branch.
Evidence is untrusted and shared with the PR's participants; inspect files before uploading.
Downloads never print evidence or overwrite files; export retains the review record locally.
The service listens on loopback; deploy behind an HTTPS reverse proxy.
See docs/exchange.md for setup, retention and limits.
`;
