/**
 * dsh-git - browser half.
 *
 * Three seats, one git surface:
 *
 *   conversation.input.right              repo/branch chip left of the model pill
 *   conversation.session.header.utilities the header button that opens the panel
 *   sidebar.right.pane.tab                the native right-sidebar tab (fallback)
 *   betterSidebar.registerTab             the same panel inside dsh-better-sidebar
 *
 * The panel is a split view: staging + changes top-left, history top-right,
 * the selected file's diff across the bottom half.
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
		const LOG_LIMIT = 60;

		const EN = {
			"tab.title": "Git",
			"chip.title": "Open the git panel",
			"header.title": "Git changes and history",
			"changes": "Changes",
			"history": "History",
			"refresh": "Refresh",
			"loading": "Loading...",
			"notRepo": "This project is not a git repository.",
			"clean": "Working tree clean.",
			"noHistory": "No commits yet.",
			"noMatches": "No commit matches the filter.",
			"untracked": "Untracked",
			"staged": "Staged",
			"unstaged": "Changes",
			"conflicted": "Conflicts",
			"truncated": "Diff truncated for display.",
			"filesChanged": "{n} changed",
			"noDiff": "Select a file or a commit to see its diff.",
			"unborn": "No commits yet",
			"stageAll": "Stage all",
			"unstageAll": "Unstage all",
			"stage": "Stage",
			"unstage": "Unstage",
			"discard": "Discard changes",
			"commitPlaceholder": "Commit message",
			"commit": "Commit",
			"committing": "Committing...",
			"generate": "AI message",
			"generating": "Generating...",
			"generated": "Message generated - review before committing.",
			"committed": "Committed.",
			"stagedDone": "Staged.",
			"unstagedDone": "Unstaged.",
			"discarded": "Changes discarded.",
			"switched": "Switched branch.",
			"resetDone": "Reset done.",
			"revertDone": "Reverted.",
			"filter": "Filter commits",
			"branch": "Branch",
			"copyHash": "Copy commit id",
			"resetSoft": "Reset --soft to here",
			"resetMixed": "Reset --mixed to here",
			"resetHard": "Reset --hard to here",
			"revert": "Revert this commit",
			"emptyMessage": "Write a commit message first.",
			"noStaged": "Stage something first, or tick commit-all.",
			"commitAll": "Commit all changes",
			"files": "{n} files",
			"diffOf": "Diff",
			"commitDiff": "Commit",
			"stagedDiff": "Staged",
			"other": "other",
		};
		const ZH = {
			"tab.title": "Git",
			"chip.title": "打开 Git 面板",
			"header.title": "Git 改动与历史",
			"changes": "改动",
			"history": "历史",
			"refresh": "刷新",
			"loading": "加载中...",
			"notRepo": "当前项目不是 git 仓库。",
			"clean": "工作区干净。",
			"noHistory": "还没有提交。",
			"noMatches": "没有匹配的提交。",
			"untracked": "未跟踪",
			"staged": "已暂存",
			"unstaged": "未暂存",
			"conflicted": "冲突",
			"truncated": "差异过大，仅展示前一部分。",
			"filesChanged": "{n} 个文件改动",
			"noDiff": "点选文件或提交查看差异。",
			"unborn": "还没有提交",
			"stageAll": "全部暂存",
			"unstageAll": "全部取消暂存",
			"stage": "暂存",
			"unstage": "取消暂存",
			"discard": "丢弃改动",
			"commitPlaceholder": "提交信息",
			"commit": "提交",
			"committing": "提交中...",
			"generate": "AI 生成",
			"generating": "生成中...",
			"generated": "已生成提交信息，确认后再提交。",
			"committed": "已提交。",
			"stagedDone": "已暂存。",
			"unstagedDone": "已取消暂存。",
			"discarded": "已丢弃改动。",
			"switched": "已切换分支。",
			"resetDone": "已重置。",
			"revertDone": "已回退该提交。",
			"filter": "筛选提交",
			"branch": "分支",
			"copyHash": "复制提交号",
			"resetSoft": "软重置到此提交 (--soft)",
			"resetMixed": "混合重置到此提交 (--mixed)",
			"resetHard": "硬重置到此提交 (--hard)",
			"revert": "回退（revert）此提交",
			"emptyMessage": "请先填写提交信息。",
			"noStaged": "先暂存改动，或勾选提交全部。",
			"commitAll": "提交全部改动",
			"files": "{n} 个文件",
			"diffOf": "差异",
			"commitDiff": "提交",
			"stagedDiff": "暂存",
			"other": "其他",
		};

		const CSS = [
			'.dsh-git-chip-wrap { display: inline-flex; align-items: center; min-width: 0; }',
			'.dsh-git-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 220px; min-height: 24px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); line-height: 1; cursor: pointer; }',
			'.dsh-git-chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-chip > svg { flex: none; opacity: 0.85; }',
			'.dsh-git-chip-repo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 96px; }',
			'.dsh-git-chip-slash { opacity: 0.5; }',
			'.dsh-git-chip-branch { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-sync { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }',
			'.dsh-git-header { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
			'.dsh-git-header:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-header .dsh-git-dot { position: absolute; top: 5px; right: 4px; }',
			'.dsh-git-panel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); gap: 1px; height: 100%; min-height: 420px; background: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }',
			'.dsh-git-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-base); }',
			'.dsh-git-pane[data-area="diff"] { grid-column: 1 / -1; }',
			'.dsh-git-pane-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
			'.dsh-git-pane-title { flex: none; font: var(--dsw-font-xxs-strong-12); }',
			'.dsh-git-count { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-grow { flex: 1; min-width: 0; }',
			'.dsh-git-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }',
			'.dsh-git-group-head { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 6px 0 10px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-file { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; padding: 0 6px 0 10px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); text-align: left; cursor: pointer; }',
			'.dsh-git-file:hover { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-file[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-file-status { flex: none; width: 12px; text-align: center; font-family: var(--ds-font-family-code, monospace); font-weight: 600; }',
			'.dsh-git-file-status[data-kind="add"] { color: var(--dsw-alias-state-success-primary); }',
			'.dsh-git-file-status[data-kind="del"] { color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-file-status[data-kind="mod"] { color: var(--dsw-alias-state-business-primary); }',
			'.dsh-git-file-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }',
			'.dsh-git-file-note { flex: none; color: var(--dsw-alias-label-tertiary); }',
			'.dsh-git-file-actions { flex: none; display: none; gap: 2px; }',
			'.dsh-git-file:hover .dsh-git-file-actions, .dsh-git-file[data-active="true"] .dsh-git-file-actions { display: inline-flex; }',
			'.dsh-git-mini { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); cursor: pointer; }',
			'.dsh-git-mini:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-mini[data-danger="true"]:hover { color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); cursor: pointer; }',
			'.dsh-git-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-btn:disabled { opacity: 0.45; cursor: default; }',
			'.dsh-git-btn[data-variant="primary"] { border-color: transparent; background: var(--dsw-alias-state-business-primary); color: #ffffff; }',
			'.dsh-git-btn[data-variant="primary"]:hover:not(:disabled) { background: var(--dsw-alias-state-business-primary); color: #ffffff; filter: brightness(1.06); }',
			'.dsh-git-btn[data-variant="ghost"] { border-color: transparent; }',
			'.dsh-git-composer { flex: none; display: flex; flex-direction: column; gap: 5px; padding: 6px 8px 8px; border-top: 1px solid var(--dsw-alias-border-l1); }',
			'.dsh-git-textarea { width: 100%; box-sizing: border-box; min-height: 46px; max-height: 132px; resize: vertical; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); line-height: 1.45; outline: none; }',
			'.dsh-git-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }',
			'.dsh-git-composer-row { display: flex; align-items: center; gap: 6px; }',
			'.dsh-git-check { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); cursor: pointer; user-select: none; }',
			'.dsh-git-check > input { margin: 0; }',
			'.dsh-git-search { flex: 1; min-width: 0; height: 22px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11); outline: none; box-sizing: border-box; }',
			'.dsh-git-search:focus { border-color: var(--dsw-alias-state-business-primary); }',
			'.dsh-git-commit-block { border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent); }',
			'.dsh-git-commit { display: flex; align-items: flex-start; gap: 6px; width: 100%; padding: 5px 8px 5px 10px; border: none; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; cursor: pointer; }',
			'.dsh-git-commit:hover { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-commit[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }',
			'.dsh-git-chevron { flex: none; width: 10px; padding-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 9px; line-height: 1; }',
			'.dsh-git-hash { flex: none; padding-top: 1px; color: var(--dsw-alias-label-tertiary); font-family: var(--ds-font-family-code, monospace); font-size: 11px; }',
			'.dsh-git-commit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
			'.dsh-git-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.dsh-git-meta { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.dsh-git-refs { flex: none; display: inline-flex; gap: 3px; }',
			'.dsh-git-ref { padding: 0 4px; border-radius: 4px; color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-commit-files { padding: 1px 0 4px 24px; }',
			'.dsh-git-patch { padding: 4px 0 12px; font-family: var(--ds-font-family-code, monospace); font-size: 11px; }',
			'.dsh-git-row { display: flex; gap: 6px; padding: 0 10px; line-height: 17px; }',
			'.dsh-git-row[data-kind="add"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); color: var(--dsw-alias-state-success-primary); }',
			'.dsh-git-row[data-kind="del"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-row[data-kind="hunk"] { color: var(--dsw-alias-label-tertiary); background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 6%, transparent); }',
			'.dsh-git-row[data-kind="context"] { color: var(--dsw-alias-label-secondary); }',
			'.dsh-git-row[data-kind="file"] { margin-top: 6px; padding-top: 2px; padding-bottom: 2px; color: var(--dsw-alias-label-primary); font-weight: 600; }',
			'.dsh-git-sign { flex: none; width: 1ch; user-select: none; }',
			'.dsh-git-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }',
			'.dsh-git-empty { display: flex; align-items: center; justify-content: center; min-height: 80px; padding: 18px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); text-align: center; }',
			'.dsh-git-error { margin: 6px 8px; padding: 5px 7px; border-radius: 4px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); font: var(--dsw-font-xxxs-11); white-space: pre-wrap; overflow-wrap: anywhere; }',
			'.dsh-git-notice { margin: 6px 8px; padding: 5px 7px; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-badge { flex: none; padding: 0 5px; border-radius: 4px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-diff-head { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }',
			'.dsh-git-diff-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); }',
			'.dsh-git-menu { position: fixed; z-index: 60; min-width: 176px; padding: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 24px rgba(0,0,0,0.18); }',
			'.dsh-git-menu > button { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; padding: 0 8px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); text-align: left; cursor: pointer; }',
			'.dsh-git-menu > button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
			'.dsh-git-menu > button[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }',
			'.dsh-git-menu-sep { height: 1px; margin: 4px 2px; background: var(--dsw-alias-border-l1); }',
			'.dsh-git-menu-title { padding: 2px 8px 4px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
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
		 * One shared repo-state store: the chip, the header button and every panel
		 * read the same snapshot, so a poll costs one request, not three.
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
				put: (data) => {
					publish({ cwd: data !== null && data !== undefined && typeof data.cwd === 'string' ? data.cwd : state.cwd, data, error: null, loading: false, at: Date.now() });
				},
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
		function useRepo(store, cwd, enabled) {
			const subscribe = useCallback((listener) => store.subscribe(listener), [store]);
			const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
			const active = enabled !== false;
			useEffect(() => {
				if (cwd === undefined || active === false) return undefined;
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
			}, [store, cwd, active]);
			const data = snapshot.cwd === cwd ? snapshot.data : null;
			return { data, snapshot, stale: snapshot.cwd !== cwd };
		}

		/** Open the git panel: better-sidebar first, native right sidebar otherwise. */
		function openGitPanel(ctx, cwd, sessionId) {
			const better = ctx.get('betterSidebar');
			if (better !== undefined && better !== null && typeof better.openTab === 'function') {
				try {
					better.openTab(
						{ type: TAB_ID, title: 'Git', id: TAB_ID + ':' + (sessionId === undefined ? 'global' : sessionId), meta: cwd === undefined ? undefined : { cwd } },
						sessionId === undefined ? undefined : { sessionId },
					);
					return true;
				} catch (error) {
					console.warn('dsh-git: better-sidebar refused the tab', error);
				}
			}
			const nav = ctx.get('sidebarRight');
			if (nav === undefined || nav === null || typeof nav.openTab !== 'function') {
				console.warn('dsh-git: no sidebar surface is available');
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

		/** Circular arrow for the refresh control. */
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

		/** Plus glyph: stage. */
		function plusIcon(size) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true', focusable: 'false' },
				h('path', { key: 'a', d: 'M8 3.5v9' }),
				h('path', { key: 'b', d: 'M3.5 8h9' }),
			);
		}

		/** Minus glyph: unstage. */
		function minusIcon(size) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true', focusable: 'false' },
				h('path', { key: 'a', d: 'M3.5 8h9' }),
			);
		}

		/** Sparkle glyph: ask the model for a commit message. */
		function sparkIcon(size) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
				h('path', { key: 'a', d: 'M8 2.2l1.5 3.6 3.6 1.5-3.6 1.5L8 12.4 6.5 8.8 2.9 7.3l3.6-1.5z' }),
				h('path', { key: 'b', d: 'M12.6 11.2l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z' }),
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

		/** The porcelain status letters, folded into one display letter and a hue. */
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

		/** The language the panel asks the model to answer in. */
		function uiLanguage() {
			const nav = typeof navigator === 'undefined' ? undefined : navigator.language;
			return typeof nav === 'string' && nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
		}

		/** Module body: wire the seats onto one shared store. */
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

			/** The chip: repo name, branch, drift, dirty dot. */
			function GitChip(props) {
				const sessionId = props.sessionId;
				const cwd = useSessionCwd(ctx, sessionId);
				const { data } = useRepo(store, cwd);
				if (data === null || data.isRepo !== true) return null;
				const dirty = data.changed > 0;
				const title = data.root + '  ' + (dirty ? 'dirty' : 'clean') + '  ' + t('chip.title');
				return h(
					'span',
					{ className: 'dsh-git-chip-wrap' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-git-chip',
							title,
							'aria-label': t('chip.title'),
							onClick: () => {
								openGitPanel(ctx, cwd, sessionId);
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

			/** The header button that opens the same panel. */
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
							openGitPanel(ctx, cwd, sessionId);
						},
					},
					branchIcon(15),
					dirty ? h('span', { key: 'dot', className: 'dsh-git-dot' }) : null,
				);
			}

			/** Render one patch as rows. */
			function PatchView(props) {
				const rows = useMemo(() => parsePatch(props.patch), [props.patch]);
				if (rows.length === 0) return h('div', { className: 'dsh-git-empty' }, props.empty === undefined ? t('noDiff') : props.empty);
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

			/**
			 * The panel. The 'visible' prop pauses polling when the host keeps a hidden
			 * tab mounted; 'cwd' may be handed in by better-sidebar's scope.
			 */
			function GitPanel(props) {
				const visible = props.visible !== false;
				const sessionCwd = useSessionCwd(ctx, props.sessionId);
				const cwd = typeof props.cwd === 'string' && props.cwd !== '' ? props.cwd : sessionCwd;
				const { data } = useRepo(store, cwd, visible);

				const [version, setVersion] = useState(0);
				const [commits, setCommits] = useState({ loading: true, rows: [], error: null });
				const [search, setSearch] = useState('');
				const [selection, setSelection] = useState(null);
				const [expanded, setExpanded] = useState({});
				const [diff, setDiff] = useState({ loading: false, patch: '', truncated: false, error: null });
				const [message, setMessage] = useState('');
				const [commitAll, setCommitAll] = useState(false);
				const [busy, setBusy] = useState('');
				const [notice, setNotice] = useState(null);
				const [menu, setMenu] = useState(null);

				const branch = data !== null && data !== undefined && typeof data.branch === 'string' ? data.branch : '';

				const refresh = useCallback(() => {
					if (cwd !== undefined) store.load(cwd, true);
					setVersion((value) => value + 1);
				}, [cwd]);

				useEffect(() => {
					if (cwd === undefined || visible === false) return undefined;
					let dropped = false;
					setCommits((current) => Object.assign({}, current, { loading: true }));
					api('log', { cwd, ref: branch === '' ? undefined : branch, search: search.trim() === '' ? undefined : search.trim(), limit: LOG_LIMIT }).then(
						(result) => {
							if (dropped) return;
							setCommits({ loading: false, rows: Array.isArray(result.commits) ? result.commits : [], error: null });
						},
						(error) => {
							if (dropped) return;
							setCommits({ loading: false, rows: [], error: error === null || error === undefined ? 'log failed' : error.message });
						},
					);
					return () => {
						dropped = true;
					};
				}, [cwd, branch, search, version, visible]);

				useEffect(() => {
					if (selection === null || cwd === undefined) {
						setDiff({ loading: false, patch: '', truncated: false, error: null });
						return undefined;
					}
					let dropped = false;
					setDiff({ loading: true, patch: '', truncated: false, error: null });
					const request = selection.kind === 'commit' ? api('commit', { cwd, hash: selection.hash }) : api('diff', { cwd, mode: selection.kind === 'staged' ? 'staged' : 'worktree', path: selection.path });
					request.then(
						(result) => {
							if (dropped) return;
							setDiff({ loading: false, patch: typeof result.patch === 'string' ? result.patch : '', truncated: result.truncated === true, error: null });
						},
						(error) => {
							if (dropped) return;
							setDiff({ loading: false, patch: '', truncated: false, error: error === null || error === undefined ? 'diff failed' : error.message });
						},
					);
					return () => {
						dropped = true;
					};
				}, [cwd, selection, version]);

				const mutate = useCallback(
					(method, body, done) => {
						if (cwd === undefined) return;
						setBusy(method);
						setNotice(null);
						api(method, Object.assign({ cwd }, body)).then(
							(result) => {
								setBusy('');
								if (result !== null && result !== undefined && typeof result.isRepo === 'boolean') store.put(result);
								if (done !== undefined) setNotice(t(done));
								refresh();
							},
							(error) => {
								setBusy('');
								setNotice(error === null || error === undefined ? 'failed' : error.message);
							},
						);
					},
					[cwd, refresh],
				);

				useEffect(() => {
					if (menu === null) return undefined;
					const close = () => setMenu(null);
					const onKey = (event) => {
						if (event.key === 'Escape') close();
					};
					window.addEventListener('click', close);
					window.addEventListener('keydown', onKey);
					return () => {
						window.removeEventListener('click', close);
						window.removeEventListener('keydown', onKey);
					};
				}, [menu]);

				const staged = [];
				const changed = [];
				if (data !== null && data !== undefined && Array.isArray(data.files)) {
					for (const file of data.files) {
						if (file.conflicted === true) {
							changed.push(file);
							continue;
						}
						if (file.staged === true) staged.push(file);
						if (file.unstaged === true || file.untracked === true) changed.push(file);
					}
				}

				const toggleCommit = (hash) => {
					setSelection({ kind: 'commit', hash });
					setExpanded((current) => {
						const next = Object.assign({}, current);
						if (next[hash] !== undefined) {
							delete next[hash];
							return next;
						}
						next[hash] = { loading: true, files: [] };
						api('commit-files', { cwd, hash }).then(
							(result) => {
								setExpanded((latest) => {
									if (latest[hash] === undefined) return latest;
									const updated = Object.assign({}, latest);
									updated[hash] = { loading: false, files: Array.isArray(result.files) ? result.files : [] };
									return updated;
								});
							},
							() => {
								setExpanded((latest) => {
									if (latest[hash] === undefined) return latest;
									const updated = Object.assign({}, latest);
									updated[hash] = { loading: false, files: [] };
									return updated;
								});
							},
						);
						return next;
					});
				};

				const onCommitContext = (event, commit) => {
					event.preventDefault();
					setSelection({ kind: 'commit', hash: commit.hash });
					setMenu({ x: event.clientX, y: event.clientY, hash: commit.hash, short: commit.short, subject: commit.subject });
				};

				const generate = () => {
					if (cwd === undefined) return;
					setBusy('suggest');
					setNotice(null);
					api('suggest', { cwd, sessionId: props.sessionId, language: uiLanguage() }).then(
						(result) => {
							setBusy('');
							setMessage(typeof result.message === 'string' ? result.message : '');
							setNotice(t('generated'));
						},
						(error) => {
							setBusy('');
							setNotice(error === null || error === undefined ? 'suggest failed' : error.message);
						},
					);
				};

				const submit = () => {
					if (message.trim() === '') {
						setNotice(t('emptyMessage'));
						return;
					}
					if (staged.length === 0 && commitAll === false) {
						setNotice(t('noStaged'));
						return;
					}
					mutate('commit-create', { message, all: commitAll }, 'committed');
					setMessage('');
				};

				if (data === null || data === undefined) {
					return h('div', { className: 'dsh-git-panel' }, h('div', { className: 'dsh-git-pane', 'data-area': 'changes' }, h('div', { className: 'dsh-git-empty' }, t('loading'))));
				}
				if (data.isRepo !== true) {
					return h('div', { className: 'dsh-git-panel' }, h('div', { className: 'dsh-git-pane' }, h('div', { className: 'dsh-git-empty' }, t('notRepo'))));
				}

				const activePath = selection !== null && selection.path !== undefined ? selection.path : null;

				/** One file row, shared by the staged and the changed group. */
				const fileRow = (file, group) => {
					const status = describeStatus(file);
					const active = selection !== null && selection.kind === group && selection.path === file.path;
					return h(
						'div',
						{
							key: group + ':' + file.path,
							className: 'dsh-git-file',
							'data-active': active ? 'true' : 'false',
							role: 'button',
							tabIndex: 0,
							title: file.path,
							onClick: () => setSelection({ kind: group, path: file.path }),
							onKeyDown: (event) => {
								if (event.key === 'Enter' || event.key === ' ') setSelection({ kind: group, path: file.path });
							},
						},
						h('span', { key: 'status', className: 'dsh-git-file-status', 'data-kind': status.kind }, status.letter),
						h('span', { key: 'path', className: 'dsh-git-file-path' }, file.path),
						h(
							'span',
							{ key: 'actions', className: 'dsh-git-file-actions' },
							group === 'staged'
								? h(
										'button',
										{
											key: 'unstage',
											type: 'button',
											className: 'dsh-git-mini',
											title: t('unstage'),
											'aria-label': t('unstage'),
											onClick: (event) => {
												event.stopPropagation();
												mutate('unstage', { paths: [file.path] }, 'unstagedDone');
											},
										},
										minusIcon(11),
									)
								: h(
										'button',
										{
											key: 'stage',
											type: 'button',
											className: 'dsh-git-mini',
											title: t('stage'),
											'aria-label': t('stage'),
											onClick: (event) => {
												event.stopPropagation();
												mutate('stage', { paths: [file.path] }, 'stagedDone');
											},
										},
										plusIcon(11),
									),
							file.untracked === true
								? null
								: h(
										'button',
										{
											key: 'discard',
											type: 'button',
											className: 'dsh-git-mini',
											'data-danger': 'true',
											title: t('discard'),
											'aria-label': t('discard'),
											onClick: (event) => {
												event.stopPropagation();
												mutate('discard', { paths: [file.path] }, 'discarded');
											},
										},
										'\u00d7',
									),
						),
					);
				};

				const stageAll = () => {
					const paths = changed.map((file) => file.path);
					if (paths.length > 0) mutate('stage', { paths }, 'stagedDone');
				};
				const unstageAll = () => {
					const paths = staged.map((file) => file.path);
					if (paths.length > 0) mutate('unstage', { paths }, 'unstagedDone');
				};

				return h(
					'div',
					{ className: 'dsh-git-panel' },
					h(
						'div',
						{ className: 'dsh-git-pane', 'data-area': 'changes' },
						h(
							'div',
							{ className: 'dsh-git-pane-head' },
							h('span', { className: 'dsh-git-pane-title' }, t('changes')),
							h('span', { className: 'dsh-git-count' }, data.changed > 0 ? fill(t('filesChanged'), { n: data.changed }) : ''),
							h('span', { className: 'dsh-git-grow' }),
							h('button', { type: 'button', className: 'dsh-git-mini', title: t('refresh'), 'aria-label': t('refresh'), onClick: () => refresh() }, refreshIcon(13)),
						),
						h(
							'div',
							{ className: 'dsh-git-scroll' },
							staged.length === 0 && changed.length === 0 ? h('div', { className: 'dsh-git-empty' }, t('clean')) : null,
							staged.length === 0
								? null
								: h(
										'div',
										{ key: 'staged-group' },
										h(
											'div',
											{ className: 'dsh-git-group-head' },
											h('span', { key: 'label' }, t('staged') + ' ' + staged.length),
											h('span', { key: 'grow', className: 'dsh-git-grow' }),
											h('button', { key: 'all', type: 'button', className: 'dsh-git-btn', onClick: unstageAll }, t('unstageAll')),
										),
										staged.map((file) => fileRow(file, 'staged')),
									),
							changed.length === 0
								? null
								: h(
										'div',
										{ key: 'changed-group' },
										h(
											'div',
											{ className: 'dsh-git-group-head' },
											h('span', { key: 'label' }, t('unstaged') + ' ' + changed.length),
											h('span', { key: 'grow', className: 'dsh-git-grow' }),
											h('button', { key: 'all', type: 'button', className: 'dsh-git-btn', onClick: stageAll }, t('stageAll')),
										),
										changed.map((file) => fileRow(file, 'worktree')),
									),
							notice === null ? null : h('div', { key: 'notice', className: 'dsh-git-notice' }, notice),
						),
						h(
							'div',
							{ className: 'dsh-git-composer' },
							h('textarea', {
								className: 'dsh-git-textarea',
								value: message,
								placeholder: t('commitPlaceholder'),
								spellCheck: false,
								onChange: (event) => setMessage(event.target.value),
								onKeyDown: (event) => {
									if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
										event.preventDefault();
										submit();
									}
								},
							}),
							h(
								'div',
								{ className: 'dsh-git-composer-row' },
								h(
									'button',
									{ type: 'button', className: 'dsh-git-btn', 'data-variant': 'ghost', disabled: busy === 'suggest', title: t('generate'), onClick: generate },
									sparkIcon(12),
									busy === 'suggest' ? t('generating') : t('generate'),
								),
								h(
									'label',
									{ className: 'dsh-git-check' },
									h('input', { type: 'checkbox', checked: commitAll, onChange: (event) => setCommitAll(event.target.checked) }),
									t('commitAll'),
								),
								h('span', { className: 'dsh-git-grow' }),
								h(
									'button',
									{ type: 'button', className: 'dsh-git-btn', 'data-variant': 'primary', disabled: busy === 'commit-create' || message.trim() === '', onClick: submit },
									busy === 'commit-create' ? t('committing') : t('commit'),
								),
							),
						),
					),
					h(
						'div',
						{ className: 'dsh-git-pane', 'data-area': 'history' },
						h(
							'div',
							{ className: 'dsh-git-pane-head' },
							h('span', { className: 'dsh-git-pane-title' }, t('history')),
							h('span', { className: 'dsh-git-grow' }),
							h('input', {
								className: 'dsh-git-search',
								value: search,
								placeholder: t('filter'),
								spellCheck: false,
								onChange: (event) => setSearch(event.target.value),
							}),
						),
						commits.error === null ? null : h('div', { className: 'dsh-git-error' }, commits.error),
						h(
							'div',
							{ className: 'dsh-git-scroll' },
							commits.rows.length === 0
								? h('div', { className: 'dsh-git-empty' }, commits.loading === true ? t('loading') : search.trim() === '' ? t('noHistory') : t('noMatches'))
								: commits.rows.map((commit) => {
										const open = expanded[commit.hash];
										const active = selection !== null && selection.kind === 'commit' && selection.hash === commit.hash;
										const refs = typeof commit.refs === 'string' && commit.refs !== '' ? commit.refs.split(', ').filter((ref) => ref !== '') : [];
										return h(
											'div',
											{ key: commit.hash, className: 'dsh-git-commit-block' },
											h(
												'div',
												{
													className: 'dsh-git-commit',
													role: 'button',
													tabIndex: 0,
													'data-active': active ? 'true' : 'false',
													title: commit.subject,
													onClick: () => toggleCommit(commit.hash),
													onKeyDown: (event) => {
														if (event.key === 'Enter') toggleCommit(commit.hash);
													},
													onContextMenu: (event) => onCommitContext(event, commit),
												},
												h('span', { key: 'chevron', className: 'dsh-git-chevron' }, open === undefined ? '\u25b8' : '\u25be'),
												h('span', { key: 'hash', className: 'dsh-git-hash' }, commit.short),
												h(
													'span',
													{ key: 'main', className: 'dsh-git-commit-main' },
													h('span', { key: 'subject', className: 'dsh-git-subject' }, commit.subject),
													h('span', { key: 'meta', className: 'dsh-git-meta' }, (commit.author === undefined ? '' : commit.author) + ' \u00b7 ' + formatWhen(commit.date)),
												),
												refs.length === 0
													? null
													: h(
															'span',
															{ key: 'refs', className: 'dsh-git-refs' },
															refs.slice(0, 3).map((ref) => h('span', { key: ref, className: 'dsh-git-ref' }, ref.replace('HEAD -> ', ''))),
														),
											),
											open === undefined
												? null
												: h(
														'div',
														{ key: 'files', className: 'dsh-git-commit-files' },
														open.loading === true
															? h('div', { className: 'dsh-git-empty' }, t('loading'))
															: open.files.length === 0
																? h('div', { className: 'dsh-git-empty' }, t('noDiff'))
																: open.files.map((file) =>
																		h(
																			'div',
																			{
																				key: file.path,
																				className: 'dsh-git-file',
																				'data-active': selection !== null && selection.kind === 'commit' && selection.hash === commit.hash && activePath === file.path ? 'true' : 'false',
																				role: 'button',
																				tabIndex: 0,
																				title: file.path,
																				onClick: (event) => {
																					event.stopPropagation();
																					setSelection({ kind: 'commit', hash: commit.hash, path: file.path });
																				},
																			},
																			h('span', { key: 'path', className: 'dsh-git-file-path' }, file.path),
																			h('span', { key: 'note', className: 'dsh-git-file-note' }, file.additions === null ? 'bin' : '+' + file.additions + ' / -' + file.deletions),
																		),
																	),
													),
										);
									}),
						),
					),
					h(
						'div',
						{ className: 'dsh-git-pane', 'data-area': 'diff' },
						h(
							'div',
							{ className: 'dsh-git-pane-head' },
							selection === null
								? h('span', { className: 'dsh-git-pane-title' }, t('diffOf'))
								: h(
										'span',
										{ key: 'head', className: 'dsh-git-diff-head' },
										h('span', { className: 'dsh-git-badge' }, selection.kind === 'commit' ? t('commitDiff') : selection.kind === 'staged' ? t('stagedDiff') : t('unstaged')),
										h('span', { className: 'dsh-git-diff-path', title: selection.path === undefined ? '' : selection.path }, selection.kind === 'commit' ? selection.hash.slice(0, 8) : selection.path),
									),
							diff.truncated === true ? h('span', { className: 'dsh-git-badge' }, t('truncated')) : null,
							diff.loading === true ? h('span', { className: 'dsh-git-badge' }, t('loading')) : null,
						),
						diff.error === null ? null : h('div', { className: 'dsh-git-error' }, diff.error),
						h('div', { className: 'dsh-git-scroll' }, selection === null ? h('div', { className: 'dsh-git-empty' }, t('noDiff')) : h(PatchView, { patch: diff.patch, empty: t('noDiff') })),
					),
					menu === null
						? null
						: h(
								'div',
								{ key: 'menu', className: 'dsh-git-menu', style: { left: menu.x + 'px', top: menu.y + 'px' }, onClick: (event) => event.stopPropagation() },
								h('div', { key: 'title', className: 'dsh-git-menu-title' }, menu.short + ' \u00b7 ' + menu.subject),
								h(
									'button',
									{
										key: 'copy',
										type: 'button',
										onClick: () => {
											if (navigator.clipboard !== undefined) navigator.clipboard.writeText(menu.hash).catch(() => {});
											setMenu(null);
										},
									},
									t('copyHash'),
								),
								h('div', { key: 'sep', className: 'dsh-git-menu-sep' }),
								h('button', { key: 'soft', type: 'button', onClick: () => { mutate('reset', { hash: menu.hash, mode: 'soft' }, 'resetDone'); setMenu(null); } }, t('resetSoft')),
								h('button', { key: 'mixed', type: 'button', onClick: () => { mutate('reset', { hash: menu.hash, mode: 'mixed' }, 'resetDone'); setMenu(null); } }, t('resetMixed')),
								h('button', { key: 'hard', type: 'button', 'data-danger': 'true', onClick: () => { mutate('reset', { hash: menu.hash, mode: 'hard' }, 'resetDone'); setMenu(null); } }, t('resetHard')),
								h('div', { key: 'sep2', className: 'dsh-git-menu-sep' }),
								h('button', { key: 'revert', type: 'button', 'data-danger': 'true', onClick: () => { mutate('revert', { hash: menu.hash }, 'revertDone'); setMenu(null); } }, t('revert')),
							),
				);
			}

			/** Native right-sidebar body: read the tab params, then render the panel. */
			function NativeTabBody(props) {
				const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
				const params = info !== undefined && info.tab !== undefined && info.tab !== null && info.tab.navigation !== undefined ? info.tab.navigation.params : undefined;
				const paramCwd = params !== undefined && params !== null && typeof params.cwd === 'string' ? params.cwd : undefined;
				return h(GitPanel, { key: 'panel', sessionId: props.sessionId, cwd: paramCwd, visible: true });
			}

			const disposers = [];
			let nativeDispose = null;

			/** The native right-sidebar tab, dropped again if better-sidebar claims the seat. */
			const registerNative = () => {
				nativeDispose = ctx.inject(['sidebarRightTabs'], (scope) => {
					return scope.effect(() => {
						const tabs = scope.get('sidebarRightTabs');
						if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return () => {};
						const definition = { id: TAB_ID, kind: TAB_ID, priority: 'extension', title: () => translate('tab.title'), icon: () => branchIcon(15) };
						const disposeType = tabs.register(definition);
						const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () =>
							ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, NativeTabBody),
						);
						return () => {
							if (typeof disposeBody === 'function') disposeBody();
							if (typeof disposeType === 'function') disposeType();
						};
					}, 'dsh-git: sidebar tab');
				});
			};
			registerNative();

			/** Chip: left of the model pill and the session-stats control. */
			disposers.push(
				ctx.slots.inject('conversation.input.right', () =>
					ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-git-chip', order: -10, registrant: 'dsh-git' }, GitChip),
				),
			);
			/** Header button: the corner utility of an open conversation. */
			disposers.push(
				ctx.slots.inject('conversation.session.header.utilities', () =>
					ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-git-button', order: 10, registrant: 'dsh-git' }, GitHeaderButton),
				),
			);

			/** When dsh-better-sidebar is installed it owns the panel surface. */
			ctx.inject(['betterSidebar'], (scope) => {
				if (typeof nativeDispose === 'function') {
					try {
						nativeDispose();
					} catch (error) {
						console.warn('dsh-git: could not drop the native tab', error);
					}
					nativeDispose = null;
				}
				return scope.effect(() => {
					const better = scope.get('betterSidebar');
					if (better === undefined || better === null || typeof better.registerTab !== 'function') return () => {};
					return better.registerTab({
						id: TAB_ID,
						title: () => translate('tab.title'),
						icon: (size) => branchIcon(typeof size === 'number' ? size : 15),
						order: 25,
						single: true,
						component: (props) =>
							h(GitPanel, {
								key: 'panel',
								sessionId: props !== null && props !== undefined && props.scope !== undefined ? props.scope.sessionId : undefined,
								cwd: props !== null && props !== undefined && props.scope !== undefined && typeof props.scope.cwd === 'string' ? props.scope.cwd : undefined,
								visible: props !== null && props !== undefined && props.visible === false ? false : true,
							}),
					});
				}, 'dsh-git: better sidebar tab');
			});

			return () => {
				if (typeof nativeDispose === 'function') {
					try {
						nativeDispose();
					} catch (error) {
						console.error('dsh-git: native tab dispose failed', error);
					}
					nativeDispose = null;
				}
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
