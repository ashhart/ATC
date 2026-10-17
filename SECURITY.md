# Security and privacy

ATC's job is to let strangers' agents coordinate without giving any of them a way to talk another into doing something, and without collecting anything personal. This page says what the design guarantees, what it can't guarantee, and how it's tested.

## What the design guarantees

No free text passes between agents through ATC. The bot only acts on comments whose first line matches a strict grammar of fixed verbs, area names from the maintainer's config, and numbers. The rest of the comment, and every comment that doesn't match, is ignored. It is never stored or repeated.

The bot writes fixed sentences. Every value it puts into a comment or the board is checked again before use: a GitHub username, a number or a configured area name. It never quotes comments, titles, issue bodies, branch names, file names or commit messages.

Agents see only numbers, fixed words and area names. The CLI never prints another person's username, so a username crafted to read like an instruction can't reach an agent through ATC. The CLI trusts only the board issue opened by the bot account, and it rejects the whole board if any part of the stored state fails validation.

ATC stores no personal data beyond the GitHub usernames of people who used an `/atc` command or opened a linked pull request. Those are already public on the same repository. It stores no emails, names, comment text, titles or file paths. Changed file names are compared in memory and reduced to a count and a list of area names.

The workflow never checks out or runs code from a pull request. It uses the repository's own workflow token with issues write, pull requests read and contents read, and no secrets. That is why it can safely run on `pull_request_target` for pull requests from forks.

Everyone acts under their own GitHub identity. Only a claimant can accept or decline a proposal, only the proposer can withdraw it, and only owners, members and collaborators can reset an issue.

Abuse is bounded. A person can hold 3 claims and 5 pending proposals, an issue can have 10 pending proposals, and the board has a size limit. Idle claims expire after 7 days. The bot answers the same refusal from the same person on the same issue at most once an hour, so nobody can use it to spam mentions.

## What it cannot guarantee

Agents still read issues, pull requests and code to do their work. Text there can carry prompt injection, and ATC can't clean it. The agent skill tells agents to treat all of it as untrusted data, but how well an agent follows that depends on the agent and its harness.

Usernames appear on the board and in bot comments for people to read. Someone can register a username that looks like an instruction. Agents never see it through the CLI, but they could if they read the issue thread or the board directly.

GitHub usernames count as personal data in some places. Using ATC on a public repository makes your participation public, just like commenting does. The board is a public issue, and GitHub keeps its edit history, so a released claim stays in that history.

A maintainer, or anyone who controls the workflow file or its token, controls the bot. ATC trusts the maintainers of the repository it runs on.

## How it's tested

`npm run check` runs the suite. The hostile-input test sends prompt injection text, an email address, a fake token, an HTML tag, a command line and an instruction-like username through comments, issue titles and bodies, pull request descriptions and file names. It then checks that none of them appear in the board, the bot's comments, the logs or any CLI output, and that no username at all reaches the CLI output. Other tests cover forged boards, tampered state, malformed config, unauthorized accepts and resets, oversized input and a flood of claims.

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository. Please don't post exploit details in a public issue.
