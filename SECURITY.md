# Security and privacy

ATC lets strangers' agents coordinate without giving any of them a way to talk another into doing something, and without collecting anything. This page says what the design guarantees, what it can't guarantee, and how it's tested.

## What the design guarantees

No free text passes between agents through ATC. A comment counts only if it is unedited and its first line matches a strict grammar of fixed verbs, area names from the maintainer's config, and numbers. The rest of the comment, every edited comment, comments from bots and every other comment are ignored, and nothing from them is kept or printed.

Agents see only numbers, fixed words and area names. The CLI never prints a username, not even a claimant's, and never prints titles, comment text, branch names or file names. A username crafted to read like an instruction can't reach an agent through ATC.

What the CLI posts is built from checked values: the command, @mentions of the people involved, which are validated GitHub usernames, and an optional signature line from the poster's own `ATC_SIGNATURE` setting. That line is limited to 120 characters, with no line breaks and no `@`.

ATC stores nothing. There is no server, database or bot, and it uses no credentials beyond each person's own `gh` login. It only reads data that person can already see on the repository.

Everyone acts under their own GitHub identity. Only a claimant's accept or decline counts, only the proposer's withdraw counts, and only a reset from an owner, member or collaborator counts, using the author association GitHub attaches to each comment.

Every agent reaches the same answer. The CLI replays comments in comment-id order with the same rules, breaks ties by comment id, and ignores edits, so nobody can rewrite history after the fact.

File names from pull requests and from your working tree are compared in memory and reported only as counts and area names.

The CLI runs `gh` and `git` without a shell, validates every repository name and git ref before use, and turns GitHub errors into fixed messages that never repeat GitHub's text.

## What it cannot guarantee

Agents still read issues, pull requests and code to do their work. Text there can carry prompt injection, and ATC can't clean it. The agent skill tells agents to treat all of it as untrusted data, but how well an agent follows that depends on the agent and its harness.

ATC only advises. Anyone can ignore it and open a pull request anyway. It makes collisions visible before work starts; it can't block them.

The comments are public on a public repository. Anyone can see who claimed what, because the username belongs to the comment's author. GitHub usernames count as personal data in some places.

Someone can post noisy `/atc` comments. The rules stop that from gaining claims beyond the limits, but the comments still show up. Maintainers can moderate as usual, and `/atc reset` clears an issue.

Deleting a comment removes it from everyone's replay at once. Deleting your own claim releases it, the same as `/atc release`.

Claims and proposals older than the replay window drop out, and two copies of the CLI with different rules could disagree. Pin one version of the CLI per project.

## How it's tested

`npm run check` runs the suite. The hostile-input test puts prompt injection text, an email address, a fake token, an HTML tag, a command line and an instruction-like username into comments, issue titles and bodies, assignees, pull request descriptions, pull request file names and local file names. It then checks that none of them, and no username at all, appear in any CLI output, and that every comment the CLI posts contains only the checked command and mentions. Other tests cover ties between simultaneous claims, edited and forged comments, stale claims, unauthorized accepts and resets, limits, malformed config, git ref injection and failed GitHub calls.

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository. Please don't post exploit details in a public issue.
