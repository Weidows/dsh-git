# dsh-git

Git in the [DeepSeek Harness](https://github.com/deepseek-ai) composer and sidebar: a repo/branch chip, a header button, and a split Git panel with staging, commit, history and diffs.

## What it adds

**1. Branch chip in the composer.** A small pill sits in the composer trailing cluster, left of the model picker and the session-stats control:

```
main-repo / feature/login   ↑2
```

It shows the repository name, the current branch, ahead/behind markers, and a dirty dot. Click it to open the Git panel.

**2. Git button in the conversation header.** The same action from the top-right utilities row of an open conversation.

**3. A split Git panel in the sidebar.**

```
+----------------------+----------------------+
| changes + staging    | history              |
|  staged / unstaged   |  branch + filter     |
|  [ AI ] [ ] [commit] |  expandable commits  |
+----------------------+----------------------+
| diff                                       |
+--------------------------------------------+
```

- **Top-left**: staged and unstaged files. Stage/unstage a single file or everything, discard tracked changes, write a commit message, and generate one with AI (uses the Harness default model, and reports a clear error when no model is configured). Ctrl/Cmd+Enter commits.
- **Top-right**: commit history with a text filter, expandable rows that list the files of the commit, and a right-click menu (copy hash, `reset --soft/mixed/hard`, `revert`).
- **Bottom**: the diff of whatever you clicked — a working-tree file, a staged file, or a file inside a commit.

## Install

```bash
dsh plugin --profile web add C:/path/to/dsh-git
# or straight from git
dsh plugin --profile web add https://github.com/Weidows/dsh-git
```

Restart the Harness after installing: client plugins are loaded at boot.

## dsh-better-sidebar

[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) is supported and preferred when installed. dsh-git registers its panel through `ctx.betterSidebar.registerTab` (order 25, single instance) and skips its own native right-sidebar tab, so you never end up with two Git tabs. Without better-sidebar it falls back to a plain right-sidebar tab.

The panel can also be opened by other plugins:

```js
ctx.betterSidebar.openTab({ type: "dsh-git", title: "Git", meta: { cwd } }, { sessionId })
```

## Host API

All traffic goes through `POST /plugins/dsh-git/api/<method>` with a JSON body and returns `{ ok: true, data }` or `{ ok: false, error: { message } }`. Requests are rejected with 403 unless they come from the Harness connection. Every git call is `execFile("git", argv)` — never a shell — with a validated working directory, pathspecs after `--`, and 24 MB output caps.

| method | body | returns |
| --- | --- | --- |
| `state` | { cwd } | repo name, branch, ahead/behind, file list with per-file index/worktree state |
| `diff` | { cwd, mode: "worktree" or "staged", path? } | unified patch of the working tree, the index, or one file |
| `log` | { cwd, ref?, search?, limit? } | commits (hash, short, subject, author, date, refs) |
| `commit` | { cwd, hash } | commit meta, changed files with +/- counts, patch |
| `commit-files` | { cwd, hash } | files of a commit |
| `commit-file` | { cwd, hash, path } | patch of one file inside a commit |
| `stage` / `unstage` | { cwd, paths: [] } | fresh state |
| `discard` | { cwd, paths: [] } | fresh state (tracked files only) |
| `commit-create` | { cwd, message, all? } | fresh state |
| `branches` | { cwd } | local and remote branches |
| `checkout` | { cwd, branch } | fresh state |
| `reset` | { cwd, hash, mode: "soft", "mixed" or "hard" } | fresh state |
| `revert` | { cwd, hash } | fresh state |
| `suggest` | { cwd, sessionId?, language? } | AI commit message derived from the staged/working diff |

## Safety

- `reset --hard`, `revert` and `discard` are destructive; they are only reachable from explicit clicks in the panel. A revert that hits a conflict is rolled back with `git revert --abort`, so the working tree is never left mid-merge.
- Discarding an untracked file is refused instead of deleting it, and untracked files never show the discard action in the panel.
- Pathspecs and branch names are validated (no leading `-`, no whitespace or `..` in branches) and passed after `--`.
- The plugin never runs a shell, never prompts for credentials (`GIT_TERMINAL_PROMPT=0`), and never reads anything outside the session working directory.

## Development

```
lib/index.js       host half: the /plugins/dsh-git/api route and all git + LLM work
lib/client.js      browser half: slots, chip, header button, panel, native + better-sidebar tabs
cordis.patch.yml   bundle patch that inserts the plugin into the profile
```

The client half is a plain Harness client plugin (`window.__ModuleLoader__.load`) that registers React components into slots:

- `conversation.input.right` — the branch chip
- `conversation.session.header.utilities` — the header button
- `sidebar.right.pane.tab` — the native tab body (only when better-sidebar is absent)

## License

MIT
