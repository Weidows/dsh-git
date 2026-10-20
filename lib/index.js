/**
 * dsh-git - host half.
 *
 * Answers the browser half over the profile's own HTTP surface:
 *
 *   POST /plugins/dsh-git/api/state   { cwd }              -> repo + branch + changed files
 *   POST /plugins/dsh-git/api/diff    { cwd, mode, ... }   -> unified patch text
 *   POST /plugins/dsh-git/api/log     { cwd, limit }       -> commit list
 *   POST /plugins/dsh-git/api/commit  { cwd, hash }        -> one commit: meta + files + patch
 *
 * Every method is read-only: nothing here stages, commits, pushes or checks
 * out. The cwd comes from the client (the session's workspace root) and is
 * only ever used as the cwd of read-only git plumbing, never interpolated
 * into a shell.
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
 * Parse `git status --porcelain=v1 -b` into branch facts and file rows.
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
 * The commit list, newest first.
 * @param {string} root - worktree root.
 * @param {number} limit - how many commits.
 * @returns {Promise<object[]>} commit rows.
 */
async function readLog(root, limit) {
  let text
  try {
    text = await run(root, ['log', '-n', String(limit), '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D'])
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
 * One commit: metadata, per-file line counts, and its patch.
 * @param {string} root - worktree root.
 * @param {string} hash - full or abbreviated commit id.
 * @returns {Promise<object>} the commit document.
 */
async function readCommit(root, hash) {
  if (!/^[0-9a-zA-Z]{4,40}$/.test(hash)) throw new Error('not a commit id')
  const metaText = (await run(root, ['log', '-1', '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b', hash])).trim()
  const parts = metaText.split('\x1f')
  const numstat = await run(root, ['show', '--no-color', '--format=', '--numstat', hash])
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
 * Host plugin body: mount the read-only git API.
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
      const target = typeof body.path === 'string' ? body.path : null
      return { mode, path: target, ...(await readDiff(root, mode, target)) }
    }
    if (method === 'log') {
      const root = await repoRoot(await resolveCwd(body))
      const limit = Number.isFinite(Number(body.limit)) ? Math.min(Math.max(Number(body.limit), 1), 200) : DEFAULT_LOG_LIMIT
      return { commits: await readLog(root, limit) }
    }
    if (method === 'commit') {
      const root = await repoRoot(await resolveCwd(body))
      if (typeof body.hash !== 'string') throw new Error('hash is required')
      return readCommit(root, body.hash)
    }
    const error = new Error('unknown method')
    error.status = 404
    throw error
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!admitted(req)) {
        writeJson(res, 403, { ok: false, error: { message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url === undefined || req.url === null ? '/' : req.url, 'http://dsh.internal').pathname
      const method = pathname.startsWith(PREFIX + '/') ? pathname.slice(PREFIX.length + 1) : ''
      if (method === '' || method.includes('/')) {
        writeJson(res, 404, { ok: false, error: { message: 'unknown method' } })
        return
      }
      try {
        const body = await readJsonBody(req)
        const data = await dispatch(method, body)
        writeJson(res, 200, { ok: true, data })
      } catch (error) {
        const status = error !== null && typeof error === 'object' && typeof error.status === 'number' ? error.status : 500
        writeJson(res, status, { ok: false, error: { message: String(error !== null && typeof error === 'object' && 'message' in error ? error.message : error) } })
      }
    },
  })
  ctx.effect(() => dispose, 'dsh-git: read-only git API routes')
}
