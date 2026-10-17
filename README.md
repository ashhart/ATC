# ATC for GitHub

ATC keeps coding agents run by different people from building the same thing on one GitHub repository. Before an agent starts an issue, it checks whether anyone is already on it. If someone is, the two agents agree to pair, split the issue by area, hand it over or review each other's work, and each human approves.

There is no server, no bot and no GitHub Action. Each agent runs a small CLI that reads the repository through the GitHub CLI (`gh`) and posts short `/atc` comments. Every agent replays the same comments in the same order under the same rules, so they all reach the same answer about who holds what.

## How it works

1. `atc check 42 core` says whether issue 42 is free. It looks at ATC claims, the issue's assignees and open pull requests that mention it, so it also notices people who don't use ATC.
2. `atc claim 42 core` posts `/atc claim core` on the issue and reads back how the replay decided it. When two agents claim at the same moment, the earlier comment wins on every machine, and the later agent is told it lost.
3. When an issue is taken, `atc propose 42 pair` posts a proposal that mentions the claimant. Their agent sees it in `atc status`, and the claimant's human decides with `atc accept <id>` or `atc decline <id>`.
4. Before opening a pull request, `atc overlap` compares the files you've changed, and your open pull requests, with everyone else's open pull requests. It reports counts and areas, never file names.

## The comments

| Comment | Who it counts for | What it does |
| --- | --- | --- |
| `/atc claim [areas]` | anyone | Claims an open issue, optionally only some areas |
| `/atc release` | the claimant | Gives up the claim |
| `/atc propose split <areas>` | anyone not on the issue | Offers to take those areas |
| `/atc propose pair` | anyone not on the issue | Offers to work on it together |
| `/atc propose takeover` | anyone not on the issue | Asks to take it over |
| `/atc propose review` | anyone not on the issue | Offers to review the work |
| `/atc accept <id>` or `/atc decline <id>` | a claimant | Answers a proposal, where the id is the proposal comment's id |
| `/atc withdraw <id>` | the proposer | Takes a proposal back |
| `/atc reset` | owners, members and collaborators | Clears every claim and proposal on the issue |

Every agent applies the same rules when it replays these:

- Only the first line of an unedited comment counts. Editing a command cancels it, so nobody can rewrite history.
- The earliest claim wins. A later claim on a held issue does nothing.
- A claim lapses after 7 days without ATC activity from the claimant, unless their pull request for the issue was updated in that time. Proposals lapse after 7 days.
- A person can hold 3 claims and 5 pending proposals, and an issue can have 10 pending proposals.

Agents send these through `atc`, which builds each comment from checked values and adds an @mention so the other person is notified.

## Set it up

Maintainers don't need to install anything. Optionally:

1. Add `.github/atc.json` to name the areas of your codebase and adjust the limits. See `examples/atc.json`.
2. Add `skills/atc/SKILL.md` to the repository, or point your `AGENTS.md` at it, so agents know to check before they start.

Contributors need Node 22.16 or later and the GitHub CLI signed in (`gh auth status`). Install `atc` from a reviewed copy of this repository at a pinned commit, for example with `npm link`, then run it inside your clone:

```bash
atc status
```

The CLI works out the upstream repository from your clone, and `--repo owner/name` chooses it yourself. Set `ATC_SIGNATURE` to add one line, such as a note that an AI agent posted the comment, to the end of every comment it posts.

## Safety

No free text passes between agents through ATC, and it stores nothing. [SECURITY.md](SECURITY.md) explains what that covers and what it can't, such as an agent reading a poisoned issue directly.

## Limits in version 0.1

- It replays the last 30 days of comments, up to 3,000 of them. `atc status` reports `complete: false` when it had to stop early.
- A claim whose last ATC comment is older than that window drops out. `atc status` lists claims to renew under `refreshDue`, and running `atc claim` again renews one.
- `atc overlap` checks the 30 most recent open pull requests from other people and up to 10 of yours, 300 files each.
- ATC only advises. Someone who ignores it can still open a duplicate pull request, but agents that use it see each other's work before they start.
- It has only run against a simulated GitHub so far.

## Development

```bash
npm run check
```

That runs the style check and the tests: the command grammar, the replay rules, the CLI against a simulated GitHub, the overlap check against a real local git repository, and hostile input.
