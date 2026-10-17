# ATC for GitHub

ATC lets independent coding agents, run by different people, work on the same GitHub repository without building the same thing twice. An agent claims an issue before it starts. When another agent wants the same issue, the two agree to pair, split it by area, hand it over or review each other's work, and the humans approve each step.

Everything happens on GitHub. Commands are issue comments, a GitHub Action keeps a board issue up to date, and agents use a small CLI that reads the board. There is no server to run and no account to create, and the code has no runtime dependencies.

## How it works

1. An agent runs `atc-gh check 42 core`. The answer says whether issue 42 is free and whether other claims cover the `core` area.
2. It claims the issue with `atc-gh claim 42 core --wait`, which posts `/atc claim core` on issue 42. The Action assigns the issue to that person and confirms.
3. A second agent that wants issue 42 gets `"advice": "proposeInstead"`. With its human's approval it runs `atc-gh propose 42 pair --wait`. The bot mentions the first claimant, whose agent sees the offer in `atc-gh status` and accepts or declines once its human decides.
4. A draft pull request whose description says `Fixes #42` is linked to the claim. When pull requests from two different people change the same files, the bot posts a notice on both with the number of shared files and the areas they fall in. It never names the files.

## Commands

| Comment | Who can use it | What it does |
| --- | --- | --- |
| `/atc claim [areas]` | anyone | Claims an open issue, optionally only some areas |
| `/atc release` | the claimant | Gives up the claim |
| `/atc propose split <areas>` | anyone not already on the issue | Offers to take those areas |
| `/atc propose pair` | anyone not already on the issue | Offers to work on it together |
| `/atc propose takeover` | anyone not already on the issue | Asks to take it over |
| `/atc propose review` | anyone not already on the issue | Offers to review the work |
| `/atc accept <n>` or `/atc decline <n>` | a claimant | Answers proposal `n` |
| `/atc withdraw <n>` | the proposer | Takes proposal `n` back |
| `/atc reset` | owners, members and collaborators | Clears every claim and proposal on the issue |

Only the first line of a comment counts, and it must match one of these exactly. The bot ignores everything else. Agents send these through `atc-gh`, which builds the comment from checked values.

## Set it up on a repository

1. Copy `examples/workflow.yml` to `.github/workflows/atc.yml` and point its `uses:` line at this repository pinned to a full commit SHA.
2. Optionally add `.github/atc.json` to name the areas of your codebase. See `examples/atc.json`. Areas are lowercase names mapped to path prefixes.
3. Add `skills/atc/SKILL.md` to the repository, or point your `AGENTS.md` at it, so agents know to check before they start.

The first `/atc` comment creates the board issue. Pin it if you like.

## Use it as a contributor

You need Node 22.16 or later and the GitHub CLI signed in (`gh auth status`). Install `atc-gh` from a reviewed copy of this repository at a pinned commit, for example with `npm link`. Then, in your clone of the project:

```bash
atc-gh status
```

The CLI works out the upstream repository from your clone. Pass `--repo owner/name` to choose it yourself.

## Safety

ATC is built so that no free text passes between agents through it and no personal data is stored beyond public GitHub usernames. [SECURITY.md](SECURITY.md) explains what that covers, and what it can't cover, such as an agent reading a poisoned issue directly.

## Limits in version 0.1

- The board holds up to 200 claims and 100 proposals, about 40 KB of state.
- Each run handles up to 50 commands. The rest wait for the next run, which comes with the next command, pull request event or hourly check.
- Overlap checks look at the 100 most recent open pull requests, 30 linked ones and 300 files each.
- It has only run against a simulated GitHub so far. Try it on a test repository before a busy one.

## Development

```bash
npm run check
```

That runs the style check and the test suite, which covers the command grammar, the board format, claims and proposals, the Action against a simulated GitHub, the CLI, and hostile input.
