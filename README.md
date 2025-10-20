# RCE - Refresh Context Engine

**Browser automation with time-travel debugging for AI agents.**

RCE provides live browser control, frame-by-frame DOM recording, and session persistence - built specifically for AI-driven web automation with full debugging capabilities.

## 🎯 Key Features

- **Live Browser Control** - Navigate, click, type, interact with web apps in real-time
- **RRWeb Time-Travel** - Frame-by-frame DOM recording with visual replay
- **Session Persistence** - Login state persists across restarts (OAuth, cookies, localStorage)
- **MCP Integration** - First-class support for Cursor and other MCP clients
- **Fast Actions** - 300-500ms per action with optimized IPC
- **Multi-Tab Support** - Automatic detection and per-tab recording
- **Console & Network Logs** - Complete debugging context with millisecond timestamps
- **Stealth Mode** - Bypasses basic bot detection for OAuth flows

## 🆚 How RCE Differs from Playwright MCP

| Feature | RCE | Playwright MCP |
|---------|-----|----------------|
| **Time-Travel Debugging** | ✅ RRWeb frame-by-frame replay | ❌ Screenshots only |
| **Session Persistence** | ✅ Auth state persists across restarts | ❌ Fresh session each time |
| **DOM Mutations** | ✅ Every keystroke/click captured | ❌ State-based snapshots |
| **Performance** | ⚡ 300-500ms actions | ~1-2s actions |
| **Multi-Session** | ✅ Fixed socket, rapid restarts | ❌ Slower restarts |
| **Use Case** | AI agents, long-running automation | Testing, one-off scripts |

**RCE is built for AI agents that need:**
- Persistent sessions across many interactions
- Complete debugging context for every action
- Time-travel to understand what went wrong
- Fast, repeated browser control

## 📦 Packages

This monorepo contains:

- **[@refresh-dev/rce](/packages/cli)** - CLI tool for browser recording and automation
- **[@refresh-dev/rce-mcp](/packages/mcp)** - Model Context Protocol server for Cursor integration

## 🚀 Quick Start

### For End Users (with Cursor/MCP):

**1. Install the CLI:**
```bash
npm install -g @refresh-dev/rce
```

**2. Add to Cursor MCP config** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "rce": {
      "command": "npx",
      "args": ["-y", "@refresh-dev/rce-mcp"],
      "env": {
        "RCE_WORK_DIR": "/path/to/your/project"  // Required!
      }
    }
  }
}
```

**Note:** `RCE_WORK_DIR` is required for MCP integration to locate your RCE session.

**3. Start RCE in your project:**
```bash
cd your-project
rce dev --url http://localhost:3000 --serverCmd "npm run dev"
```

**4. Use from Cursor:**
```
Agent: "Navigate to /login and sign in with test credentials"
```

The MCP tools handle browser automation while RCE records everything!

### For Developers (CLI only):

```bash
npm install -g @refresh-dev/rce

# Start recording
rce dev --url http://localhost:3000

# In another terminal - execute actions
rce action browser_navigate --json '{"url":"http://localhost:3000/app"}'
rce action browser_click --json '{"selector":"button.submit"}'

# Time-travel screenshots
rce frames                    # List captured frames
rce shot --index 50          # Screenshot at frame 50
rce diff --from 10 --to 50   # DOM diff
```

## 🎬 How It Works

```
Cursor AI Agent
    ↓
MCP Server (@refresh-dev/rce-mcp)
    ↓
RCE CLI (rce dev - long-running)
    ↓
Playwright/Chromium Browser
    ↓
Your Web App

Everything recorded:
  • RRWeb: DOM mutations
  • CDP: Screenshots every frame
  • Console: All logs
  • Network: All requests
  • Actions: Every interaction
```

**Storage:**
```
.rce/
  ├── control.sock           ← IPC for live control
  ├── storage-state.json     ← Auth persistence
  └── data/<session-id>/
      ├── rrweb/             ← Frame-by-frame DOM
      ├── screenshots/       ← Time-travel images
      ├── logs/              ← Console + network
      └── actions/           ← Action timeline
```

## 🔧 Configuration

**Optional config file** (`rce.config.json` in your project):

```json
{
  "url": "http://localhost:3000",
  "serverCmd": "npm run dev",
  "bootWaitMs": 1500,
  "viewport": { "width": 1280, "height": 800 },
  "ui": {
    "port": 43210
  }
}
```

**CLI Flags:**
```bash
rce dev --url URL              # App URL to open
        --serverCmd "cmd"      # Dev server to start
        --headless             # Run browser invisibly
        --clear-state          # Clear saved login/cookies
        --port N               # UI server port
```

## 🛠️ MCP Tools Available

When using with Cursor:

**Navigation & Interaction:**
- `rce_action_navigate` - Go to URL
- `rce_action_click` - Click elements
- `rce_action_type` - Type into inputs
- `rce_action_press-key` - Press keyboard keys
- `rce_action_hover` - Hover over elements

**Time-Travel:**
- `rce_frames` - List all captured frames
- `rce_shot` - Screenshot at specific frame
- `rce_diff` - DOM diff between frames
- `rce_screenshot-latest` - Current screenshot

**Tab Management:**
- `rce_tabs` - List all browser tabs

## 🎯 Use Cases

### **1. AI Agent Testing**
```
"Test the checkout flow: add product to cart, go to checkout, fill form, submit"
```
RCE records every step, you can replay failures frame-by-frame.

### **2. Session Recording for Debugging**
User reports bug → You have complete recording with console logs, network requests, and DOM state at every moment.

### **3. Authenticated Testing**
Log in once → Session persists → Agent can test authenticated features across many runs.

### **4. Visual Regression**
Compare screenshots at frame N across different builds.

## 🔐 Security & Privacy

- **Storage state contains auth tokens** - Add `.rce/storage-state.json` to `.gitignore`
- **Browser profile at `.rce/browser-profile/`** - Contains cookies, don't commit
- **Recordings may contain sensitive data** - Review before sharing

## 📖 Documentation

- [CLI Documentation](/packages/cli/README.md)
- [MCP Server Documentation](/packages/mcp/README.md)

## 🤝 Contributing

This is an open-source project under MIT license. Contributions welcome!

## 📜 License

MIT License - see [LICENSE](LICENSE) file

## 🙏 Acknowledgments

Built on:
- [Playwright](https://playwright.dev/) - Browser automation
- [RRWeb](https://www.rrweb.io/) - Session recording
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI integration

---

**Made by [Refresh](https://refresh.dev)** - Building the first AI app builder that integrates with your internal software.

