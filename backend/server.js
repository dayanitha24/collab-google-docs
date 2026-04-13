/**
 * Collaborative Google Docs - Backend Server
 * Architectural Pattern: Event-Driven + MVC
 * Design Patterns: Observer, Command, Singleton, Facade
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// SINGLETON PATTERN - DocumentSessionManager
// Ensures only one session manager exists across the app
// ============================================================
class DocumentSessionManager {
  constructor() {
    if (DocumentSessionManager._instance) {
      return DocumentSessionManager._instance;
    }
    this.sessions = new Map(); // docId -> DocumentSession
    DocumentSessionManager._instance = this;
  }

  static getInstance() {
    if (!DocumentSessionManager._instance) {
      new DocumentSessionManager();
    }
    return DocumentSessionManager._instance;
  }

  getOrCreateSession(docId) {
    if (!this.sessions.has(docId)) {
      this.sessions.set(docId, new DocumentSession(docId));
    }
    return this.sessions.get(docId);
  }

  getSession(docId) {
    return this.sessions.get(docId);
  }
}

// ============================================================
// OBSERVER PATTERN - DocumentSession
// Observers (clients) subscribe to document changes
// ============================================================
class DocumentSession {
  constructor(docId) {
    this.docId = docId;
    this.observers = new Set(); // WebSocket clients
    this.content = '';
    this.versionHistory = new MementoHistory(); // Memento Pattern
    this.commandHistory = new CommandHistory(); // Command Pattern
  }

  // Observer: subscribe
  subscribe(client) {
    this.observers.add(client);
    console.log(`[Observer] Client joined doc: ${this.docId}. Total: ${this.observers.size}`);
  }

  // Observer: unsubscribe
  unsubscribe(client) {
    this.observers.delete(client);
    console.log(`[Observer] Client left doc: ${this.docId}. Total: ${this.observers.size}`);
  }

  // Observer: notify all except sender
  notify(data, sender = null) {
    const message = JSON.stringify(data);
    this.observers.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  applyEdit(command) {
    this.commandHistory.execute(command);
    this.content = command.getResult();
  }

  saveVersion(userId) {
    this.versionHistory.save(this.content, userId);
  }

  restoreVersion(index) {
    const memento = this.versionHistory.get(index);
    if (memento) {
      this.content = memento.content;
      return true;
    }
    return false;
  }
}

// ============================================================
// COMMAND PATTERN - Edit Commands
// Encapsulates each edit as an object (enables undo/redo)
// ============================================================
class EditCommand {
  constructor(prevContent, newContent, userId, timestamp) {
    this.prevContent = prevContent;
    this.newContent = newContent;
    this.userId = userId;
    this.timestamp = timestamp || Date.now();
    this._result = newContent;
  }

  execute() {
    this._result = this.newContent;
    return this._result;
  }

  undo() {
    this._result = this.prevContent;
    return this._result;
  }

  getResult() {
    return this._result;
  }
}

class CommandHistory {
  constructor() {
    this.history = [];
    this.pointer = -1;
  }

  execute(command) {
    // Remove redo history if new command comes in
    this.history = this.history.slice(0, this.pointer + 1);
    command.execute();
    this.history.push(command);
    this.pointer++;
  }

  undo() {
    if (this.pointer >= 0) {
      const cmd = this.history[this.pointer];
      const result = cmd.undo();
      this.pointer--;
      return result;
    }
    return null;
  }

  redo() {
    if (this.pointer < this.history.length - 1) {
      this.pointer++;
      const cmd = this.history[this.pointer];
      return cmd.execute();
    }
    return null;
  }
}

// ============================================================
// MEMENTO PATTERN - Version History
// Stores document snapshots without exposing internals
// ============================================================
class Memento {
  constructor(content, userId, timestamp) {
    this.content = content;
    this.userId = userId;
    this.timestamp = timestamp || new Date().toISOString();
  }
}

class MementoHistory {
  constructor() {
    this.snapshots = [];
    this.MAX_VERSIONS = 50;
  }

  save(content, userId) {
    if (this.snapshots.length >= this.MAX_VERSIONS) {
      this.snapshots.shift(); // Remove oldest
    }
    this.snapshots.push(new Memento(content, userId));
    return this.snapshots.length - 1;
  }

  get(index) {
    return this.snapshots[index] || null;
  }

  getAll() {
    return this.snapshots.map((m, i) => ({
      index: i,
      userId: m.userId,
      timestamp: m.timestamp,
      preview: m.content.substring(0, 60) + (m.content.length > 60 ? '...' : '')
    }));
  }
}

// ============================================================
// STRATEGY PATTERN - Conflict Resolution
// Different strategies for resolving concurrent edits
// ============================================================
class LastWriteWinsStrategy {
  resolve(serverContent, clientContent) {
    return clientContent; // Client always wins
  }
}

class OperationalTransformStrategy {
  resolve(serverContent, clientContent, baseContent) {
    // Simplified OT: if server changed differently, merge
    if (serverContent === baseContent) {
      return clientContent; // No conflict
    }
    // Real OT would transform operations — here we do a simple merge
    return clientContent.length > serverContent.length ? clientContent : serverContent;
  }
}

class ConflictResolver {
  constructor(strategy = new OperationalTransformStrategy()) {
    this.strategy = strategy;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  resolve(serverContent, clientContent, baseContent) {
    return this.strategy.resolve(serverContent, clientContent, baseContent);
  }
}

// ============================================================
// FACADE PATTERN - DocEditorFacade
// Simplifies the complex subsystem interaction
// ============================================================
class DocEditorFacade {
  constructor() {
    this.sessionManager = DocumentSessionManager.getInstance();
    this.conflictResolver = new ConflictResolver();
  }

  handleClientMessage(ws, rawMessage) {
    let msg;
    try {
      msg = JSON.parse(rawMessage);
    } catch (e) {
      console.error('Invalid JSON:', e.message);
      return;
    }

    const { type, docId, userId, payload } = msg;
    const session = this.sessionManager.getOrCreateSession(docId);

    switch (type) {
      case 'JOIN':
        session.subscribe(ws);
        ws._docId = docId;
        ws._userId = userId;
        ws.send(JSON.stringify({
          type: 'INIT',
          content: session.content,
          versions: session.versionHistory.getAll()
        }));
        session.notify({ type: 'USER_JOINED', userId }, ws);
        break;

      case 'EDIT':
        const resolved = this.conflictResolver.resolve(
          session.content,
          payload.content,
          payload.baseContent || ''
        );
        const cmd = new EditCommand(session.content, resolved, userId);
        session.applyEdit(cmd);
        session.notify({ type: 'EDIT', content: resolved, userId, timestamp: Date.now() }, ws);
        break;

      case 'SAVE_VERSION':
        const idx = session.saveVersion(userId);
        session.notify({
          type: 'VERSION_SAVED',
          versions: session.versionHistory.getAll(),
          savedBy: userId
        });
        break;

      case 'RESTORE_VERSION':
        const ok = session.restoreVersion(payload.index);
        if (ok) {
          session.notify({
            type: 'EDIT',
            content: session.content,
            userId: 'system',
            timestamp: Date.now()
          });
        }
        break;

      case 'CURSOR':
        session.notify({ type: 'CURSOR', userId, position: payload.position, color: payload.color }, ws);
        break;

      case 'UNDO':
        const undone = session.commandHistory.undo();
        if (undone !== null) {
          session.content = undone;
          session.notify({ type: 'EDIT', content: undone, userId: 'undo', timestamp: Date.now() });
        }
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  handleDisconnect(ws) {
    const { _docId, _userId } = ws;
    if (_docId) {
      const session = this.sessionManager.getSession(_docId);
      if (session) {
        session.unsubscribe(ws);
        session.notify({ type: 'USER_LEFT', userId: _userId });
      }
    }
  }
}

// ============================================================
// HTTP + WebSocket Server Setup
// ============================================================
const facade = new DocEditorFacade();

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, '../frontend', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('[WebSocket] New connection');

  ws.on('message', (message) => {
    facade.handleClientMessage(ws, message);
  });

  ws.on('close', () => {
    facade.handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket Error]', err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ Collaborative Docs Server running at http://localhost:${PORT}`);
  console.log(`   WebSocket ready on ws://localhost:${PORT}`);
});

module.exports = {
  DocumentSessionManager,
  DocumentSession,
  EditCommand,
  CommandHistory,
  MementoHistory,
  ConflictResolver,
  DocEditorFacade
};
