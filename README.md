# CollabDocs — Real-Time Collaborative Document Editor
## Software Patterns Project

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm

### Installation
```bash
npm install
```

### Run the App
```bash
npm start
```

Open `http://localhost:3000` in **two or more browser tabs** to test real-time collaboration.

---

## 🧪 Run Tests
```bash
npm test
# With coverage:
npm test -- --coverage
```

---

## 📐 Design Patterns Used

| Pattern | Location | Purpose |
|---|---|---|
| **Observer** | `DocumentSession` (backend) + WS handlers (frontend) | Broadcast edits to all connected clients |
| **Command** | `EditCommand`, `CommandHistory` | Encapsulate edits; enable undo/redo |
| **Memento** | `MementoHistory`, `Memento` | Save and restore document versions |
| **Strategy** | `ConflictResolver`, `OperationalTransformStrategy` | Pluggable conflict resolution algorithms |
| **Singleton** | `DocumentSessionManager` | One session manager across the app |
| **Facade** | `DocEditorFacade` | Unified API hiding WS + session complexity |

---

## 🏗 Architecture

```
Event-Driven Architecture + MVC

Browser (Frontend)
  ├── index.html       → View
  ├── css/style.css    → Styling
  └── js/app.js        → Controller (CollabDocClient + EditorUI)
         │
         │ WebSocket (Event-Driven)
         ▼
Node.js (Backend)
  └── backend/server.js
        ├── DocEditorFacade       ← Facade Pattern
        ├── DocumentSessionManager ← Singleton
        ├── DocumentSession        ← Observer
        ├── EditCommand/History    ← Command
        ├── MementoHistory         ← Memento
        └── ConflictResolver       ← Strategy
```

---

## 🔍 SonarCloud Setup

1. Push code to GitHub (public repo)
2. Go to https://sonarcloud.io → Login with GitHub
3. Import your repository
4. Update `sonar-project.properties` with your org key
5. Run: `npm test -- --coverage` then `sonar-scanner`

---

## 📋 Design Principles Followed

- **SRP**: Each class has one responsibility (Session, Command, Conflict, Version are separate)
- **OCP**: Add new conflict strategies without modifying ConflictResolver
- **DIP**: High-level Facade depends on abstractions, not concrete strategies
- **ISP**: Separate observer/command/memento interfaces
- **DRY**: Shared notification logic in `DocumentSession.notify()`
