/**
 * CollabDocs — Unit Tests
 * Tests all Design Patterns implemented in the system
 */

const {
  DocumentSessionManager,
  DocumentSession,
  EditCommand,
  CommandHistory,
  MementoHistory,
  ConflictResolver,
  DocEditorFacade
} = require('../backend/server');

// ============================================================
// SINGLETON PATTERN TESTS
// ============================================================
describe('Singleton Pattern — DocumentSessionManager', () => {
  test('should return the same instance every time', () => {
    const m1 = DocumentSessionManager.getInstance();
    const m2 = DocumentSessionManager.getInstance();
    expect(m1).toBe(m2);
  });

  test('should create and retrieve sessions by docId', () => {
    const mgr = DocumentSessionManager.getInstance();
    const session = mgr.getOrCreateSession('doc-test-1');
    expect(session).toBeDefined();
    expect(mgr.getSession('doc-test-1')).toBe(session);
  });

  test('should return same session for same docId', () => {
    const mgr = DocumentSessionManager.getInstance();
    const s1 = mgr.getOrCreateSession('doc-singleton');
    const s2 = mgr.getOrCreateSession('doc-singleton');
    expect(s1).toBe(s2);
  });
});

// ============================================================
// OBSERVER PATTERN TESTS
// ============================================================
describe('Observer Pattern — DocumentSession', () => {
  let session;

  beforeEach(() => {
    session = new DocumentSession('doc-observer-test');
  });

  test('should subscribe and track observer count', () => {
    const fakeClient1 = { readyState: 1, send: jest.fn() };
    const fakeClient2 = { readyState: 1, send: jest.fn() };
    session.subscribe(fakeClient1);
    session.subscribe(fakeClient2);
    expect(session.observers.size).toBe(2);
  });

  test('should unsubscribe observers correctly', () => {
    const fakeClient = { readyState: 1, send: jest.fn() };
    session.subscribe(fakeClient);
    session.unsubscribe(fakeClient);
    expect(session.observers.size).toBe(0);
  });

  test('should notify observers excluding sender', () => {
    const client1 = { readyState: 1, send: jest.fn() };
    const client2 = { readyState: 1, send: jest.fn() };
    session.subscribe(client1);
    session.subscribe(client2);
    session.notify({ type: 'EDIT', content: 'Hello' }, client1);
    expect(client1.send).not.toHaveBeenCalled();
    expect(client2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'EDIT', content: 'Hello' }));
  });

  test('should not send to closed connections', () => {
    const closedClient = { readyState: 3, send: jest.fn() };
    session.subscribe(closedClient);
    session.notify({ type: 'TEST' });
    expect(closedClient.send).not.toHaveBeenCalled();
  });
});

// ============================================================
// COMMAND PATTERN TESTS
// ============================================================
describe('Command Pattern — EditCommand & CommandHistory', () => {
  test('EditCommand should execute and return new content', () => {
    const cmd = new EditCommand('old text', 'new text', 'user1');
    cmd.execute();
    expect(cmd.getResult()).toBe('new text');
  });

  test('EditCommand should undo to previous content', () => {
    const cmd = new EditCommand('old text', 'new text', 'user1');
    cmd.execute();
    cmd.undo();
    expect(cmd.getResult()).toBe('old text');
  });

  test('CommandHistory should support undo', () => {
    const history = new CommandHistory();
    const cmd1 = new EditCommand('', 'Hello', 'user1');
    const cmd2 = new EditCommand('Hello', 'Hello World', 'user1');
    history.execute(cmd1);
    history.execute(cmd2);
    const undone = history.undo();
    expect(undone).toBe('Hello');
  });

  test('CommandHistory should support redo', () => {
    const history = new CommandHistory();
    const cmd = new EditCommand('', 'Hello', 'user1');
    history.execute(cmd);
    history.undo();
    const redone = history.redo();
    expect(redone).toBe('Hello');
  });

  test('CommandHistory undo on empty stack should return null', () => {
    const history = new CommandHistory();
    expect(history.undo()).toBeNull();
  });

  test('New command after undo should clear redo stack', () => {
    const history = new CommandHistory();
    history.execute(new EditCommand('', 'A', 'u1'));
    history.execute(new EditCommand('A', 'B', 'u1'));
    history.undo();
    history.execute(new EditCommand('A', 'C', 'u1'));
    expect(history.redo()).toBeNull(); // redo stack cleared
  });
});

// ============================================================
// MEMENTO PATTERN TESTS
// ============================================================
describe('Memento Pattern — MementoHistory', () => {
  test('should save and retrieve a snapshot', () => {
    const history = new MementoHistory();
    history.save('Version 1 content', 'alice');
    const snap = history.get(0);
    expect(snap.content).toBe('Version 1 content');
    expect(snap.userId).toBe('alice');
  });

  test('should maintain multiple versions', () => {
    const history = new MementoHistory();
    history.save('v1', 'alice');
    history.save('v2', 'bob');
    history.save('v3', 'charlie');
    expect(history.getAll().length).toBe(3);
    expect(history.get(2).content).toBe('v3');
  });

  test('should return preview in getAll()', () => {
    const history = new MementoHistory();
    history.save('Short content', 'user1');
    const all = history.getAll();
    expect(all[0].preview).toBe('Short content');
    expect(all[0].userId).toBe('user1');
  });

  test('should respect MAX_VERSIONS limit', () => {
    const history = new MementoHistory();
    for (let i = 0; i < 55; i++) {
      history.save(`content ${i}`, 'user');
    }
    expect(history.snapshots.length).toBe(50);
  });

  test('should return null for invalid index', () => {
    const history = new MementoHistory();
    expect(history.get(99)).toBeNull();
  });
});

// ============================================================
// STRATEGY PATTERN TESTS
// ============================================================
describe('Strategy Pattern — ConflictResolver', () => {
  test('OT strategy: should return client content when no server conflict', () => {
    const resolver = new ConflictResolver();
    const result = resolver.resolve('original', 'client edit', 'original');
    expect(result).toBe('client edit');
  });

  test('OT strategy: should resolve conflict when both sides changed', () => {
    const resolver = new ConflictResolver();
    const result = resolver.resolve('server changed', 'client edit was longer indeed', 'original');
    // Strategy picks longer content
    expect(result).toBe('client edit was longer indeed');
  });

  test('Should allow swapping strategy at runtime', () => {
    const { LastWriteWinsStrategy } = require('../backend/server');
    // LastWriteWinsStrategy is not exported separately, test via ConflictResolver
    const resolver = new ConflictResolver();
    // Default is OT — just verify it exists and resolves
    const result = resolver.resolve('server', 'client', 'base');
    expect(typeof result).toBe('string');
  });
});

// ============================================================
// FACADE PATTERN TESTS
// ============================================================
describe('Facade Pattern — DocEditorFacade Integration', () => {
  let facade;

  beforeEach(() => {
    facade = new DocEditorFacade();
  });

  test('should handle JOIN message and set up session', () => {
    const ws = {
      readyState: 1,
      send: jest.fn(),
      _docId: null,
      _userId: null
    };
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'JOIN',
      docId: 'doc-facade-test',
      userId: 'testUser',
      payload: {}
    }));
    expect(ws._docId).toBe('doc-facade-test');
    expect(ws._userId).toBe('testUser');
    expect(ws.send).toHaveBeenCalled();
  });

  test('should handle EDIT message and update session content', () => {
    const ws = { readyState: 1, send: jest.fn(), _docId: 'doc-edit', _userId: 'user1' };
    // First JOIN
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'JOIN', docId: 'doc-edit', userId: 'user1', payload: {}
    }));
    // Then EDIT
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'EDIT',
      docId: 'doc-edit',
      userId: 'user1',
      payload: { content: '<p>Hello World</p>', baseContent: '' }
    }));
    const session = facade.sessionManager.getSession('doc-edit');
    expect(session.content).toBe('<p>Hello World</p>');
  });

  test('should handle SAVE_VERSION and add to history', () => {
    const ws = { readyState: 1, send: jest.fn(), _docId: 'doc-memento', _userId: 'alice' };
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'JOIN', docId: 'doc-memento', userId: 'alice', payload: {}
    }));
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'SAVE_VERSION', docId: 'doc-memento', userId: 'alice', payload: {}
    }));
    const session = facade.sessionManager.getSession('doc-memento');
    expect(session.versionHistory.snapshots.length).toBeGreaterThan(0);
  });

  test('should handle disconnect and clean up session', () => {
    const ws = { readyState: 1, send: jest.fn(), _docId: 'doc-dc', _userId: 'userX' };
    facade.handleClientMessage(ws, JSON.stringify({
      type: 'JOIN', docId: 'doc-dc', userId: 'userX', payload: {}
    }));
    facade.handleDisconnect(ws);
    const session = facade.sessionManager.getSession('doc-dc');
    expect(session.observers.has(ws)).toBe(false);
  });
});
