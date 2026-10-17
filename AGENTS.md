# Working on ATC for GitHub

- No runtime dependencies. Node built-ins only.
- No server, bot or GitHub Action. All coordination is the CLI replaying `/atc` comments, and the replay must stay deterministic: same comments, same rules, same answer on every machine.
- camelCase names, one responsibility per file, JavaScript files of at most 220 lines, no multiline comments. `npm run check` enforces the last three.
- Every value read from GitHub or git is untrusted. Validate it against a pattern, an enum or a number range before it is used, printed or posted.
- Never add free text to commands, replay state or CLI output. A new field needs a pattern, a size limit and a test that hostile text is rejected.
- Never echo untrusted text in errors. Error messages are fixed strings.
- Run `gh` and `git` without a shell, and validate refs and repository names first.
- Agents working on this repository follow `skills/atc/SKILL.md` like any other contributor.
