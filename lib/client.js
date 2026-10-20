/**
 * dsh-git - browser half.
 *
 * Three seats, one read-only git surface:
 *
 *   conversation.input.dock               the repo/branch chip under the composer
 *   conversation.session.header.utilities the header button that opens the tab
 *   sidebar.right.pane.tab (+ type)       the Changes / History tab
 *
 * The host half answers /plugins/dsh-git/api/{state,diff,log,commit}; this half
 * never shells out, so a browser-side bug can only ever read what the host
 * already agreed to report.
 */
window.__ModuleLoader__.load({
	id: "dsh-git",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = react;

		const NS = "dshGit";
		const TAB_ID = "dsh-git";
		const API = "/plugins/dsh-git/api/";
		const STYLE_ID = "dsh-git-style";
		const POLL_MS = 8000;
		const MAX_ROWS = 1800;

		const EN = {
			"tab.title": "Git",
			"chip.title": "Open the git tab",
			"header.title": "Git changes and history",
			"changes": "Changes",
			"history": "History",
			"refresh": "Refresh",
			"back": "All commits",
			"loading": "Loading...",
			"notRepo": "This project is not a git repository.",
			"clean": "Working tree clean.",
			"noHistory": "No commits yet.",
			"untracked": "Untracked",
			"staged": "Staged",
			"unstaged": "Changes",
			"conflicted": "Conflicts",
			"truncated": "Diff truncated for display.",
			"filesChanged": "{n} changed",
			"allChanges": "All changes",
			"noDiff": "No textual diff to show.",
			"unborn": "No commits yet",
		};
		const ZH = {
			"tab.title": "Git",
			"chip.title": "打开 Git 面板",
			"header.title": "Git 改动与历史",
			"changes": "改动",
			"history": "历史",
			"refresh": "刷新",
			"back": "全部提交",
			"loading": "加载中...",
			"notRepo": "当前项目不是 git 仓库。",
			"clean": "工作区干净。",
			"noHistory": "还没有提交。",
			"untracked": "未跟踪",
			"staged": "已暂存",
			"unstaged": "未暂存",
			"conflicted": "冲突",
			"truncated": "差异过大，仅展示前一部分。",
			"filesChanged": "{n} 个文件改动",
			"allChanges": "全部改动",
			"noDiff": "没有可显示的文本差异。",
			"unborn": "还没有提交",
		};

		const CSS = [
			'.dsh-git-dock { display: flex; align-items: center; gap: 8px; min-height: 20px; padding: 0 4px; }',
			'.dsh-git-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 22px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); line-height: 1; cursor: pointer; }',
			'.dsh-git-chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-chip > svg { flex: none; opacity: 0.85; }',
			'.dsh-git-chip-repo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }',
			'.dsh-git-chip-slash { opacity: 0.5; }',
			'.dsh-git-chip-branch { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-sync { flex: none; color: var(--dsw-alias-label-tertiary); }',
			'.dsh-git-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }',
			'.dsh-git-header { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
			'.dsh-git-header:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-header .dsh-git-dot { position: absolute; top: 5px; right: 4px; }',
			'.dsh-git-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }',
			'.dsh-git-head { flex: none; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
			'.dsh-git-repo { display: flex; align-items: center; gap: 6px; min-width: 0; font: var(--dsw-font-xxs-strong-12); }',
			'.dsh-git-repo > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.dsh-git-branch { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-branch > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }',
			'.dsh-git-grow { flex: 1; min-width: 0; }',
			'.dsh-git-seg { display: inline-flex; flex: none; padding: 2px; gap: 2px; border-radius: 7px; background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-seg > button { min-height: 22px; padding: 0 9px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); cursor: pointer; }',
			'.dsh-git-seg > button[data-active="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }',
			'.dsh-git-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
			'.dsh-git-icon:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }',
			'.dsh-git-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }',
			'.dsh-git-files { flex: none; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 4px 0; }',
			'.dsh-git-file { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 26px; padding: 0 12px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); text-align: left; cursor: pointer; }',
			'.dsh-git-file:hover { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-file[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-file-status { flex: none; width: 16px; text-align: center; font-family: var(--ds-font-family-code, monospace); font-weight: 600; }',
			'.dsh-git-file-status[data-kind="add"] { color: var(--dsw-alias-state-success-primary); }',
			'.dsh-git-file-status[data-kind="del"] { color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-file-status[data-kind="mod"] { color: var(--dsw-alias-state-business-primary); }',
			'.dsh-git-file-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }',
			'.dsh-git-file-note { flex: none; color: var(--dsw-alias-label-tertiary); }',
			'.dsh-git-patch { padding: 4px 0 12px; font-family: var(--ds-font-family-code, monospace); font-size: 11px; }',
			'.dsh-git-row { display: flex; gap: 6px; padding: 0 10px; line-height: 17px; }',
			'.dsh-git-row[data-kind="add"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); color: var(--dsw-alias-state-success-primary); }',
			'.dsh-git-row[data-kind="del"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-row[data-kind="hunk"] { color: var(--dsw-alias-label-tertiary); background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 6%, transparent); }',
			'.dsh-git-row[data-kind="context"] { color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-row[data-kind="file"] { margin-top: 6px; padding-top: 2px; padding-bottom: 2px; color: var(--dsw-alias-label-primary); font-weight: 600; }',
			'.dsh-git-sign { flex: none; width: 1ch; user-select: none; }',
			'.dsh-git-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }',
			'.dsh-git-commit { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 6px 12px; border: none; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; cursor: pointer; }',
			'.dsh-git-commit:hover { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-commit[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-hash { flex: none; padding-top: 1px; color: var(--dsw-alias-label-tertiary); font-family: var(--ds-font-family-code, monospace); font-size: 11px; }',
			'.dsh-git-commit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
			'.dsh-git-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.dsh-git-meta { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.dsh-git-empty { display: flex; align-items: center; justify-content: center; min-height: 120px; padding: 24px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); text-align: center; }',
			'.dsh-git-error { margin: 8px 12px; padding: 6px 8px; border-radius: 4px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); font: var(--dsw-font-xxxs-11); white-space: pre-wrap; overflow-wrap: anywhere; }',
			'.dsh-git-detail-head { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
			'.dsh-git-detail-top { display: flex; align-items: center; gap: 8px; }',
			'.dsh-git-link { padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); cursor: pointer; }',
			'.dsh-git-link:hover { color: var(--dsw-alias-label-primary); }',
		].join('\n');

		/** Mount the stylesheet once per document. */
		function ensureStyles() {
			if (typeof document === 'undefined') return;
			const existing = document.getElementById(STYLE_ID);
			if (existing !== null && existing !== undefined) return;
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		/** POST one API method and unwrap the { ok, data } envelope. */
		async function api(method, body) {
			const response = await fetch(API + method, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body === undefined ? {} : body),
				cache: 'no-store',
				credentials: 'same-origin',
			});
			const text = await response.text();
			let payload;
			try {
				payload = JSON.parse(text);
			} catch (error) {
				throw new Error('dsh-git: unexpected response (' + response.status + ')');
			}
			if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
				const message = payload !== null && typeof payload === 'object' && payload.error !== undefined && payload.error !== null && typeof payload.error.message === 'string' ? payload.error.message : 'request failed (' + response.status + ')';
				throw new Error(message);
			}
			return payload.data;
		}

		/**
		 * One shared repo-state store: the chip, the header button and the tab
		 * all read the same snapshot, so a poll costs one request, not three.
		 */
		function createRepoStore() {
			const listeners = new Set();
			let state = { cwd: undefined, data: null, error: null, loading: false, at: 0 };
			let inflight = false;
			const publish = (patch) => {
				state = Object.assign({}, state, patch);
				for (const listener of Array.from(listeners)) {
					try {
						listener();
					} catch (error) {
						console.error('dsh-git: store listener failed', error);
					}
				}
			};
			const load = (cwd, force) => {
				if (cwd === undefined || cwd === null || cwd === '') {
					if (state.cwd !== undefined) publish({ cwd: undefined, data: null, error: null });
					return Promise.resolve();
				}
				if (inflight) return Promise.resolve();
				if (force !== true && state.cwd === cwd && state.data !== null && Date.now() - state.at < 2500) return Promise.resolve();
				inflight = true;
				publish({ loading: true, cwd });
				return api('state', { cwd }).then(
					(data) => {
						inflight = false;
						publish({ loading: false, data, error: null, at: Date.now() });
					},
					(error) => {
						inflight = false;
						publish({ loading: false, error: String(error !== null && error !== undefined && error.message !== undefined ? error.message : error), at: Date.now() });
					},
				);
			};
			return {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot: () => state,
				load,
			};
		}

		/** The session workspace root, straight off the session list. */
		function useSessionCwd(ctx, sessionId) {
			const subscribe = useCallback((listener) => ctx.sessions.list.subscribe(listener), [ctx]);
			const read = useCallback(() => {
				if (sessionId === undefined || sessionId === null) return undefined;
				const snapshot = ctx.sessions.list.getSnapshot();
				const entry = snapshot !== null && snapshot !== undefined && snapshot.byId !== undefined ? snapshot.byId[sessionId] : undefined;
				return entry !== null && entry !== undefined && typeof entry.cwd === 'string' && entry.cwd !== '' ? entry.cwd : undefined;
			}, [ctx, sessionId]);
			return useSyncExternalStore(subscribe, read, read);
		}

		/** Live repo snapshot for one cwd, refreshed on a timer and on focus. */
		function useRepo(store, cwd) {
			const subscribe = useCallback((listener) => store.subscribe(listener), [store]);
			const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
			useEffect(() => {
				if (cwd === undefined) return undefined;
				store.load(cwd, true);
				const timer = setInterval(() => {
					if (document.visibilityState === 'visible') store.load(cwd, true);
				}, POLL_MS);
				const onFocus = () => {
					store.load(cwd, true);
				};
				window.addEventListener('focus', onFocus);
				return () => {
					clearInterval(timer);
					window.removeEventListener('focus', onFocus);
				};
			}, [store, cwd]);
			const data = snapshot.cwd === cwd ? snapshot.data : null;
			return { data, snapshot, stale: snapshot.cwd !== cwd };
		}

		/** Ask the right sidebar to show the git tab for this working copy. */
		function openGitTab(ctx, cwd) {
			const nav = ctx.get('sidebarRight');
			if (nav === undefined || nav === null || typeof nav.openTab !== 'function') {
				console.warn('dsh-git: the right sidebar is not available');
				return false;
			}
			try {
				nav.openTab(TAB_ID, { params: cwd === undefined ? undefined : { cwd } });
				return true;
			} catch (error) {
				console.warn('dsh-git: cannot open the git tab', error);
				return false;
			}
		}

		/** Branch glyph: two nodes on a stem, one node on the offshoot. */
		function branchIcon(size) {
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
					focusable: 'false',
				},
				h('circle', { key: 'a', cx: 4.5, cy: 3.5, r: 1.5 }),
				h('circle', { key: 'b', cx: 4.5, cy: 12.5, r: 1.5 }),
				h('circle', { key: 'c', cx: 11.5, cy: 6.5, r: 1.5 }),
				h('path', { key: 'd', d: 'M4.5 5v6' }),
				h('path', { key: 'e', d: 'M11.5 8c0 2.3-1.7 3.4-3.6 3.9' }),
			);
		}

		/** Clock glyph for the refresh control. */
		function refreshIcon(size) {
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
					focusable: 'false',
				},
				h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
				h('path', { key: 'b', d: 'M13 2.5V5h-2.5' }),
			);
		}

		/** Split a unified patch into coloured rows, capping the row count. */
		function parsePatch(patch) {
			const text = typeof patch === 'string' ? patch : '';
			const rows = [];
			if (text.trim() === '') return rows;
			const lines = text.split('\n');
			for (let index = 0; index < lines.length && rows.length < MAX_ROWS; index += 1) {
				const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
				if (line.startsWith('diff --git ')) {
					const rest = line.slice('diff --git '.length);
					const cut = rest.indexOf(' b/');
					rows.push({ kind: 'file', sign: '', text: cut === -1 ? rest : rest.slice(cut + 3) });
					continue;
				}
				if (line.startsWith('@@')) {
					rows.push({ kind: 'hunk', sign: '', text: line });
					continue;
				}
				if (
					line.startsWith('index ') ||
					line.startsWith('--- ') ||
					line.startsWith('+++ ') ||
					line.startsWith('new file mode') ||
					line.startsWith('deleted file mode') ||
					line.startsWith('old mode') ||
					line.startsWith('new mode') ||
					line.startsWith('similarity index') ||
					line.startsWith('rename from') ||
					line.startsWith('rename to') ||
					line.startsWith('Binary files')
				) {
					continue;
				}
				if (line === '') {
					rows.push({ kind: 'context', sign: '', text: '' });
					continue;
				}
				const head = line[0];
				if (head === '+') rows.push({ kind: 'add', sign: '+', text: line.slice(1) });
				else if (head === '-') rows.push({ kind: 'del', sign: '-', text: line.slice(1) });
				else rows.push({ kind: 'context', sign: ' ', text: head === ' ' ? line.slice(1) : line });
			}
			return rows;
		}

		/** Relative age of an ISO timestamp, in the compact form git UIs use. */
		function formatWhen(iso) {
			const then = Date.parse(iso);
			if (Number.isNaN(then)) return typeof iso === 'string' ? iso : '';
			const span = Date.now() - then;
			const minute = 60000;
			const hour = 3600000;
			const day = 86400000;
			if (span < minute) return 'now';
			if (span < hour) return Math.floor(span / minute) + 'm';
			if (span < day) return Math.floor(span / hour) + 'h';
			if (span < day * 30) return Math.floor(span / day) + 'd';
			return new Date(then).toISOString().slice(0, 10);
		}

		/** The porcelains status letters, folded into one display letter and a hue. */
		function describeStatus(file) {
			if (file.conflicted === true) return { letter: 'U', kind: 'del', note: 'conflicted' };
			if (file.untracked === true) return { letter: '?', kind: 'add', note: 'untracked' };
			const code = (file.index === ' ' ? file.worktree : file.index);
			if (code === 'A') return { letter: 'A', kind: 'add', note: 'added' };
			if (code === 'D') return { letter: 'D', kind: 'del', note: 'deleted' };
			if (code === 'R') return { letter: 'R', kind: 'mod', note: 'renamed' };
			if (code === 'C') return { letter: 'C', kind: 'mod', note: 'copied' };
			return { letter: 'M', kind: 'mod', note: 'modified' };
		}

		/** Fill {name} placeholders in a translated string. */
		function fill(template, values) {
			let output = String(template);
			for (const key of Object.keys(values)) output = output.split('{' + key + '}').join(String(values[key]));
			return output;
		}

		/** Module body: wire the three seats onto the shared store. */
		function apply(ctx) {
			ensureStyles();
			const store = createRepoStore();
			let translate = (key) => (EN[key] === undefined ? key : EN[key]);
			const t = (key) => translate(key);

			ctx.effect(() => {
				const offDict = ctx.locale.register(NS, { en: EN, zh: ZH });
				const bound = ctx.locale.bind(NS);
				translate = (key) => bound(key);
				return () => {
					translate = (key) => (EN[key] === undefined ? key : EN[key]);
					offDict();
				};
			}, 'dsh-git: dictionaries');

			/** The chip under the composer: repo name, branch, drift, dirty dot. */
			function GitChip(props) {
				const sessionId = props.sessionId;
				const cwd = useSessionCwd(ctx, sessionId);
				const { data } = useRepo(store, cwd);
				if (data === null || data.isRepo !== true) return null;
				const dirty = data.changed > 0;
				const title = data.root + '  ' + (dirty ? 'dirty' : 'clean') + '  ' + t('chip.title');
				return h(
					'div',
					{ className: 'dsh-git-dock' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-git-chip',
							title,
							'aria-label': t('chip.title'),
							onClick: () => {
								openGitTab(ctx, cwd);
							},
						},
						branchIcon(12),
						h('span', { key: 'repo', className: 'dsh-git-chip-repo' }, data.name === undefined || data.name === null ? '' : data.name),
						h('span', { key: 'slash', className: 'dsh-git-chip-slash' }, '/'),
						h('span', { key: 'branch', className: 'dsh-git-chip-branch' }, data.branch === '' ? 'HEAD' : data.branch),
						dirty ? h('span', { key: 'dot', className: 'dsh-git-dot' }) : null,
						data.ahead > 0 ? h('span', { key: 'ahead', className: 'dsh-git-sync' }, '\u2191' + data.ahead) : null,
						data.behind > 0 ? h('span', { key: 'behind', className: 'dsh-git-sync' }, '\u2193' + data.behind) : null,
					),
				);
			}

			/** The header button that opens the same tab. */
			function GitHeaderButton(props) {
				const sessionId = props.sessionId;
				const cwd = useSessionCwd(ctx, sessionId);
				const { data } = useRepo(store, cwd);
				if (data === null || data.isRepo !== true) return null;
				const dirty = data.changed > 0;
				return h(
					'button',
					{
						type: 'button',
						className: 'dsh-git-header',
						title: t('header.title') + ' \u00b7 ' + (data.branch === '' ? 'HEAD' : data.branch),
						'aria-label': t('header.title'),
						onClick: () => {
							openGitTab(ctx, cwd);
						},
					},
					branchIcon(15),
					dirty ? h('span', { key: 'dot', className: 'dsh-git-dot' }) : null,
				);
			}

			/** Render one patch as rows. */
			function PatchView(props) {
				const rows = useMemo(() => parsePatch(props.patch), [props.patch]);
				if (rows.length === 0) return h('div', { className: 'dsh-git-empty' }, t('noDiff'));
				return h(
					'div',
					{ className: 'dsh-git-patch' },
					rows.map((row, index) =>
						h(
							'div',
							{ key: index, className: 'dsh-git-row', 'data-kind': row.kind },
							row.sign === '' ? null : h('span', { className: 'dsh-git-sign' }, row.sign),
							h('span', { className: 'dsh-git-text' }, row.text === '' ? ' ' : row.text),
						),
					),
				);
			}

			/** The tab body: Changes and History for one working copy. */
			function GitTabBody(props) {
				const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
				const params = info !== undefined && info.tab !== undefined && info.tab !== null && info.tab.navigation !== undefined ? info.tab.navigation.params : undefined;
				const sessionCwd = useSessionCwd(ctx, props.sessionId);
				const cwd = params !== undefined && params !== null && typeof params.cwd === 'string' ? params.cwd : sessionCwd;
				const { data, snapshot } = useRepo(store, cwd);

				const [view, setView] = useState('changes');
				const [reload, setReload] = useState(0);
				const [focusPath, setFocusPath] = useState(null);
				const [diff, setDiff] = useState({ loading: true, patch: '', error: null, truncated: false });
				const [log, setLog] = useState({ loading: true, commits: [], error: null });
				const [detail, setDetail] = useState({ hash: null, loading: false, commit: null, error: null });

				const ready = data !== null && data.isRepo === true;

				useEffect(() => {
					if (!ready) return undefined;
					let live = true;
					setDiff((previous) => Object.assign({}, previous, { loading: true, error: null }));
					api('diff', { cwd, mode: 'worktree', path: focusPath === null ? undefined : focusPath }).then(
						(result) => {
							if (live) setDiff({ loading: false, patch: result.patch, truncated: result.truncated === true, error: null });
						},
						(error) => {
							if (live) setDiff({ loading: false, patch: '', truncated: false, error: String(error.message === undefined ? error : error.message) });
						},
					);
					return () => {
						live = false;
					};
				}, [cwd, ready, focusPath, reload, data === null ? null : data.changed]);

				useEffect(() => {
					if (!ready) return undefined;
					let live = true;
					setLog((previous) => Object.assign({}, previous, { loading: true, error: null }));
					api('log', { cwd, limit: 60 }).then(
						(result) => {
							if (live) setLog({ loading: false, commits: result.commits, error: null });
						},
						(error) => {
							if (live) setLog({ loading: false, commits: [], error: String(error.message === undefined ? error : error.message) });
						},
					);
					return () => {
						live = false;
					};
				}, [cwd, ready, reload]);

				useEffect(() => {
					if (detail.hash === null) return undefined;
					let live = true;
					setDetail((previous) => Object.assign({}, previous, { loading: true, error: null, commit: null }));
					api('commit', { cwd, hash: detail.hash }).then(
						(commit) => {
							if (live) setDetail({ hash: detail.hash, loading: false, commit, error: null });
						},
						(error) => {
							if (live) setDetail({ hash: detail.hash, loading: false, commit: null, error: String(error.message === undefined ? error : error.message) });
						},
					);
					return () => {
						live = false;
					};
				}, [cwd, detail.hash]);

				const refreshAll = () => {
					store.load(cwd, true);
					setReload((value) => value + 1);
				};

				const head = h(
					'div',
					{ className: 'dsh-git-head', key: 'head' },
					h(
						'div',
						{ className: 'dsh-git-repo' },
						branchIcon(12),
						h('span', null, data !== null && data.name !== null && data.name !== undefined ? data.name : 'git'),
					),
					data !== null && data.isRepo === true
						? h(
								'div',
								{ className: 'dsh-git-branch', title: data.branch },
								h('span', null, data.branch === '' ? 'HEAD' : data.branch),
								data.ahead > 0 ? h('span', { key: 'a', className: 'dsh-git-sync' }, '\u2191' + data.ahead) : null,
								data.behind > 0 ? h('span', { key: 'b', className: 'dsh-git-sync' }, '\u2193' + data.behind) : null,
							)
						: null,
					h('span', { className: 'dsh-git-grow' }),
					h(
						'div',
						{ className: 'dsh-git-seg' },
						h(
							'button',
							{
								type: 'button',
								'data-active': view === 'changes' ? 'true' : 'false',
								onClick: () => {
									setView('changes');
									setDetail({ hash: null, loading: false, commit: null, error: null });
								},
							},
							t('changes'),
							data !== null && data.changed > 0 ? ' ' + data.changed : '',
						),
						h(
							'button',
							{
								type: 'button',
								'data-active': view === 'history' ? 'true' : 'false',
								onClick: () => {
									setView('history');
								},
							},
							t('history'),
						),
					),
					h(
						'button',
						{ type: 'button', className: 'dsh-git-icon', title: t('refresh'), 'aria-label': t('refresh'), onClick: refreshAll },
						refreshIcon(14),
					),
				);

				let body;
				if (data === null) {
					body = h('div', { className: 'dsh-git-empty' }, snapshot.error !== null ? snapshot.error : t('loading'));
				} else if (data.isRepo !== true) {
					body = h('div', { className: 'dsh-git-empty' }, t('notRepo'));
				} else if (detail.hash !== null) {
					body = h(CommitDetail, { detail, onBack: () => setDetail({ hash: null, loading: false, commit: null, error: null }) });
				} else if (view === 'history') {
					body = h(
						'div',
						{ className: 'dsh-git-scroll' },
						log.error === null ? null : h('div', { className: 'dsh-git-error' }, log.error),
						log.commits.length === 0
							? h('div', { className: 'dsh-git-empty' }, log.loading ? t('loading') : t('noHistory'))
							: log.commits.map((commit) =>
									h(
										'button',
										{
											key: commit.hash,
											type: 'button',
											className: 'dsh-git-commit',
											onClick: () => {
												setDetail({ hash: commit.hash, loading: true, commit: null, error: null });
											},
										},
										h('span', { className: 'dsh-git-hash' }, commit.short),
										h(
											'span',
											{ className: 'dsh-git-commit-main' },
											h('span', { className: 'dsh-git-subject' }, commit.subject),
											h('span', { className: 'dsh-git-meta' }, commit.author + ' \u00b7 ' + formatWhen(commit.date)),
										),
									),
								),
					);
				} else {
					body = h(
						'div',
						{ className: 'dsh-git-scroll' },
						data.files.length === 0
							? h('div', { className: 'dsh-git-empty' }, t('clean'))
							: h(
									'div',
									{ className: 'dsh-git-files' },
									data.files.map((file) => {
										const status = describeStatus(file);
										return h(
											'button',
											{
												key: file.path,
												type: 'button',
												className: 'dsh-git-file',
												'data-active': focusPath === file.path ? 'true' : 'false',
												title: file.path,
												onClick: () => {
													setFocusPath(focusPath === file.path ? null : file.path);
												},
											},
											h('span', { className: 'dsh-git-file-status', 'data-kind': status.kind }, status.letter),
											h('span', { className: 'dsh-git-file-path' }, file.from === null || file.from === undefined ? file.path : file.from + ' \u2192 ' + file.path),
											file.untracked === true ? h('span', { className: 'dsh-git-file-note' }, t('untracked')) : null,
										);
									}),
								),
						diff.error === null ? null : h('div', { className: 'dsh-git-error' }, diff.error),
						diff.loading ? h('div', { className: 'dsh-git-empty' }, t('loading')) : h(PatchView, { patch: diff.patch }),
						diff.truncated ? h('div', { className: 'dsh-git-empty' }, t('truncated')) : null,
					);
				}

				return h('div', { className: 'dsh-git-tab' }, head, h('div', { className: 'dsh-git-body' }, body));
			}

			/** One commit: message, file list, patch. */
			function CommitDetail(props) {
				const detail = props.detail;
				if (detail.loading === true) return h('div', { className: 'dsh-git-empty' }, t('loading'));
				if (detail.error !== null) {
					return h(
						'div',
						{ className: 'dsh-git-scroll' },
						h('div', { className: 'dsh-git-detail-head' }, h(BackLink, { onBack: props.onBack })),
						h('div', { className: 'dsh-git-error' }, detail.error),
					);
				}
				const commit = detail.commit;
				if (commit === null || commit === undefined) return h('div', { className: 'dsh-git-empty' }, t('loading'));
				return h(
					'div',
					{ className: 'dsh-git-scroll' },
					h(
						'div',
						{ className: 'dsh-git-detail-head' },
						h('div', { className: 'dsh-git-detail-top' }, h(BackLink, { onBack: props.onBack }), h('span', { className: 'dsh-git-hash' }, commit.short)),
						h('div', { className: 'dsh-git-subject' }, commit.subject),
						h('div', { className: 'dsh-git-meta' }, commit.author + ' \u00b7 ' + formatWhen(commit.date)),
						commit.body === '' ? null : h('div', { className: 'dsh-git-meta' }, commit.body),
					),
					commit.files.length === 0
						? null
						: h(
								'div',
								{ className: 'dsh-git-files' },
								commit.files.map((file) =>
									h(
										'div',
										{ key: file.path, className: 'dsh-git-file' },
										h('span', { className: 'dsh-git-file-path' }, file.path),
										h(
											'span',
											{ className: 'dsh-git-file-note' },
											file.additions === null ? 'bin' : '+' + file.additions + ' -' + file.deletions,
										),
									),
								),
							),
					h(PatchView, { patch: commit.patch }),
				);
			}

			/** The one control shared by both detail states. */
			function BackLink(props) {
				return h('button', { type: 'button', className: 'dsh-git-link', onClick: props.onBack }, '\u2190 ' + t('back'));
			}

			const disposers = [];
			disposers.push(
				ctx.slots.inject('conversation.input.dock', () =>
					ctx.slots.register(
						{ name: 'conversation.input.dock', id: 'dsh-git-chip', order: 20, registrant: 'dsh-git' },
						GitChip,
					),
				),
			);
			disposers.push(
				ctx.slots.inject('conversation.session.header.utilities', () =>
					ctx.slots.register(
						{ name: 'conversation.session.header.utilities', id: 'dsh-git-button', order: 10, registrant: 'dsh-git' },
						GitHeaderButton,
					),
				),
			);

			ctx.inject(['sidebarRightTabs'], (scope) => {
				scope.effect(() => {
					const tabs = scope.get('sidebarRightTabs');
					if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return () => {};
					const definition = {
						id: TAB_ID,
						kind: TAB_ID,
						priority: 'extension',
						title: () => translate('tab.title'),
					};
					const disposeType = tabs.register(definition);
					const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () =>
						ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, GitTabBody),
					);
					return () => {
						disposeBody();
						disposeType();
					};
				}, 'dsh-git: sidebar tab');
			});

			return () => {
				for (const dispose of disposers) {
					try {
						dispose();
					} catch (error) {
						console.error('dsh-git: dispose failed', error);
					}
				}
			};
		}

		exports.apply = apply;
		exports.inject = ['slots', 'sessions', 'locale'];
		return module.exports;
	},
});
