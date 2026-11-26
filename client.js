/**
 * Browser half of the annotations bundle.
 *
 * Two surfaces:
 * 1. A selection toolbar inside the Chat transcript (the `quote` text-interaction
 *    cell is replaced so the toolbar owns the gesture; it keeps a Quote action).
 * 2. A composer-dock tray that lists the session's annotations and inserts a
 *    formatted digest into the composer draft.
 *
 * Annotations live in browser localStorage, keyed by Session id; they never
 * reach the Host until the user inserts them into a message.
 */
window.__ModuleLoader__.load({
  id: 'dsh-annotations',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom !== null && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal
    } catch (error) {
      createPortal = null
    }

    const NS = 'textAnnotations'
    const STORAGE_KEY = 'dsh.text-annotations.v1'
    const MAX_TEXT = 800
    const MAX_ITEMS = 200
    const ANCHOR_CHARS = 40
    const EMPTY = Object.freeze([])

    /** Category ids, in toolbar order. */
    const CATEGORIES = Object.freeze(['important', 'question', 'disagree', 'extra'])
    /** Category accent per id (theme tokens with literal fallbacks). */
    const CAT_COLOR = Object.freeze({
      important: 'var(--dsw-alias-state-warn-primary, #d97706)',
      /* The theme brand token is monochrome here, so the question mark keeps a literal blue. */
      question: '#2563eb',
      disagree: 'var(--dsw-alias-state-error-primary, #dc2626)',
      extra: 'var(--dsw-alias-state-success-primary, #15803d)',
    })

    const ZH = {
      'cat.important': '重要',
      'cat.question': '疑问',
      'cat.disagree': '否定',
      'cat.extra': '补充',
      'hint.important': '标记为重要',
      'hint.question': '标记为疑问',
      'hint.disagree': '标记为否定',
      'hint.extra': '标记为补充',
      'hint.quote': '把选区作为引用插入输入框（不保存注释）',
      'action.quote': '引用',
      'action.close': '关闭',
      'action.remove': '删除',
      'action.undo': '撤销',
      'group.label': '注释',
      'tray.title': '注释',
      'tray.toggle': '展开或收起注释',
      'tray.hint': '注释：拖选回答里的文字即可添加',
      'tray.insert': '插入全部',
      'tray.copy': '复制清单',
      'tray.copyHint': '复制带分类标签的完整清单',
      'tray.copied': '已复制',
      'tray.clear': '清空',
      'tray.confirmClear': '确认清空',
      'tray.insertOne': '插入',
      'tray.changeCategory': '切换类别',
      'tray.jump': '回到原文',
      'insert.header': '我标注了以下 {count} 处，想和你逐条讨论：',
      'notice.saved': '已存为「{category}」',
      'notice.removed': '已删除',
      'notice.inserted': '已插入输入框',
      'notice.failed': '未能插入，请在输入框里点一下再试',
      'notice.copyFailed': '复制失败',
      'notice.missing': '没找到这段文字，先向上滚动加载历史再试',
      'notice.collapsed': '这段已被折叠，展开后再试',
    }

    const EN = {
      'cat.important': 'Key',
      'cat.question': 'Question',
      'cat.disagree': 'Disagree',
      'cat.extra': 'Add',
      'hint.important': 'Mark as key point',
      'hint.question': 'Mark as a question',
      'hint.disagree': 'Mark as disagreement',
      'hint.extra': 'Mark as an addition',
      'hint.quote': 'Quote the selection into the composer (no note is saved)',
      'action.quote': 'Quote',
      'action.close': 'Close',
      'action.remove': 'Remove',
      'action.undo': 'Undo',
      'group.label': 'Annotate',
      'tray.title': 'Notes',
      'tray.toggle': 'Show or hide notes',
      'tray.hint': 'Notes: select text in a reply to annotate it',
      'tray.insert': 'Insert all',
      'tray.copy': 'Copy list',
      'tray.copyHint': 'Copy the full digest with category labels',
      'tray.copied': 'Copied',
      'tray.clear': 'Clear',
      'tray.confirmClear': 'Clear all?',
      'tray.insertOne': 'Insert',
      'tray.changeCategory': 'Change category',
      'tray.jump': 'Go to the passage',
      'insert.header': 'I annotated {count} passages and want to discuss them one by one:',
      'notice.saved': 'Saved as “{category}”',
      'notice.removed': 'Removed',
      'notice.inserted': 'Inserted into the composer',
      'notice.failed': 'Insert failed — click inside the composer and try again',
      'notice.copyFailed': 'Copy failed',
      'notice.missing': 'Passage not found — scroll up to load history and try again',
      'notice.collapsed': 'That passage is collapsed — expand it and try again',
    }

    const STYLESHEET = `
.dsh-anno-bar{display:flex;align-items:center;gap:1px;padding:3px;border-radius:999px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));box-shadow:0 6px 22px rgba(15,23,42,.16),0 0 0 1px var(--dsw-alias-border-l1,rgba(15,23,42,.1));color:var(--dsw-alias-label-primary,#111827)}
.dsh-anno-bar-btn{appearance:none;border:0;background:transparent;font:inherit;font-size:12px;line-height:1;color:inherit;padding:6px 9px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-anno-bar-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.06))}
.dsh-anno-bar-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:1px}
.dsh-anno-bar-quote{color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-anno-dot{width:7px;height:7px;border-radius:999px;flex:none}
.dsh-anno-sep{width:1px;height:14px;margin:0 2px;background:var(--dsw-alias-border-l1,rgba(15,23,42,.12))}
.dsh-anno-tray{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-anno-tray-hint{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:default}
.dsh-anno-tray-main{display:inline-flex;align-items:center;gap:6px;appearance:none;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:3px 6px;border-radius:999px;white-space:nowrap}
.dsh-anno-tray-main:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.06));color:var(--dsw-alias-label-primary,#111827)}
.dsh-anno-tray-main[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.08));color:var(--dsw-alias-label-primary,#111827)}
.dsh-anno-tray-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:1px}
.dsh-anno-count{min-width:16px;text-align:center;padding:1px 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.08));color:var(--dsw-alias-label-primary,#111827);font-size:11px;font-variant-numeric:tabular-nums;animation:dsh-anno-pop .42s ease}
@keyframes dsh-anno-pop{0%{transform:scale(.72);opacity:.45}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
.dsh-anno-caret{opacity:.55;flex:none}
.dsh-anno-primary{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);font:inherit;font-size:11.5px;line-height:1;padding:5px 9px;border-radius:999px;cursor:pointer;white-space:nowrap}
.dsh-anno-primary:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.06))}
.dsh-anno-primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:1px}
.dsh-anno-notice{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.dsh-anno-panel{box-sizing:border-box;position:fixed;z-index:70;display:flex;flex-direction:column;overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));box-shadow:0 18px 48px rgba(15,23,42,.22);color:var(--dsw-alias-label-primary,#111827);font-size:12.5px}
.dsh-anno-panel:focus{outline:none}
.dsh-anno-panel-head{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
.dsh-anno-panel-title{font-weight:600;flex:none}
.dsh-anno-panel-count{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-variant-numeric:tabular-nums;flex:none}
.dsh-anno-panel-summary{min-width:0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-anno-panel-close{margin-left:auto;flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:15px;line-height:1;width:24px;height:24px;border-radius:6px;cursor:pointer}
.dsh-anno-panel-close:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.06));color:var(--dsw-alias-label-primary,#111827)}
.dsh-anno-panel-list{overflow-y:auto;max-height:min(46vh,360px);padding:4px 0}
.dsh-anno-row{display:flex;align-items:flex-start;gap:8px;padding:7px 12px}
.dsh-anno-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.04))}
.dsh-anno-cat{flex:none;appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));background-color:var(--dsw-alias-bg-layer-1,transparent);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4.5 6 8.5 10 4.5' fill='none' stroke='%238b8f98' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 3px center;background-size:8px 8px;font:inherit;font-size:10.5px;font-weight:600;line-height:1;padding:4px 14px 4px 5px;border-radius:6px;cursor:pointer;max-width:74px}
.dsh-anno-cat:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:1px}
.dsh-anno-row-text{flex:1 1 auto;min-width:0;appearance:none;border:0;background:transparent;padding:0;margin:0;font:inherit;text-align:left;color:inherit;cursor:pointer;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45;word-break:break-word}
.dsh-anno-row-text:hover{text-decoration:underline;text-underline-offset:2px}
.dsh-anno-row-text:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:1px;border-radius:3px}
.dsh-anno-row-action{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:11px;padding:3px 6px;border-radius:6px;cursor:pointer;white-space:nowrap}
.dsh-anno-row-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.08));color:var(--dsw-alias-label-primary,#111827)}
.dsh-anno-row-remove{min-width:24px;min-height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1}
.dsh-anno-panel-foot{display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
.dsh-anno-spacer{flex:1 1 auto}
.dsh-anno-danger{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-anno-undo{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.dsh-anno-undo-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#2f6fed);font:inherit;font-size:11px;font-weight:600;padding:2px 4px;border-radius:4px;cursor:pointer;text-decoration:underline}
::highlight(dsh-anno-hl-important){background-color:rgba(245,158,11,.32);background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 32%,transparent)}
::highlight(dsh-anno-hl-question){background-color:rgba(37,99,235,.20);background-color:color-mix(in srgb,#2563eb 20%,transparent)}
::highlight(dsh-anno-hl-disagree){background-color:rgba(236,19,19,.18);background-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 18%,transparent)}
::highlight(dsh-anno-hl-extra){background-color:rgba(34,197,94,.22);background-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 22%,transparent)}
::highlight(dsh-anno-focus-important){background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 60%,transparent);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
::highlight(dsh-anno-focus-question){background-color:color-mix(in srgb,#2563eb 45%,transparent);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
::highlight(dsh-anno-focus-disagree){background-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 45%,transparent);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
::highlight(dsh-anno-focus-extra){background-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 45%,transparent);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
`

    function Style() {
      return h('style', { 'data-dsh-annotations-style': '' }, STYLESHEET)
    }

    // ---------------------------------------------------------------- store

    function nextId() {
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    function isCategory(value) {
      return CATEGORIES.indexOf(value) >= 0
    }

    /** Collapse whitespace, trim, and cap one selected passage. */
    function normalizeText(value) {
      if (typeof value !== 'string') return ''
      const collapsed = value.replace(/\s+/gu, ' ').trim()
      if (collapsed.length <= MAX_TEXT) return collapsed
      return collapsed.slice(0, MAX_TEXT) + '…'
    }

    function loadSessions() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || parsed.v !== 1 || typeof parsed.sessions !== 'object' || parsed.sessions === null) return {}
        const out = {}
        for (const key of Object.keys(parsed.sessions)) {
          const list = parsed.sessions[key]
          if (!Array.isArray(list)) continue
          const clean = []
          for (const item of list) {
            if (item === null || typeof item !== 'object' || !isCategory(item.cat) || typeof item.text !== 'string') continue
            const text = normalizeText(item.text)
            if (text === '') continue
            const entry = { id: typeof item.id === 'string' ? item.id : nextId(), cat: item.cat, text, ts: typeof item.ts === 'number' ? item.ts : 0 }
            if (typeof item.before === 'string') entry.before = item.before.slice(-ANCHOR_CHARS)
            if (typeof item.after === 'string') entry.after = item.after.slice(0, ANCHOR_CHARS)
            clean.push(entry)
          }
          if (clean.length > 0) out[key] = clean.slice(-MAX_ITEMS)
        }
        return out
      } catch (error) {
        return {}
      }
    }

    let bySession = loadSessions()
    const listeners = new Set()

    function persist() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, sessions: bySession }))
      } catch (error) {
        /* A full or blocked localStorage keeps the in-memory list working. */
      }
    }

    function notifyListeners() {
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (error) {
          /* One broken subscriber must not stop the others. */
        }
      }
    }

    function commit(next) {
      bySession = next
      persist()
      notifyListeners()
    }

    function annotationsOf(sessionId) {
      const list = bySession[sessionId]
      return list === undefined ? EMPTY : list
    }

    function subscribe(listener) {
      listeners.add(listener)
      return function unsubscribe() {
        listeners.delete(listener)
      }
    }

    /**
     * Append one annotation; identical text in the same category is not duplicated.
     * @param anchor - capture-time context used to find the passage again later.
     */
    function addAnnotation(sessionId, category, text, anchor) {
      const clean = normalizeText(text)
      if (clean === '' || !isCategory(category)) return null
      const list = annotationsOf(sessionId)
      for (const item of list) {
        if (item.cat === category && item.text === clean) return item
      }
      const item = { id: nextId(), cat: category, text: clean, ts: Date.now() }
      if (anchor !== null && anchor !== undefined) {
        if (typeof anchor.before === 'string' && anchor.before !== '') item.before = anchor.before
        if (typeof anchor.after === 'string' && anchor.after !== '') item.after = anchor.after
      }
      const next = Object.assign({}, bySession)
      next[sessionId] = list.concat([item]).slice(-MAX_ITEMS)
      commit(next)
      markAnnotatedBefore()
      announceSaved(sessionId, category)
      return item
    }

    function removeAnnotation(sessionId, id) {
      const list = annotationsOf(sessionId)
      const kept = list.filter(function (item) { return item.id !== id })
      if (kept.length === list.length) return
      const next = Object.assign({}, bySession)
      if (kept.length === 0) delete next[sessionId]
      else next[sessionId] = kept
      commit(next)
    }

    function clearAnnotations(sessionId) {
      if (annotationsOf(sessionId).length === 0) return
      const next = Object.assign({}, bySession)
      delete next[sessionId]
      commit(next)
    }

    const SEEN_KEY = 'dsh.text-annotations.seen'
    let saveSeq = 0
    let lastSaved = null
    const savedListeners = new Set()

    /** Whether this browser ever stored an annotation; drives the one-time first-run hint. */
    function hasAnnotatedBefore() {
      try {
        return window.localStorage.getItem(SEEN_KEY) === '1'
      } catch (error) {
        return true
      }
    }

    function markAnnotatedBefore() {
      try {
        window.localStorage.setItem(SEEN_KEY, '1')
      } catch (error) {
        /* Blocked storage keeps the hint after a reload; the notes still work. */
      }
    }

    function subscribeSaved(listener) {
      savedListeners.add(listener)
      return function unsubscribeSaved() {
        savedListeners.delete(listener)
      }
    }

    /** Tell the tray which category was just stored so it can confirm in place. */
    function announceSaved(sessionId, category) {
      saveSeq += 1
      lastSaved = { sessionId: sessionId, category: category, seq: saveSeq }
      for (const listener of Array.from(savedListeners)) {
        try {
          listener()
        } catch (error) {
          /* One broken subscriber must not stop the others. */
        }
      }
    }

    /** Put one removed annotation back at its previous position. */
    function restoreAnnotation(sessionId, index, item) {
      const list = annotationsOf(sessionId)
      const next = list.slice()
      next.splice(Math.max(0, Math.min(index, next.length)), 0, item)
      const store = Object.assign({}, bySession)
      store[sessionId] = next.slice(-MAX_ITEMS)
      commit(store)
    }

    /** Move one annotation to another category. */
    function changeCategory(sessionId, id, category) {
      if (!isCategory(category)) return
      const list = annotationsOf(sessionId)
      const index = list.findIndex(function (item) { return item.id === id })
      if (index < 0) return
      const next = list.slice()
      next[index] = Object.assign({}, list[index], { cat: category })
      const store = Object.assign({}, bySession)
      store[sessionId] = next
      commit(store)
    }

    // ---------------------------------------------------------------- text

    function itemLine(item, t) {
      return '【' + t('cat.' + item.cat) + '】「' + item.text + '」'
    }

    function digestOf(list, t) {
      const head = t('insert.header', { count: String(list.length) })
      const lines = list.map(function (item, index) {
        return (index + 1) + '. ' + itemLine(item, t)
      })
      return head + '\n\n' + lines.join('\n')
    }

    /**
     * Paragraph separator that keeps one blank line between the draft and an insert.
     * @param draft - current composer draft.
     * @returns the prefix to put before the inserted block.
     */
    function separatorFor(draft) {
      if (draft.trim() === '') return ''
      if (/\n\n$/u.test(draft)) return ''
      if (/\n$/u.test(draft)) return '\n'
      return '\n\n'
    }

    /**
     * Insert text at the composer caret.
     * @param inputActions - slot-provided composer actions.
     * @param text - text to insert in one undo step.
     * @returns whether the editor accepted the insertion.
     */
    function insertIntoComposer(inputActions, text) {
      if (inputActions === null || inputActions === undefined) return false
      if (typeof inputActions.captureInsertion !== 'function' || typeof inputActions.insertText !== 'function') return false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const span = inputActions.captureInsertion()
          if (inputActions.insertText(text, span)) return true
        } catch (error) {
          return false
        }
      }
      return false
    }

    /** The per-session input facade (focus and notices), or null when unavailable. */
    function sessionInputOf(ctx, sessionId) {
      try {
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined || binding === null) return null
        const input = ctx.conversation.input.for(binding.ctx)
        return input === undefined || input === null ? null : input
      } catch (error) {
        return null
      }
    }

    /** Locale thunk with a local fallback so a missing dictionary never blanks the entry. */
    function translateOf(props) {
      if (typeof props.t === 'function') return props.t
      return function fallback(key) {
        const value = ZH[key] !== undefined ? ZH[key] : EN[key]
        return value === undefined ? key : value
      }
    }

    // ------------------------------------------------------------- highlight

    /** CSS custom-highlight names per category (the colored block on the passage). */
    const HIGHLIGHT_NAME = Object.freeze({
      important: 'dsh-anno-hl-important',
      question: 'dsh-anno-hl-question',
      disagree: 'dsh-anno-hl-disagree',
      extra: 'dsh-anno-hl-extra',
    })
    /** Temporary emphasis highlight applied after a jump. */
    const FOCUS_NAME = Object.freeze({
      important: 'dsh-anno-focus-important',
      question: 'dsh-anno-focus-question',
      disagree: 'dsh-anno-focus-disagree',
      extra: 'dsh-anno-focus-extra',
    })
    /** Block-level tags whose boundary reads as visible whitespace when text is projected. */
    const BLOCK_TAGS = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
      'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN',
      'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
    ])
    const MAX_HIGHLIGHT_TEXT = 400000

    /** Annotation id to its painted Range, for scrolling back to the passage. */
    let highlightRanges = new Map()
    let focusTimer = 0

    function supportsHighlights() {
      return typeof Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights !== undefined && CSS.highlights !== null
    }

    function isSpaceCode(code) {
      return code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13
        || code === 160 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
        || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
    }

    /** Mirrors the Chat renderer's selectable-text exclusions. */
    function isExcludedNode(element) {
      if (element.matches('.katex-mathml, [data-text-interaction-exclude], [hidden], .sr-only')) return true
      if (element.matches('[aria-hidden="true"]') && !element.matches('.katex-html')) return true
      return element.tagName === 'BUTTON' && (element.parentElement === null || element.parentElement.tagName !== 'CODE')
    }

    /** Text of one node with soft line breaks collapsed, plus per-offset projections. */
    function projectTextNode(node) {
      const source = node.data
      const parent = node.parentElement
      const view = node.ownerDocument.defaultView
      const whiteSpace = parent === null || view === null ? '' : view.getComputedStyle(parent).whiteSpace
      const preserves = whiteSpace === 'pre' || whiteSpace === 'pre-wrap'
        || whiteSpace === 'pre-line' || whiteSpace === 'break-spaces'
      const offsets = new Array(source.length + 1).fill(0)
      let text = ''
      let cursor = 0
      if (!preserves && node.previousSibling instanceof HTMLElement
        && node.previousSibling.tagName === 'BR' && source.startsWith('\n')) cursor = 1
      while (cursor < source.length) {
        const code = source.charCodeAt(cursor)
        if (!preserves && (code === 10 || code === 13)) {
          let end = cursor + 1
          while (end < source.length) {
            const next = source.charCodeAt(end)
            if (next === 10 || next === 13 || next === 32 || next === 9) end += 1
            else break
          }
          for (let index = cursor; index < end; index += 1) offsets[index] = text.length
          text += ' '
          offsets[end] = text.length
          cursor = end
          continue
        }
        offsets[cursor] = text.length
        text += source.charAt(cursor)
        cursor += 1
        offsets[cursor] = text.length
      }
      return { text: text, offsets: offsets }
    }

    /**
     * Project every selectable message source in the transcript into one text with
     * a node/offset map, so annotations can be matched back to DOM ranges.
     */
    function projectSources(root) {
      const spans = []
      let text = ''
      const pad = function () {
        if (text !== '' && !isSpaceCode(text.charCodeAt(text.length - 1))) text += ' '
      }
      const walk = function (element) {
        if (isExcludedNode(element)) return
        if (element.tagName === 'BR') {
          text += ' '
          return
        }
        if (BLOCK_TAGS.has(element.tagName)) pad()
        for (const child of element.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const projected = projectTextNode(child)
            if (projected.text === '') continue
            spans.push({ node: child, start: text.length, length: projected.text.length, offsets: projected.offsets })
            text += projected.text
            continue
          }
          if (child.nodeType === Node.ELEMENT_NODE) walk(child)
        }
        if (BLOCK_TAGS.has(element.tagName)) pad()
      }
      for (const source of root.querySelectorAll('[data-text-interaction-source]')) {
        if (source.parentElement !== null && source.parentElement.closest('[data-text-interaction-source]') !== null) continue
        if (source.closest('[hidden], [inert]') !== null) continue
        if (text !== '') text += ' '
        walk(source)
      }
      return { text: text, spans: spans }
    }

    /** Collapse whitespace exactly like the stored annotation text, tracking source offsets. */
    function normalizeTracked(raw) {
      const chars = []
      const toProj = new Int32Array(raw.length)
      let count = 0
      let pending = -1
      for (let index = 0; index < raw.length; index += 1) {
        if (isSpaceCode(raw.charCodeAt(index))) {
          if (count > 0 && pending < 0) pending = index
          continue
        }
        if (pending >= 0) {
          toProj[count] = pending
          chars.push(' ')
          count += 1
          pending = -1
        }
        toProj[count] = index
        chars.push(raw.charAt(index))
        count += 1
      }
      return { text: chars.join(''), toProj: toProj.subarray(0, count) }
    }

    function findMatches(text, needle) {
      const found = []
      let from = 0
      while (found.length < 24) {
        const at = text.indexOf(needle, from)
        if (at < 0) break
        found.push(at)
        from = at + 1
      }
      return found
    }

    function commonSuffixLength(left, right) {
      let length = 0
      while (length < left.length && length < right.length
        && left.charAt(left.length - 1 - length) === right.charAt(right.length - 1 - length)) length += 1
      return length
    }

    function commonPrefixLength(left, right) {
      let length = 0
      while (length < left.length && length < right.length && left.charAt(length) === right.charAt(length)) length += 1
      return length
    }

    /** How well one occurrence's surroundings match the stored capture-time context. */
    function contextScore(text, at, length, item) {
      let score = 0
      if (typeof item.before === 'string' && item.before !== '') {
        score += commonSuffixLength(item.before, text.slice(Math.max(0, at - item.before.length), at))
      }
      if (typeof item.after === 'string' && item.after !== '') {
        score += commonPrefixLength(item.after, text.slice(at + length, at + length + item.after.length))
      }
      return score
    }

    function sourceOffsetAt(offsets, local) {
      let low = 0
      let high = offsets.length - 1
      while (low < high) {
        const mid = (low + high) >> 1
        if (offsets[mid] < local) low = mid + 1
        else high = mid
      }
      return low
    }

    /** DOM text node and offset for one projected index. */
    function pointAt(projection, projectedIndex) {
      const spans = projection.spans
      if (spans.length === 0) return null
      let low = 0
      let high = spans.length - 1
      let chosen = -1
      while (low <= high) {
        const mid = (low + high) >> 1
        const span = spans[mid]
        if (projectedIndex < span.start) high = mid - 1
        else if (projectedIndex > span.start + span.length) low = mid + 1
        else {
          chosen = mid
          break
        }
      }
      if (chosen < 0) chosen = Math.min(spans.length - 1, Math.max(0, low))
      const span = spans[chosen]
      const local = Math.max(0, Math.min(span.length, projectedIndex - span.start))
      return { node: span.node, offset: sourceOffsetAt(span.offsets, local) }
    }

    function rangeForMatch(projection, normalized, from, to) {
      const projectedStart = normalized.toProj[from]
      const projectedEnd = normalized.toProj[to - 1] + 1
      if (projectedStart === undefined || !Number.isFinite(projectedEnd)) return null
      const start = pointAt(projection, projectedStart)
      const end = pointAt(projection, projectedEnd)
      if (start === null || end === null) return null
      try {
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        if (range.collapsed) return null
        return range
      } catch (error) {
        return null
      }
    }

    function resolveRange(projection, normalized, item) {
      const needle = normalizeText(item.text)
      if (needle === '') return null
      const matches = findMatches(normalized.text, needle)
      if (matches.length === 0) return null
      let bestAt = matches[0]
      let bestScore = -1
      for (const at of matches) {
        const score = contextScore(normalized.text, at, needle.length, item)
        if (score > bestScore) {
          bestScore = score
          bestAt = at
        }
      }
      return rangeForMatch(projection, normalized, bestAt, bestAt + needle.length)
    }

    /** Paint the category blocks for this session's annotations; returns id-to-range. */
    function paintHighlights(list) {
      const ranges = new Map()
      if (!supportsHighlights()) return ranges
      for (const category of CATEGORIES) CSS.highlights.delete(HIGHLIGHT_NAME[category])
      highlightRanges = ranges
      if (list.length === 0) return ranges
      const flow = document.querySelector('[data-conversation-scroll]')
      if (flow === null) return ranges
      const projection = projectSources(flow)
      if (projection.text === '' || projection.text.length > MAX_HIGHLIGHT_TEXT) return ranges
      const normalized = normalizeTracked(projection.text)
      if (normalized.text === '') return ranges
      const buckets = {}
      for (const category of CATEGORIES) buckets[category] = []
      for (const item of list) {
        const range = resolveRange(projection, normalized, item)
        if (range === null) continue
        ranges.set(item.id, range)
        buckets[item.cat].push(range)
      }
      for (const category of CATEGORIES) {
        if (buckets[category].length > 0) {
          CSS.highlights.set(HIGHLIGHT_NAME[category], new Highlight(...buckets[category]))
        }
      }
      return ranges
    }

    function clearHighlights() {
      if (!supportsHighlights()) return
      for (const category of CATEGORIES) {
        CSS.highlights.delete(HIGHLIGHT_NAME[category])
        CSS.highlights.delete(FOCUS_NAME[category])
      }
      highlightRanges = new Map()
      if (focusTimer !== 0) {
        window.clearTimeout(focusTimer)
        focusTimer = 0
      }
    }

    function flashRange(category, range) {
      if (!supportsHighlights()) return
      for (const other of CATEGORIES) CSS.highlights.delete(FOCUS_NAME[other])
      CSS.highlights.set(FOCUS_NAME[category], new Highlight(range))
      if (focusTimer !== 0) window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(function () {
        focusTimer = 0
        CSS.highlights.delete(FOCUS_NAME[category])
      }, 1800)
    }

    /**
     * Scroll one annotation's passage into view and flash it.
     * @returns 'jumped', 'hidden' for a rendered but collapsed passage, or 'missing'.
     */
    function jumpToAnnotation(item, list) {
      let range = highlightRanges.get(item.id)
      if (range === undefined) range = paintHighlights(list).get(item.id)
      if (range === undefined) return 'missing'
      if (range.getClientRects().length === 0) return 'hidden'
      const node = range.startContainer
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      if (element === null || element === undefined) return 'missing'
      const block = element.closest('p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th') || element
      try {
        block.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch (error) {
        block.scrollIntoView(false)
      }
      flashRange(item.cat, range)
      return 'jumped'
    }

    /** Projected offset of one DOM point inside the transcript projection. */
    function projectedOffsetOf(projection, node, offset) {
      if (node === null || node.nodeType !== Node.TEXT_NODE) return null
      for (const span of projection.spans) {
        if (span.node !== node) continue
        const local = span.offsets[offset]
        return typeof local === 'number' ? span.start + local : null
      }
      return null
    }

    /** Capture the surrounding context of a selection so the passage can be found later. */
    function captureAnchor(selected) {
      try {
        const flow = document.querySelector('[data-conversation-scroll]')
        if (flow === null) return null
        const projection = projectSources(flow)
        if (projection.text === '') return null
        const normalized = normalizeTracked(projection.text)
        const needle = normalizeText(selected)
        if (needle === '') return null
        const matches = findMatches(normalized.text, needle)
        if (matches.length === 0) return null
        let chosen = matches[0]
        const selection = window.getSelection()
        if (selection !== null && selection.rangeCount > 0) {
          const live = selection.getRangeAt(0)
          const projectedStart = projectedOffsetOf(projection, live.startContainer, live.startOffset)
          if (projectedStart !== null) {
            let bestDistance = Infinity
            for (const at of matches) {
              const distance = Math.abs(normalized.toProj[at] - projectedStart)
              if (distance < bestDistance) {
                bestDistance = distance
                chosen = at
              }
            }
          }
        }
        const end = chosen + needle.length
        return {
          before: normalized.text.slice(Math.max(0, chosen - ANCHOR_CHARS), chosen),
          after: normalized.text.slice(end, end + ANCHOR_CHARS),
        }
      } catch (error) {
        return null
      }
    }

    /** Assignment target for the composer focus handle installed by `apply`. */
    let focusComposer = null

    // ------------------------------------------------------------ selection

    function preventFocusLoss(event) {
      event.preventDefault()
    }

    /** Toolbar shown next to a selection; replaces the shipped Quote surface. */
    function AnnotationToolbar(props) {
      const dismiss = props.dismiss
      const readText = props.readText
      const clearSelection = props.clearSelection
      const inputActions = props.inputActions
      const useSession = props.useSession
      const sessionId = props.sessionId
      const t = translateOf(props)

      const writable = useSession(function (state) {
        return !state.removed && (state.subagent === null || state.subagent.address.mode === 'continuable')
      })
      React.useEffect(function () {
        if (!writable) dismiss()
      }, [writable, dismiss])
      if (!writable) return null

      const take = function (category) {
        const text = readText()
        if (text === null) {
          dismiss()
          return
        }
        addAnnotation(sessionId, category, text, captureAnchor(text))
        clearSelection()
        dismiss()
      }

      const quote = function () {
        const text = readText()
        if (text === null) {
          dismiss()
          return
        }
        if (!inputActions.insertQuote(text)) return
        clearSelection()
        dismiss()
      }

      const buttons = CATEGORIES.map(function (category) {
        return h('button', {
          key: category,
          type: 'button',
          className: 'dsh-anno-bar-btn',
          'data-anno-category': category,
          title: t('hint.' + category),
          onPointerDown: preventFocusLoss,
          onClick: function () { take(category) },
        },
        h('span', { className: 'dsh-anno-dot', style: { background: CAT_COLOR[category] } }),
        t('cat.' + category))
      })

      return h(React.Fragment, null,
        h(Style),
        h('div', {
          className: 'dsh-anno-bar',
          role: 'group',
          'aria-label': t('group.label'),
          'data-dsh-annotations': 'toolbar',
        },
          buttons,
          h('span', { className: 'dsh-anno-sep' }),
          h('button', {
            type: 'button',
            className: 'dsh-anno-bar-btn dsh-anno-bar-quote',
            'data-anno-quote': '',
            title: t('hint.quote'),
            onPointerDown: preventFocusLoss,
            onClick: quote,
          }, t('action.quote'))))
    }

    /** Composer-dock tray: the note entry, its panel, and insertion into the draft. */
    function AnnotationTray(props) {
      const inputActions = props.inputActions
      const useInput = props.useInput
      const sessionId = props.sessionId
      const t = translateOf(props)

      const list = React.useSyncExternalStore(
        subscribe,
        function () { return annotationsOf(sessionId) },
        function () { return annotationsOf(sessionId) },
      )
      const saveEvent = React.useSyncExternalStore(
        subscribeSaved,
        function () { return lastSaved },
        function () { return lastSaved },
      )
      const draft = useInput(function (state) { return state.draft })
      const groupRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const lastSeqRef = React.useRef(0)
      const wasOpenRef = React.useRef(false)
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const [confirmClear, setConfirmClear] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [undo, setUndo] = React.useState(null)
      const [copied, setCopied] = React.useState(false)

      /* Outside pointer and Escape close the panel. */
      React.useEffect(function () {
        if (!open) return undefined
        const onPointerDown = function (event) {
          const panel = panelRef.current
          const group = groupRef.current
          if (panel !== null && panel.contains(event.target)) return
          if (group !== null && group.contains(event.target)) return
          setOpen(false)
        }
        const onKeyDown = function (event) {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      /* Focus the panel on open; return focus to the entry when it closes. */
      React.useEffect(function () {
        if (!open || anchor === null) return undefined
        const panel = panelRef.current
        if (panel !== null) panel.focus({ preventScroll: true })
        return undefined
      }, [open, anchor])

      React.useEffect(function () {
        if (open) {
          wasOpenRef.current = true
          return undefined
        }
        if (!wasOpenRef.current) return undefined
        wasOpenRef.current = false
        setConfirmClear(false)
        const trigger = triggerRef.current
        if (trigger !== null) trigger.focus({ preventScroll: true })
        return undefined
      }, [open])

      /* In-place confirmation after the toolbar stored a selection. */
      React.useEffect(function () {
        if (saveEvent === null || saveEvent.sessionId !== sessionId) return
        if (saveEvent.seq <= lastSeqRef.current) return
        lastSeqRef.current = saveEvent.seq
        setCopied(false)
        setNotice(t('notice.saved', { category: t('cat.' + saveEvent.category) }))
      }, [saveEvent, sessionId, t])

      React.useEffect(function () {
        if (notice === null) return undefined
        const timer = window.setTimeout(function () { setNotice(null) }, 2800)
        return function () { window.clearTimeout(timer) }
      }, [notice])

      React.useEffect(function () {
        if (!copied) return undefined
        const timer = window.setTimeout(function () { setCopied(false) }, 2000)
        return function () { window.clearTimeout(timer) }
      }, [copied])

      React.useEffect(function () {
        if (undo === null) return undefined
        const timer = window.setTimeout(function () { setUndo(null) }, 7000)
        return function () { window.clearTimeout(timer) }
      }, [undo])

      /* Paint the colored blocks on the transcript and keep them in step with the DOM. */
      React.useEffect(function () {
        if (list.length === 0) {
          clearHighlights()
          return undefined
        }
        let timer = 0
        const run = function () {
          timer = 0
          paintHighlights(list)
        }
        const schedule = function () {
          if (timer !== 0) return
          timer = window.setTimeout(run, 300)
        }
        run()
        const flow = document.querySelector('[data-conversation-scroll]')
        if (flow === null) return function () { clearHighlights() }
        const observer = new MutationObserver(schedule)
        observer.observe(flow, { childList: true, subtree: true, characterData: true })
        window.addEventListener('resize', schedule)
        return function () {
          observer.disconnect()
          window.removeEventListener('resize', schedule)
          if (timer !== 0) window.clearTimeout(timer)
          clearHighlights()
        }
      }, [list, sessionId])

      const showHint = list.length === 0 && !hasAnnotatedBefore()
      if (list.length === 0 && !showHint) return null

      const openPanel = function () {
        const node = groupRef.current
        if (node !== null) {
          const rect = node.getBoundingClientRect()
          /* Clear the composer card so the draft stays readable, and stay inside its column. */
          const seat = document.querySelector('[data-composer-seat]')
          const seatRect = seat === null ? null : seat.getBoundingClientRect()
          const hasSeat = seatRect !== null && seatRect.height > 0
          const base = hasSeat ? seatRect.top : rect.top
          const minLeft = hasSeat ? Math.max(12, seatRect.left) : 12
          const maxRight = hasSeat ? Math.min(window.innerWidth - 12, seatRect.right) : window.innerWidth - 12
          const width = Math.max(200, Math.min(420, maxRight - minLeft))
          const left = Math.max(minLeft, Math.min(rect.left, maxRight - width))
          setAnchor({ left: left, bottom: window.innerHeight - base + 8, width: width })
        }
        setOpen(true)
      }

      const insertAll = function () {
        const block = digestOf(list, t)
        if (insertIntoComposer(inputActions, separatorFor(draft) + block)) {
          setNotice(t('notice.inserted'))
          setOpen(false)
          if (focusComposer !== null) focusComposer(sessionId)
          return
        }
        setNotice(t('notice.failed'))
      }

      const insertOne = function (item) {
        if (insertIntoComposer(inputActions, separatorFor(draft) + itemLine(item, t) + '\n')) {
          setNotice(t('notice.inserted'))
          if (focusComposer !== null) focusComposer(sessionId)
          return
        }
        setNotice(t('notice.failed'))
      }

      const jump = function (item) {
        const result = jumpToAnnotation(item, list)
        if (result === 'jumped') return
        setNotice(result === 'hidden' ? t('notice.collapsed') : t('notice.missing'))
      }

      const copyAll = function () {
        const text = digestOf(list, t)
        const clipboard = window.navigator === undefined ? undefined : window.navigator.clipboard
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
          setNotice(t('notice.copyFailed'))
          return
        }
        clipboard.writeText(text).then(function () {
          setCopied(true)
          setNotice(t('tray.copied'))
        }, function () {
          setNotice(t('notice.copyFailed'))
        })
      }

      const removeItem = function (item) {
        const index = list.findIndex(function (entry) { return entry.id === item.id })
        removeAnnotation(sessionId, item.id)
        setUndo({ item: item, index: index < 0 ? list.length : index })
      }

      const undoRemove = function () {
        if (undo === null) return
        restoreAnnotation(sessionId, undo.index, undo.item)
        setUndo(null)
      }

      const clearAll = function () {
        if (!confirmClear) {
          setConfirmClear(true)
          return
        }
        setConfirmClear(false)
        setOpen(false)
        clearAnnotations(sessionId)
      }

      const pencil = h('svg', {
        viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M11.4 2.2 13.8 4.6 5.2 13.2 2 13.9 2.7 10.7z' }))

      const caret = h('svg', {
        className: 'dsh-anno-caret', viewBox: '0 0 12 12', width: 10, height: 10, 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M2 4.5 6 8.5 10 4.5' }))

      const collapsed = showHint
        ? h('div', { className: 'dsh-anno-tray dsh-anno-tray-hint', 'data-dsh-annotations': 'tray-hint' },
          pencil, h('span', null, t('tray.hint')))
        : h('div', { className: 'dsh-anno-tray', ref: groupRef, 'data-dsh-annotations': 'tray' },
          h('button', {
            type: 'button',
            ref: triggerRef,
            className: 'dsh-anno-tray-main',
            title: t('tray.toggle'),
            'data-anno-action': 'open',
            'aria-expanded': open ? 'true' : 'false',
            'aria-controls': 'dsh-anno-panel',
            onClick: function () { if (open) setOpen(false); else openPanel() },
          },
          pencil,
          h('span', null, t('tray.title')),
          h('span', { className: 'dsh-anno-count', key: list.length }, String(list.length)),
          caret),
          notice === null ? null : h('span', { className: 'dsh-anno-notice', role: 'status', 'data-anno-notice': 'saved' }, notice))

      if (!open || anchor === null) return h(React.Fragment, null, h(Style), collapsed)

      const counts = CATEGORIES
        .map(function (category) {
          return { id: category, n: list.filter(function (item) { return item.cat === category }).length }
        })
        .filter(function (entry) { return entry.n > 0 })
      const summary = counts.map(function (entry) { return t('cat.' + entry.id) + ' ' + entry.n }).join(' · ')

      const panel = h('div', {
        id: 'dsh-anno-panel',
        className: 'dsh-anno-panel',
        ref: panelRef,
        role: 'dialog',
        'aria-label': t('tray.title'),
        tabIndex: -1,
        'data-dsh-annotations': 'panel',
        style: { left: anchor.left + 'px', bottom: anchor.bottom + 'px', width: anchor.width + 'px' },
      },
      h('div', { className: 'dsh-anno-panel-head' },
        h('span', { className: 'dsh-anno-panel-title' }, t('tray.title')),
        h('span', { className: 'dsh-anno-panel-count' }, String(list.length)),
        h('span', { className: 'dsh-anno-panel-summary' }, summary),
        h('button', {
          type: 'button',
          className: 'dsh-anno-panel-close',
          'aria-label': t('action.close'),
          title: t('action.close'),
          onClick: function () { setOpen(false) },
        }, '×')),
      h('div', { className: 'dsh-anno-panel-list' },
        list.map(function (item) {
          return h('div', { key: item.id, className: 'dsh-anno-row', 'data-anno-row': item.cat },
            h('select', {
              className: 'dsh-anno-cat',
              value: item.cat,
              style: { color: CAT_COLOR[item.cat] },
              title: t('tray.changeCategory'),
              'aria-label': t('tray.changeCategory'),
              'data-anno-action': 'category',
              onChange: function (event) { changeCategory(sessionId, item.id, event.target.value) },
            }, CATEGORIES.map(function (category) {
              return h('option', { key: category, value: category }, t('cat.' + category))
            })),
            h('button', {
              type: 'button',
              className: 'dsh-anno-row-text',
              title: t('tray.jump'),
              'data-anno-action': 'jump',
              onClick: function () { jump(item) },
            }, item.text),
            h('button', {
              type: 'button',
              className: 'dsh-anno-row-action',
              'data-anno-action': 'insert-one',
              onClick: function () { insertOne(item) },
            }, t('tray.insertOne')),
            h('button', {
              type: 'button',
              className: 'dsh-anno-row-action dsh-anno-row-remove',
              'data-anno-action': 'remove',
              'aria-label': t('action.remove'),
              title: t('action.remove'),
              onClick: function () { removeItem(item) },
            }, '×'))
        })),
      h('div', { className: 'dsh-anno-panel-foot' },
        h('button', {
          type: 'button',
          className: 'dsh-anno-row-action',
          'data-anno-action': 'copy',
          title: t('tray.copyHint'),
          onClick: copyAll,
        }, copied ? t('tray.copied') : t('tray.copy')),
        h('button', {
          type: 'button',
          className: 'dsh-anno-row-action dsh-anno-danger',
          'data-anno-action': 'clear',
          onClick: clearAll,
        }, confirmClear ? t('tray.confirmClear') : t('tray.clear')),
        h('span', { className: 'dsh-anno-spacer' }),
        undo !== null
          ? h('span', { className: 'dsh-anno-undo', role: 'status' },
            t('notice.removed'),
            h('button', { type: 'button', className: 'dsh-anno-undo-btn', 'data-anno-action': 'undo', onClick: undoRemove }, t('action.undo')))
          : (notice === null ? null : h('span', { className: 'dsh-anno-notice', role: 'status', 'data-anno-notice': 'panel' }, notice)),
        h('button', { type: 'button', className: 'dsh-anno-primary', 'data-anno-action': 'insert-all', onClick: insertAll }, t('tray.insert'))))

      return h(React.Fragment, null, h(Style), collapsed,
        createPortal === null ? panel : createPortal(panel, document.body))
    }

    // ---------------------------------------------------------------- plugin

    const name = 'text-annotations'
    const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'conversation']

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: ZH, en: EN })
      }, 'text-annotations: dictionaries')

      /* Return the keyboard to the composer after the tray inserted a digest. */
      focusComposer = function (sessionId) {
        const input = sessionInputOf(ctx, sessionId)
        if (input === null) return
        try {
          input.focus()
        } catch (error) {
          /* A busy submission phase can refuse focus; the draft is already inserted. */
        }
      }

      /*
       * Fallback admission: while the shipped Quote interaction is registered it
       * opens first and renders this plugin's toolbar through the replaced
       * `quote` cell. When Quote is absent, this consumer admits the same
       * selection gesture under its own key.
       */
      ctx.effect(function () {
        return ctx.uiConversation.interactions.register({
          id: 'annotate',
          onInteraction: function (request) {
            if (request.trigger !== 'selection' || request.readText() === null) return
            const binding = ctx.sessions.binding(request.sessionId)
            if (binding === undefined) return
            const session = binding.session.getSnapshot()
            if (session.removed || (session.subagent !== null && session.subagent.address.mode !== 'continuable')) return
            request.open()
          },
        })
      }, 'text-annotations: selection admission')

      ctx.slots.inject('conversation.chat.text-interaction', function () {
        return [
          /* Priority -1 shadows the shipped Quote surface: the lowest priority renders. */
          ctx.slots.register({ name: 'conversation.chat.text-interaction', key: 'quote', priority: -1, locale: NS }, AnnotationToolbar),
          ctx.slots.register({ name: 'conversation.chat.text-interaction', key: 'annotate', locale: NS }, AnnotationToolbar),
        ]
      })

      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register({ name: 'conversation.composer.dock', id: 'text-annotations', order: 5, locale: NS }, AnnotationTray)
      })
    }

    return { name: name, inject: inject, apply: apply }
  },
})
