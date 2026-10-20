/**
 * dsh-git - host half.
 *
 * Answers the browser half over the profile's own HTTP surface:
 *
 *   POST /plugins/dsh-git/api/state          { cwd }                     -> repo + branch + changed files
 *   POST /plugins/dsh-git/api/diff           { cwd, mode, path }         -> unified patch text
 *   POST /plugins/dsh-git/api/log            { cwd, ref, limit, search } -> commit list
 *   POST /plugins/dsh-git/api/commit         { cwd, hash }               -> one commit: meta + files + patch
 *   POST /plugins/dsh-git/api/commit-files   { cwd, hash }               -> one commit's file list
 *   POST /plugins/dsh-git/api/commit-file    { cwd, hash, path }         -> one file's patch inside a commit
 *   POST /plugins/dsh-git/api/stage          { cwd, paths }              -> git add
 *   POST /plugins/dsh-git/api/unstage        { cwd, paths }              -> git restore --staged
 *   POST /plugins/dsh-git/api/discard        { cwd, paths }              -> git checkout --
 *   POST /plugins/dsh-git/api/commit-create  { cwd, message, all }       -> git commit -m
 *   POST /plugins/dsh-git/api/branches       { cwd }                     -> local + remote branches
 *   POST /plugins/dsh-git/api/checkout       { cwd, branch }             -> git switch
 *   POST /plugins/dsh-git/api/reset          { cwd, hash, mode }         -> git reset --soft|mixed|hard
 *   POST /plugins/dsh-git/api/revert         { cwd, hash }               -> git revert --no-edit
 *   POST /plugins/dsh-git/api/suggest        { cwd, sessionId }          -> one generated commit message
 *
 * The cwd comes from the client (the session's workspace root) and is only
 * ever used as the cwd of a git invocation, never interpolated into a shell:
 * every command is execFile'd as an argument vector. Mutating methods accept
 * only a closed vocabulary of verbs; pathspecs are passed after -- so a path
 * can never be read as an option.
 */
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, basename } from 'node:path'

/** Route prefix the client fetches from. */
const PREFIX = '/plugins/dsh-git/api'

/** Cap on a single git command's output (diffs of generated files get big). */
const MAX_BUFFER = 24 * 1024 * 1024

/** Cap on the patch text handed to the browser in one response. */
const PATCH_LIMIT = 1200000

/** Default history depth. */
const DEFAULT_LOG_LIMIT = 40

/** Max characters of diff handed to the model when drafting a message. */
const SUGGEST_DIFF_LIMIT = 12000

/** Output budget of one suggestion (a subject plus a short body). */
const SUGGEST_MAX_TOKENS = 512

/** Hard deadline of one suggestion. */
const SUGGEST_TIMEOUT_MS = 30000

export const name = 'dsh-git'

/** The web surface is the whole reason this half exists. */
export const inject = ['webServer']

/**
 * Run git with no shell in the middle.
 * @param {string} cwd - working directory the command runs in.
 * @param {string[]} args - git arguments.
 * @param {number} [timeout] - milliseconds before the child is killed.
 * @returns {Promise<string>} stdout.
 */
function run(cwd, args, timeout = 25000) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-pager', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        const detail = String(stderr === undefined || stderr === null ? '' : stderr).trim()
        const failure = new Error(detail === '' ? 'git command failed' : detail)
        failure.gitArgs = args
        failure.gitStderr = detail
        reject(failure)
      },
    )
  })
}

/**
 * The repository containing a directory.
 * @param {string} cwd - any directory inside the worktree.
 * @returns {Promise<string>} the worktree root.
 */
async function repoRoot(cwd) {
  return (await run(cwd, ['rev-parse', '--show-toplevel'])).trim()
}

/**
 * Parse git status --porcelain=v1 -b into branch facts and file rows.
 * @param {string} text - raw stdout.
 * @returns {{branch: string, upstream: string|null, ahead: number, behind: number, detached: boolean, unborn: boolean, files: object[]}} parsed status.
 */
function parseStatus(text) {
  const files = []
  let branch = ''
  let upstream = null
  let ahead = 0
  let behind = 0
  let detached = false
  let unborn = false
  const lines = text.split('\n')
  for (const line of lines) {
    if (line === '') continue
    if (line.startsWith('## ')) {
      const header = line.slice(3)
      if (header.startsWith('No commits yet on ')) {
        unborn = true
        branch = header.slice('No commits yet on '.length)
        continue
      }
      if (header.startsWith('HEAD (no branch)')) {
        detached = true
        branch = 'HEAD'
        continue
      }
      const tracking = header.match(/\[([^\]]*)\]/)
      const ref = header.split(' [')[0]
      const dots = ref.indexOf('...')
      branch = dots === -1 ? ref : ref.slice(0, dots)
      upstream = dots === -1 ? null : ref.slice(dots + 3)
      if (tracking !== null) {
        const aheadMatch = tracking[1].match(/ahead (\d+)/)
        const behindMatch = tracking[1].match(/behind (\d+)/)
        ahead = aheadMatch === null ? 0 : Number(aheadMatch[1])
        behind = behindMatch === null ? 0 : Number(behindMatch[1])
      }
      continue
    }
    if (line.length < 3) continue
    const index = line[0]
    const worktree = line[1]
    let file = line.slice(3)
    let from = null
    const arrow = file.indexOf(' -> ')
    if (arrow !== -1) {
      from = file.slice(0, arrow)
      file = file.slice(arrow + 4)
    }
    const untracked = index === '?'
    const conflicted = index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D')
    files.push({
      path: file,
      from,
      index,
      worktree,
      untracked,
      conflicted,
      staged: index !== ' ' && index !== '?' && index !== '!',
      unstaged: worktree !== ' ' && worktree !== '?' && worktree !== '!',
    })
  }
  return { branch, upstream, ahead, behind, detached, unborn, files }
}

/**
 * Repo identity, branch state and the working-tree summary.
 * @param {string} cwd - directory the client asked about.
 * @returns {Promise<object>} the state document.
 */
async function readState(cwd) {
  let root
  try {
    root = await repoRoot(cwd)
  } catch {
    return { isRepo: false, cwd, root: null, name: null, branch: '', files: [] }
  }
  const status = parseStatus(await run(root, ['status', '--porcelain=v1', '-b', '--untracked-files=normal']))
  let lastCommit = null
  try {
    const head = (await run(root, ['log', '-1', '--pretty=format:%h%x1f%s%x1f%an%x1f%aI'])).trim()
    if (head !== '') {
      const parts = head.split('\x1f')
      lastCommit = { short: parts[0], subject: parts[1], author: parts[2], date: parts[3] }
    }
  } catch {
    lastCommit = null
  }
  let remoteUrl = null
  try {
    remoteUrl = (await run(root, ['remote', 'get-url', 'origin'])).trim()
    if (remoteUrl === '') remoteUrl = null
  } catch {
    remoteUrl = null
  }
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const file of status.files) {
    if (file.conflicted) counts.conflicted += 1
    if (file.untracked) counts.untracked += 1
    else {
      if (file.staged) counts.staged += 1
      if (file.unstaged) counts.unstaged += 1
    }
  }
  return {
    isRepo: true,
    cwd,
    root,
    name: basename(root),
    branch: status.branch,
    detached: status.detached,
    unborn: status.unborn,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    counts,
    changed: status.files.length,
    files: status.files,
    lastCommit,
    remoteUrl,
  }
}

/**
 * Patch text for the worktree, the index, or one path.
 * @param {string} root - worktree root.
 * @param {string} mode - 'worktree' | 'staged'.
 * @param {string|null} target - repo-relative path to narrow to.
 * @returns {Promise<{patch: string, truncated: boolean}>} the patch.
 */
async function readDiff(root, mode, target) {
  const common = ['--no-color', '--no-ext-diff', '--unified=3', '--find-renames']
  const tail = target === null || target === undefined || target === '' ? [] : ['--', target]
  let patch = ''
  if (mode === 'staged') {
    patch = await run(root, ['diff', '--cached', ...common, ...tail])
  } else {
    try {
      patch = await run(root, ['diff', 'HEAD', ...common, ...tail])
    } catch {
      const cached = await run(root, ['diff', '--cached', ...common, ...tail])
      const worktree = await run(root, ['diff', ...common, ...tail])
      patch = cached + worktree
    }
  }
  const truncated = patch.length > PATCH_LIMIT
  return { patch: truncated ? patch.slice(0, PATCH_LIMIT) : patch, truncated }
}

/**
 * One commit's per-file line counts.
 * @param {string} root - worktree root.
 * @param {string} hash - validated commit id.
 * @returns {Promise<object[]>} file rows.
 */
async function readCommitFiles(root, hash) {
  const numstat = await run(root, ['show', '--no-color', '--format=', '--numstat', '--find-renames', hash])
  const files = []
  for (const line of numstat.split('\n')) {
    if (line === '') continue
    const bits = line.split('\t')
    if (bits.length < 3) continue
    files.push({
      additions: bits[0] === '-' ? null : Number(bits[0]),
      deletions: bits[1] === '-' ? null : Number(bits[1]),
      path: bits[2],
    })
  }
  return files
}

/**
 * The commit list, newest first.
 * @param {string} root - worktree root.
 * @param {number} limit - how many commits.
 * @param {string|null} reference - branch or tag to walk.
 * @param {string|null} search - subject/body search term.
 * @returns {Promise<object[]>} commit rows.
 */
async function readLog(root, limit, reference, search) {
  const args = ['log', '-n', String(limit), '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D']
  if (reference !== null && reference !== undefined && reference !== '') args.push(reference)
  if (search !== null && search !== undefined && search !== '') args.push('--regexp-ignore-case', '--grep=' + search)
  let text
  try {
    text = await run(root, args)
  } catch {
    return []
  }
  const commits = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const parts = line.split('\x1f')
    commits.push({
      hash: parts[0],
      short: parts[1],
      author: parts[2],
      date: parts[3],
      subject: parts[4],
      refs: parts[5] === undefined ? '' : parts[5],
    })
  }
  return commits
}

/**
 * The local and remote branch names of a repository.
 * @param {string} root - worktree root.
 * @returns {Promise<object>} branch lists.
 */
async function readBranches(root) {
  const US = '\x1f'
  const parse = (text, remote) => {
    const rows = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      const parts = line.split(US)
      const name = parts[0]
      if (name === '') continue
      if (remote === true && name.endsWith('/HEAD') === true) continue
      rows.push({ name, current: parts[1] === '*', upstream: parts[2] === undefined ? '' : parts[2] })
    }
    return rows
  }
  const local = parse(await run(root, ['for-each-ref', '--format=%(refname:short)' + US + '%(HEAD)' + US + '%(upstream:short)', 'refs/heads']), false)
  const remote = parse(await run(root, ['for-each-ref', '--format=%(refname:short)' + US + '%(symref)', 'refs/remotes']), true)
  const hit = local.find((entry) => entry.current === true)
  return { local, remote, current: hit === undefined ? '' : hit.name }
}

/**
 * One commit: metadata, per-file line counts, and its patch.
 * @param {string} root - worktree root.
 * @param {string} hash - full or abbreviated commit id.
 * @returns {Promise<object>} the commit document.
 */
async function readCommit(root, hash) {
  const metaText = (await run(root, ['log', '-1', '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b', hash])).trim()
  const parts = metaText.split('\x1f')
  const files = await readCommitFiles(root, hash)
  let patch = await run(root, ['show', '--no-color', '--no-ext-diff', '--format=', '--patch', hash])
  const truncated = patch.length > PATCH_LIMIT
  if (truncated) patch = patch.slice(0, PATCH_LIMIT)
  return {
    hash: parts[0],
    short: parts[1],
    author: parts[2],
    email: parts[3],
    date: parts[4],
    subject: parts[5],
    body: parts[6] === undefined ? '' : parts[6].trim(),
    files,
    patch,
    truncated,
  }
}

/**
 * Accept only an existing absolute directory.
 * @param {unknown} value - client-supplied cwd.
 * @returns {string} the validated path.
 */
function requireCwd(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('cwd is required')
  if (!isAbsolute(value)) throw new Error('cwd must be absolute')
  const info = statSync(value, { throwIfNoEntry: false })
  if (info === undefined || !info.isDirectory()) throw new Error('cwd is not a directory')
  return value
}

/**
 * A repo-relative pathspec that cannot be mistaken for an option.
 * @param {unknown} value - client-supplied path.
 * @returns {string} the validated path.
 */
function requirePath(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path is required')
  if (value.includes('\u0000')) throw new Error('path contains a null byte')
  if (value.startsWith('-')) throw new Error('path must not start with a dash')
  return value
}

/**
 * A list of pathspecs.
 * @param {unknown} value - client-supplied array.
 * @returns {string[]} the validated paths.
 */
function requirePaths(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('paths is required')
  if (value.length > 500) throw new Error('too many paths')
  return value.map(requirePath)
}

/**
 * A commit id (full or abbreviated, never an option).
 * @param {unknown} value - client-supplied id.
 * @returns {string} the validated id.
 */
function requireHash(value) {
  if (typeof value !== 'string' || /^[0-9a-fA-F]{4,40}$/.test(value) === false) throw new Error('not a commit id')
  return value
}

/**
 * A branch name that cannot be an option or a revision expression.
 * @param {unknown} value - client-supplied branch.
 * @returns {string} the validated name.
 */
function requireBranch(value) {
  if (typeof value !== 'string' || value === '') throw new Error('branch is required')
  if (/\s/.test(value) || value.includes('..') || value.includes('\u0000') || value.startsWith('-')) throw new Error('invalid branch name')
  if (/^[A-Za-z0-9._\/-]{1,200}$/.test(value) === false) throw new Error('invalid branch name')
  return value
}

/**
 * Read a JSON request body.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<object>} the parsed body (empty object when absent).
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('request body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 */
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Truncate a diff for the prompt, marking the cut.
 * @param {string} diff - patch text.
 * @returns {string} the bounded patch.
 */
function truncateDiff(diff) {
  if (diff.length <= SUGGEST_DIFF_LIMIT) return diff
  return diff.slice(0, SUGGEST_DIFF_LIMIT) + '\n...(diff truncated)'
}

/**
 * The provider/model route a suggestion runs on: the harness default, else the
 * newest route this session actually dispatched on.
 * @param {object} ctx - host plugin context.
 * @param {unknown} sessionId - the asking session.
 * @returns {{provider: string, model: string}|undefined} the route.
 */
function resolveRoute(ctx, sessionId) {
  const pick = (record) => {
    if (record === null || typeof record !== 'object') return undefined
    const provider = record.provider
    const model = record.model
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
    return { provider, model }
  }
  const selection = ctx.get('agentDefaultModel')
  if (selection !== undefined && selection !== null && typeof selection.currentSelection === 'function') {
    try {
      const direct = pick(selection.currentSelection())
      if (direct !== undefined) return direct
    } catch {
      // fall through to the session history
    }
  }
  const sessions = ctx.get('sessions')
  if (sessions === undefined || typeof sessionId !== 'string') return undefined
  const session = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
  const events = session !== undefined && session !== null && typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : undefined
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'request/header') continue
    const data = event.data
    const header = data !== null && typeof data === 'object' ? data.header : undefined
    const route = pick(header !== null && typeof header === 'object' ? header.config : undefined)
    if (route !== undefined) return route
  }
  return undefined
}

/**
 * The text a stream chunk contributes, read tolerantly across chunk shapes.
 * @param {unknown} chunk - one StreamChunk.
 * @returns {string} the text (possibly empty).
 */
function chunkText(chunk) {
  if (chunk === null || typeof chunk !== 'object') return ''
  const type = typeof chunk.type === 'string' ? chunk.type : ''
  if (type === 'text') return typeof chunk.text === 'string' ? chunk.text : ''
  if (type === 'text-delta' || type === 'content_block_delta') {
    if (typeof chunk.text === 'string') return chunk.text
    if (typeof chunk.delta === 'string') return chunk.delta
    if (chunk.delta !== null && typeof chunk.delta === 'object' && typeof chunk.delta.text === 'string') return chunk.delta.text
  }
  return ''
}

/**
 * Drop the model's prose scaffolding (fences, carriage returns, blank runs).
 * @param {string} text - raw model output.
 * @returns {string} the commit message.
 */
function cleanSuggestion(text) {
  const fence = String.fromCharCode(96, 96, 96)
  const withoutFence = text
    .split('\n')
    .filter((line) => line.trimStart().startsWith(fence) === false)
    .join('\n')
  return withoutFence.replace(/\r/g, '').split('\n').map((line) => line.trimEnd()).join('\n').trim()
}

/**
 * Draft one Conventional-Commits message from the pending change set.
 * @param {object} ctx - host plugin context.
 * @param {string} root - worktree root.
 * @param {unknown} sessionId - the asking session.
 * @param {'zh'|'en'} language - prompt language.
 * @returns {Promise<{message: string}>} the suggestion.
 */
async function suggestMessage(ctx, root, sessionId, language) {
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    throw new Error('the harness LLM service is unavailable')
  }
  const route = resolveRoute(ctx, sessionId)
  if (route === undefined) throw new Error('no model route is available for this session')
  const status = parseStatus(await run(root, ['status', '--porcelain=v1', '-b', '--untracked-files=normal']))
  const staged = await run(root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=2'])
  const worktree = await run(root, ['diff', '--no-color', '--no-ext-diff', '--unified=2'])
  const body = staged.trim() === '' ? worktree : staged
  if (body.trim() === '' && status.files.length === 0) throw new Error('there is nothing to commit')
  const names = status.files.map((file) => (file.untracked ? file.path + ' (new file)' : file.path))
  const user = language === 'zh'
    ? '改动的文件：\n' + names.join('\n') + '\n\n差异：\n' + truncateDiff(body)
    : 'Changed files:\n' + names.join('\n') + '\n\nDiff:\n' + truncateDiff(body)
  const system = language === 'zh'
    ? '你是 git 提交信息生成助手。根据给定的文件清单与差异，生成一行 Conventional Commits 风格的中文提交信息（类型前缀：feat/fix/refactor/chore/docs/test/perf/style）。只输出提交信息本身，不要解释，不要代码块。'
    : 'You are a git commit message assistant. Based on the given file list and diff, write a one-line Conventional Commits style commit message in English (type prefix: feat/fix/refactor/chore/docs/test/perf/style). Output only the message, no explanation, no code fences.'
  const messages = [{ role: 'user', content: [{ type: 'text', text: user }] }]
  let text = ''
  try {
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system,
      maxTokens: SUGGEST_MAX_TOKENS,
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    })) {
      text += chunkText(chunk)
    }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
      throw new Error('the model did not answer in time')
    }
    throw error
  }
  const message = cleanSuggestion(text)
  if (message === '') throw new Error('the model returned no commit message')
  return { message }
}

/**
 * Host plugin body: mount the git API.
 * @param {object} ctx - host plugin context (webServer, and optionally connection/sessions).
 */
export function apply(ctx) {
  /**
   * Same admission fence the host uses for its own plugin routes: delegated to
   * the connection service when this deployment has one.
   * @param {object} req - the request.
   * @returns {boolean} whether the request may proceed.
   */
  const admitted = (req) => {
    const connection = ctx.get('connection')
    if (connection === undefined || typeof connection.requestRejection !== 'function') return true
    return connection.requestRejection(req) === undefined
  }

  /**
   * Resolve the directory to inspect: an explicit cwd, else the session's own.
   * @param {object} body - request body.
   * @returns {Promise<string>} an existing absolute directory.
   */
  const resolveCwd = async (body) => {
    if (typeof body.cwd === 'string' && body.cwd.trim() !== '') return requireCwd(body.cwd)
    const sessions = ctx.get('sessions')
    if (sessions !== undefined && typeof body.sessionId === 'string') {
      const session = sessions.get(body.sessionId)
      const cwd = session === undefined || session === null ? undefined : session.header === undefined ? undefined : session.header.cwd
      if (typeof cwd === 'string' && cwd !== '') return requireCwd(cwd)
    }
    throw new Error('cwd is required')
  }

  /**
   * Resolve the worktree root and the language of one request.
   * @param {object} body - request body.
   * @returns {Promise<{root: string, language: 'zh'|'en'}>} the resolved root.
   */
  const resolveRoot = async (body) => {
    const root = await repoRoot(await resolveCwd(body))
    return { root, language: body.language === 'en' ? 'en' : 'zh' }
  }

  /**
   * Dispatch one API method.
   * @param {string} method - path segment after the prefix.
   * @param {object} body - request body.
   * @returns {Promise<object>} the response payload.
   */
  const dispatch = async (method, body) => {
    if (method === 'state') return readState(await resolveCwd(body))
    if (method === 'diff') {
      const root = await repoRoot(await resolveCwd(body))
      const mode = body.mode === 'staged' ? 'staged' : 'worktree'
      const target = typeof body.path === 'string' && body.path !== '' ? requirePath(body.path) : null
      return { mode, path: target, ...(await readDiff(root, mode, target)) }
    }
    if (method === 'log') {
      const root = await repoRoot(await resolveCwd(body))
      const limit = Number.isFinite(Number(body.limit)) ? Math.min(Math.max(Number(body.limit), 1), 200) : DEFAULT_LOG_LIMIT
      const reference = typeof body.ref === 'string' && body.ref !== '' ? requireBranch(body.ref) : null
      const search = typeof body.search === 'string' && body.search.trim() !== '' ? body.search.trim().slice(0, 120) : null
      return { commits: await readLog(root, limit, reference, search) }
    }
    if (method === 'commit') {
      const root = await repoRoot(await resolveCwd(body))
      return readCommit(root, requireHash(body.hash))
    }
    if (method === 'commit-files') {
      const root = await repoRoot(await resolveCwd(body))
      return { files: await readCommitFiles(root, requireHash(body.hash)) }
    }
    if (method === 'commit-file') {
      const root = await repoRoot(await resolveCwd(body))
      const patch = await run(root, ['show', '--no-color', '--no-ext-diff', '--format=', '--patch', requireHash(body.hash), '--', requirePath(body.path)])
      const truncated = patch.length > PATCH_LIMIT
      return { patch: truncated ? patch.slice(0, PATCH_LIMIT) : patch, truncated }
    }
    if (method === 'stage') {
      const { root } = await resolveRoot(body)
      await run(root, ['add', '--', ...requirePaths(body.paths)])
      return readState(root)
    }
    if (method === 'unstage') {
      const { root } = await resolveRoot(body)
      const paths = requirePaths(body.paths)
      try {
        await run(root, ['restore', '--staged', '--', ...paths])
      } catch {
        await run(root, ['reset', '-q', 'HEAD', '--', ...paths])
      }
      return readState(root)
    }
    if (method === 'discard') {
      const { root } = await resolveRoot(body)
      const paths = requirePaths(body.paths)
      const untracked = await run(root, ['ls-files', '--others', '--exclude-standard', '--', ...paths])
      const loose = untracked.split('\n').filter((line) => line !== '')
      if (loose.length > 0) throw new Error('untracked files cannot be discarded: ' + loose.join(', '))
      await run(root, ['checkout', '--', ...paths])
      return readState(root)
    }
    if (method === 'commit-create') {
      const { root } = await resolveRoot(body)
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (message === '') throw new Error('the commit message is empty')
      if (message.length > 8000) throw new Error('the commit message is too long')
      const args = ['commit', '-m', message]
      if (body.all === true) args.splice(1, 0, '--all')
      await run(root, args, 60000)
      return readState(root)
    }
    if (method === 'branches') {
      const root = await repoRoot(await resolveCwd(body))
      return readBranches(root)
    }
    if (method === 'checkout') {
      const { root } = await resolveRoot(body)
      const branch = requireBranch(body.branch)
      try {
        await run(root, ['switch', branch], 60000)
      } catch {
        await run(root, ['checkout', branch], 60000)
      }
      return readState(root)
    }
    if (method === 'reset') {
      const { root } = await resolveRoot(body)
      const mode = body.mode === 'soft' || body.mode === 'hard' ? body.mode : 'mixed'
      await run(root, ['reset', '--' + mode, requireHash(body.hash)], 60000)
      return readState(root)
    }
    if (method === 'revert') {
      const { root } = await resolveRoot(body)
      const hash = requireHash(body.hash)
      try {
        await run(root, ['revert', '--no-edit', hash], 120000)
      } catch (error) {
        try {
          await run(root, ['revert', '--abort'], 60000)
        } catch {
          // nothing to abort: the revert never started a merge
        }
        const message = error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
        throw new Error('revert did not apply and was rolled back: ' + message)
      }
      return readState(root)
    }
    if (method === 'suggest') {
      const { root, language } = await resolveRoot(body)
      return suggestMessage(ctx, root, body.sessionId, language)
    }
    throw new Error('unknown method: ' + method)
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: async (req, res) => {
          if (admitted(req) === false) {
            writeJson(res, 403, { ok: false, error: { message: 'forbidden' } })
            return
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { message: 'POST only' } })
            return
          }
          const url = req.url === undefined ? '' : req.url
          const query = url.indexOf('?')
          const pathname = query === -1 ? url : url.slice(0, query)
          if (pathname.startsWith(PREFIX) === false) {
            writeJson(res, 404, { ok: false, error: { message: 'not found' } })
            return
          }
          const method = pathname.slice(PREFIX.length).replace(/^\/+/, '')
          try {
            const body = await readJsonBody(req)
            const data = await dispatch(method, body)
            writeJson(res, 200, { ok: true, data })
          } catch (error) {
            const message = error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
            writeJson(res, 500, { ok: false, error: { message } })
          }
        },
      }),
    'dsh-git: git routes',
  )
}
