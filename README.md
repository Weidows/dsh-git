# dsh-git

Git, visible where you are writing code — a [DeepSeek Harness](https://github.com/deepseek-ai) plugin.

Three seats, one read-only git API:

- **A chip under the composer** — `repo / branch`, a dirty dot, and ↑ahead/↓behind drift, for the workspace the current session runs in.
- **A Git button in the conversation header** — same repo state, one click away.
- **A right-sidebar tab** — the change list with per-file patches, and the commit history with per-commit patches.

Both entry points open the same tab, so the chip and the header button are interchangeable.

---

## What it looks like

```
  weidows / main ● ↑3          ← chip under the composer (click = open tab)
```

```
  ┌─ right sidebar ──────────────────────────────┐
  │ weidows   main ↑3          [ 改动 69 | 历史 ] │
  │ ──────────────────────────────────────────── │
  │ M lib/client.js              +42 −7          │
  │ A README.md                  +120            │
  │ R old-name.js → new-name.js                  │
  │ ? notes.txt                  untracked       │
  │ ──────────────────────────────────────────── │
  │  @@ -12,6 +12,9 @@                           │
  │   for (const file of files) {                │
  │ +   rows.push(row(file))                     │
  │   }                                          │
  └──────────────────────────────────────────────┘
```

## Install

```bash
dsh plugin --profile web add github:Weidows/dsh-git
```

Or from a checkout:

```bash
dsh plugin --profile web add C:/path/to/dsh-git
```

Restart the app afterwards. Host-half code is loaded at boot, so editing the
plugin's files needs a restart to take effect.

## How it works

The plugin ships two halves, exactly like any other DSH bundle:

| Half | File | Role |
| --- | --- | --- |
| host | `lib/index.js` | serves `POST /plugins/dsh-git/api/*` on the profile's own HTTP surface |
| client | `lib/client.js` | mounts the three seats into `slots` |

### Host half

```
POST /plugins/dsh-git/api/state   { cwd }              -> repo, branch, ahead/behind, changed files
POST /plugins/dsh-git/api/diff    { cwd, mode, path? } -> unified patch text (mode: worktree | staged)
POST /plugins/dsh-git/api/log     { cwd, limit }       -> commit list
POST /plugins/dsh-git/api/commit  { cwd, hash }        -> one commit: metadata + files + patch
```

Everything is **read-only**: nothing here stages, commits, pushes, or checks out.
Requests are admitted through `connection.requestRejection` like the rest of the
profile's routes; other requests get `403`.

Git is invoked through `execFile('git', args)` with an explicit `cwd` — no shell
is ever involved, so a path containing spaces or quotes cannot turn into an
argument. The inspected directory must be absolute and exist; the repo root is
resolved with `git rev-parse --show-toplevel`, so a session opened in a
subdirectory still shows the whole repository.

Output caps: 24 MB per git process, 1.2 MB of patch text per response, 40 commits
per history page (max 200).

### Client half

```js
export const inject = ['slots', 'sessions', 'locale']

ctx.slots.inject('conversation.input.dock', ...)                 // the chip
ctx.slots.inject('conversation.session.header.utilities', ...)   // the header button
ctx.slots.inject('sidebar.right.pane.tab', ...)                  // the tab body
ctx.slots.inject('sidebar.right.pane.tab.title', ...)            // the tab chip
ctx.sidebarRightTabs.register({ id: 'dsh-git', kind: 'dsh-git', priority: 'extension' })
```

The session's working directory is read from `sessions.list` with
`useSyncExternalStore`, so switching sessions re-points the chip at that
session's repository. One shared store fetches repo state once and hands it to
all three seats; the tab additionally refetches on demand and when it opens.

## Configuration

None. If a session's working directory is not inside a git repository, all three
seats render nothing at all rather than an empty frame.

## Notes and limits

- Uncommitted state only: the changes list is `git status` + `git diff`
  (`--staged` or worktree), not a graph view.
- Renames are shown as `old → new` when git reports them as renames.
- Untracked files appear in the list but have no patch to show.
- Binaries and generated files are listed; their diff is whatever git prints.
- No write operations by design. Staging, committing, and pushing belong to the
  terminal, not to a panel that can be clicked by accident.

## Development

```bash
node --check lib/index.js
node --check lib/client.js
```

Both halves are dependency-free ES modules — no build step, no bundler, no
runtime dependencies.

## License

MIT
