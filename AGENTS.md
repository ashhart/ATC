# Working on ATC for GitHub

- No runtime dependencies. Node built-ins only.
- camelCase names, one responsibility per file, JavaScript files of at most 220 lines, no multiline comments. `npm run check` enforces the last three.
- Every value read from GitHub is untrusted. Validate it against a pattern, an enum or a number range before it is stored, printed or sent anywhere.
- Never add a free-text field to commands, board state, bot messages or CLI output. A new field needs a pattern, a size limit and a test that hostile text is rejected.
- Never echo untrusted text in errors or logs. Error messages are fixed strings.
- The workflow must never check out or run pull request code.
- Agents working on this repository follow `skills/atc/SKILL.md` like any other contributor.
