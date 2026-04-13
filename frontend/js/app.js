/**
 * CollabDocs — Frontend Client
 * Design Patterns (Client Side):
 *   - Observer: WebSocket message handlers
 *   - Command: Local undo stack
 *   - Facade: CollabDocClient wraps all WS logic
 *   - Strategy: Cursor color assignment
 */

'use strict';

// ============================================================
// UTILITY — Color palette for user cursors (Strategy-like)
// ============================================================
const USER_COLORS = [
  '#e8c77d', '#7ecfb0', '#b07ef8',
  '#f07070', '#70b8f0', '#f0a870',
  '#70f0c0', '#e870b0'
];
let colorIndex = 0;
function assignColor() {
  return USER_COLORS[colorIndex++ % USER_COLORS.length];
}

// ============================================================
// COMMAND PATTERN — Client-side local undo (for offline use)
// ============================================================
class LocalEditCommand {
  constructor(prev, next) {
    this.prev = prev;
    this.next = next;
  }
  execute() { return this.next; }
  undo()    { return this.prev; }
}

class LocalCommandStack {
  constructor() {
    this.stack = [];
    this.pointer = -1;
  }
  push(cmd) {
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push(cmd);
    this.pointer++;
  }
  undo() {
    if (this.pointer >= 0) {
      return this.stack[this.pointer--].undo();
    }
    return null;
  }
  redo() {
    if (this.pointer < this.stack.length - 1) {
      return this.stack[++this.pointer].execute();
    }
    return null;
  }
}

// ============================================================
// OBSERVER / FACADE — CollabDocClient
// Acts as Facade: hides WebSocket, JSON, reconnect logic
// Acts as Observer hub: dispatches events to UI handlers
// ============================================================
class CollabDocClient {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.docId = null;
    this.userColor = null;
    this.activeUsers = new Map(); // userId -> {color, avatar}
    this.commandStack = new LocalCommandStack();
    this.handlers = {}; // event type -> callback[]
    this.isUpdatingFromRemote = false;
  }

  // Observer: register handler
  on(type, fn) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  }

  // Observer: dispatch to all handlers
  _emit(type, data) {
    (this.handlers[type] || []).forEach(fn => fn(data));
  }

  connect(userId, docId) {
    this.userId = userId;
    this.docId = docId;
    this.userColor = assignColor();

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}`);

    this.ws.onopen = () => {
      this._emit('connected', {});
      this.send({ type: 'JOIN', userId, docId });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._handleServerMessage(msg);
      } catch (err) {
        console.error('Parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this._emit('disconnected', {});
    };

    this.ws.onerror = (e) => {
      this._emit('error', e);
    };
  }

  _handleServerMessage(msg) {
    switch (msg.type) {
      case 'INIT':
        this._emit('init', msg);
        break;
      case 'EDIT':
        this._emit('remoteEdit', msg);
        break;
      case 'USER_JOINED':
        this._registerUser(msg.userId);
        this._emit('userJoined', msg);
        break;
      case 'USER_LEFT':
        this._emit('userLeft', msg);
        this.activeUsers.delete(msg.userId);
        break;
      case 'VERSION_SAVED':
        this._emit('versionSaved', msg);
        break;
      case 'CURSOR':
        this._emit('remoteCursor', msg);
        break;
      default:
        console.warn('Unknown msg:', msg.type);
    }
  }

  _registerUser(userId) {
    if (!this.activeUsers.has(userId)) {
      this.activeUsers.set(userId, {
        color: assignColor(),
        initial: userId.charAt(0).toUpperCase()
      });
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, docId: this.docId, userId: this.userId }));
    }
  }

  sendEdit(content, baseContent) {
    this.send({ type: 'EDIT', payload: { content, baseContent } });
  }

  sendCursor(position) {
    this.send({ type: 'CURSOR', payload: { position, color: this.userColor } });
  }

  saveVersion() {
    this.send({ type: 'SAVE_VERSION', payload: {} });
  }

  restoreVersion(index) {
    this.send({ type: 'RESTORE_VERSION', payload: { index } });
  }

  requestUndo() {
    this.send({ type: 'UNDO', payload: {} });
  }
}

// ============================================================
// UI CONTROLLER
// ============================================================
class EditorUI {
  constructor(client) {
    this.client = client;
    this.lastContent = '';
    this.versions = [];

    this.$loginScreen  = document.getElementById('login-screen');
    this.$editorScreen = document.getElementById('editor-screen');
    this.$editor       = document.getElementById('editor');
    this.$badge        = document.getElementById('connection-badge');
    this.$docTitle     = document.getElementById('doc-title');
    this.$activeUsers  = document.getElementById('active-users');
    this.$activityLog  = document.getElementById('activity-log');
    this.$wordCount    = document.getElementById('word-count');
    this.$charCount    = document.getElementById('char-count');
    this.$versionList  = document.getElementById('version-list');

    this._bindLoginUI();
    this._bindEditorUI();
    this._bindClientEvents();
  }

  _bindLoginUI() {
    document.getElementById('join-btn').addEventListener('click', () => this._doJoin());
    document.getElementById('username-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('docid-input').focus();
    });
    document.getElementById('docid-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._doJoin();
    });
  }

  _doJoin() {
    const userId = document.getElementById('username-input').value.trim();
    const docId  = document.getElementById('docid-input').value.trim();
    if (!userId || !docId) {
      alert('Please enter your name and a document ID.');
      return;
    }
    this.$docTitle.textContent = docId;
    this.$loginScreen.classList.remove('active');
    this.$editorScreen.classList.add('active');
    this.client.connect(userId, docId);
  }

  _bindEditorUI() {
    // Formatting buttons
    document.querySelectorAll('.fmt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        this.$editor.focus();
      });
    });

    // Font size
    document.getElementById('font-size-select').addEventListener('change', (e) => {
      document.execCommand('fontSize', false, '7');
      const fonts = document.querySelectorAll('[size="7"]');
      fonts.forEach(f => {
        f.removeAttribute('size');
        f.style.fontSize = e.target.value;
      });
    });

    // Editor input — send edits with debounce
    let editTimer;
    this.$editor.addEventListener('input', () => {
      if (this.client.isUpdatingFromRemote) return;
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        const content = this.$editor.innerHTML;
        this.client.sendEdit(content, this.lastContent);
        this.lastContent = content;
        this._updateCounts();
        this._flashDot('pi-observer');
        this._flashDot('pi-command');
      }, 150);
    });

    // Toolbar buttons
    document.getElementById('save-version-btn').addEventListener('click', () => {
      this.client.saveVersion();
      this._flashDot('pi-memento');
    });

    document.getElementById('undo-btn').addEventListener('click', () => {
      this.client.requestUndo();
      this._flashDot('pi-command');
    });

    // History modal
    document.getElementById('history-btn').addEventListener('click', () => this._openModal());
    document.getElementById('close-modal').addEventListener('click', () => this._closeModal());
    document.getElementById('modal-overlay').addEventListener('click', () => this._closeModal());

    // Panel tabs
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`[data-content="${tab.dataset.tab}"]`).classList.add('active');
      });
    });
  }

  _bindClientEvents() {
    const client = this.client;

    client.on('connected', () => {
      this.$badge.textContent = '● Connected';
      this.$badge.className = 'badge badge-connected';
      this._log('system', 'Connected to server');
    });

    client.on('disconnected', () => {
      this.$badge.textContent = '● Disconnected';
      this.$badge.className = 'badge badge-error';
      this._log('system', 'Disconnected from server');
    });

    client.on('init', (msg) => {
      client.isUpdatingFromRemote = true;
      this.$editor.innerHTML = msg.content || '';
      this.lastContent = msg.content || '';
      client.isUpdatingFromRemote = false;
      this.versions = msg.versions || [];
      this._updateCounts();
      this._log('system', `Document loaded. ${this.versions.length} version(s) in history.`);
    });

    client.on('remoteEdit', (msg) => {
      if (msg.userId === client.userId) return;
      client.isUpdatingFromRemote = true;
      // Preserve cursor position
      const sel = window.getSelection();
      this.$editor.innerHTML = msg.content;
      this.lastContent = msg.content;
      client.isUpdatingFromRemote = false;
      this._updateCounts();
      this._flashDot('pi-strategy');
      this._log(msg.userId, 'edited the document');
    });

    client.on('userJoined', (msg) => {
      this._updateUserAvatars();
      this._log(msg.userId, 'joined the document');
    });

    client.on('userLeft', (msg) => {
      this._updateUserAvatars();
      this._log(msg.userId, 'left the document');
    });

    client.on('versionSaved', (msg) => {
      this.versions = msg.versions || [];
      this._log(msg.savedBy, `saved a version (v${this.versions.length})`);
    });

    client.on('error', () => {
      this.$badge.textContent = '● Error';
      this.$badge.className = 'badge badge-error';
    });
  }

  _updateUserAvatars() {
    this.$activeUsers.innerHTML = '';
    // Always show self
    const selfDiv = document.createElement('div');
    selfDiv.className = 'user-avatar';
    selfDiv.style.background = this.client.userColor;
    selfDiv.style.color = '#111';
    selfDiv.textContent = this.client.userId.charAt(0).toUpperCase();
    selfDiv.title = this.client.userId + ' (you)';
    this.$activeUsers.appendChild(selfDiv);

    this.client.activeUsers.forEach((info, userId) => {
      const div = document.createElement('div');
      div.className = 'user-avatar';
      div.style.background = info.color;
      div.style.color = '#111';
      div.textContent = info.initial;
      div.title = userId;
      this.$activeUsers.appendChild(div);
    });
  }

  _log(userId, action) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const now = new Date().toLocaleTimeString();
    const isSystem = userId === 'system';
    entry.innerHTML = `
      <div class="le-time">${now}</div>
      <div>
        <span class="le-user">${isSystem ? '⬡ System' : userId}</span>
        <span class="le-action"> ${action}</span>
      </div>
    `;
    this.$activityLog.prepend(entry);
    // Keep max 30 entries
    while (this.$activityLog.children.length > 30) {
      this.$activityLog.removeChild(this.$activityLog.lastChild);
    }
  }

  _updateCounts() {
    const text = this.$editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    this.$wordCount.textContent = `Words: ${words}`;
    this.$charCount.textContent = `Chars: ${text.length}`;
  }

  _flashDot(cls) {
    const dot = document.querySelector(`.${cls}`);
    if (!dot) return;
    dot.classList.add('active');
    setTimeout(() => dot.classList.remove('active'), 1000);
  }

  _openModal() {
    document.getElementById('history-modal').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
    this._renderVersions();
  }

  _closeModal() {
    document.getElementById('history-modal').classList.add('hidden');
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  _renderVersions() {
    if (!this.versions.length) {
      this.$versionList.innerHTML = '<p class="no-versions">No saved versions yet. Click "Save Version" to create one.</p>';
      return;
    }
    this.$versionList.innerHTML = '';
    [...this.versions].reverse().forEach((v, i) => {
      const realIndex = this.versions.length - 1 - i;
      const item = document.createElement('div');
      item.className = 'version-item';
      item.innerHTML = `
        <div class="vi-meta">
          <strong>Version ${realIndex + 1}</strong>
          <span>${v.timestamp} · by ${v.userId}</span>
          <p>${v.preview || '(empty)'}</p>
        </div>
        <button class="btn-restore" data-index="${realIndex}">Restore</button>
      `;
      item.querySelector('.btn-restore').addEventListener('click', () => {
        if (confirm(`Restore to Version ${realIndex + 1}?`)) {
          this.client.restoreVersion(realIndex);
          this._closeModal();
          this._log('system', `Restored to version ${realIndex + 1}`);
          this._flashDot('pi-memento');
        }
      });
      this.$versionList.appendChild(item);
    });
  }
}

// ============================================================
// BOOT
// ============================================================
const client = new CollabDocClient();
const ui = new EditorUI(client);
