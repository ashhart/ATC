# Four agents, one backlog

The demo runs four scripted agents, ada, bo, cy and dee, against the same small repository and the same four-issue backlog twice. The first run has no coordination. The second run uses ATC. Everything happens in temporary local git repositories and an in-memory GitHub, so it needs no network access and never touches your clone or your GitHub account.

```bash
npm run demo
```

The default pace prints a line about every 350 milliseconds, so a full run takes under a minute and records well. Add `--fast` to skip the pauses:

```bash
npm run demo -- --fast
```

Colors appear only when the output is a terminal and `NO_COLOR` is unset.

## What the first run shows

The backlog has four issues: #1 the router drops the trailing slash, #2 the parser rejects unicode, #3 document the router options, and #4 add router regression tests. Issues #1 and #4 are good first issues.

All four agents read the backlog at the same moment. Ada and bo both pick #1 and change the same line of `src/router.js` in different ways. Cy fixes the parser. Dee adds tests for #4 but also pulls a helper out of `src/router.js`, on the line ada changed. Each agent opens a pull request.

Afterwards the maintainer runs the real `atc board`. It reports one duplicate attempt on #1 and three open pull requests changing `src/router.js`. The maintainer then merges the pull requests in order with `git merge-tree`. Ada's and cy's merge. Bo's and dee's conflict with main and are wasted.

## What the second run shows

The repository now has `.github/atc.json` with four areas: router, parser, docs and tests. Each agent runs `atc check` and claims the first issue that is free. Claims are real `/atc claim` comments, and the earliest one wins, so bo sees that #1 is taken and claims #2 instead. Each agent then records a local working session with `atc start`, which posts nothing.

Before opening a pull request, each agent runs `atc overlap`. For dee, this fetches ada's open pull request and test-merges it with `git merge-tree`, which reports a conflict in `src/router.js`. Dee keeps the router out of its pull request and tests through the public `route()` function instead. The second overlap check is clear.

The board shows four claimed issues, each with its own pull request, and no duplicate attempts. All four pull requests merge cleanly.

The run ends with a scoreboard:

```text
without ATC  merged 2  wasted 2  conflicts 2
with ATC     merged 4  wasted 0  conflicts 0
```

## What is real and what is scripted

The agents' choices and edits are scripted, so the run is the same every time. The rest is the shipped code working on real data. Checks, claims, presence, overlap and the board go through the same `runCli` path as the `atc` command. The git repositories are real, and conflicts come from `git merge-tree`. The only stand-in is GitHub itself, which is the in-memory fake from the test suite. If ATC ever stopped detecting dee's conflict or refused a claim, the demo would stop with an error instead of printing a happy ending.

## Recording it

These tools are optional and made by third parties. Install them separately if you want a recording.

To record with [asciinema](https://asciinema.org):

```bash
asciinema rec atc-demo.cast --command "npm run demo"
```

[VHS](https://github.com/charmbracelet/vhs) renders a GIF from a short tape file, such as one named `demo.tape`:

```text
Output atc-demo.gif
Set Width 1200
Set Height 800
Type "npm run demo"
Enter
Sleep 50s
```

```bash
vhs demo.tape
```
