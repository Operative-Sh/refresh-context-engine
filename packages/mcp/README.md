# @refresh-dev/rce-mcp

**Model Context Protocol server for RCE browser automation.**

Integrates RCE (Refresh Context Engine) with Cursor and other MCP clients, enabling AI agents to control browsers with time-travel debugging.

## 📦 Installation

**The MCP server requires the CLI to be installed:**

```bash
npm install -g @refresh-dev/rce
npm install -g @refresh-dev/rce-mcp
```

Or use via npx (recommended):

```json
{
  "mcpServers": {
    "rce": {
      "command": "npx",
      "args": ["-y", "@refresh-dev/rce-mcp"],
      "env": {
        "RCE_WORK_DIR": "/path/to/your/project"
      }
    }
  }
}
```

## ⚙️ Configuration

Add to your Cursor MCP config file:

**macOS/Linux:** `~/.cursor/mcp.json`
**Windows:** `%APPDATA%\Cursor\mcp.json`

### Basic Config (Auto-detect session):
```json
{
  "rce": {
    "command": "npx",
    "args": ["-y", "@refresh-dev/rce-mcp"]
  }
}
```

### With Project Path:
```json
{
  "rce": {
    "command": "npx",
    "args": ["-y", "@refresh-dev/rce-mcp"],
    "env": {
      "RCE_WORK_DIR": "/Users/you/projects/my-app"
    }
  }
}
```

### Multiple Projects:
```json
{
  "rce-frontend": {
    "command": "npx",
    "args": ["-y", "@refresh-dev/rce-mcp"],
    "env": {
      "RCE_WORK_DIR": "/path/to/frontend"
    }
  },
  "rce-admin": {
    "command": "npx",
    "args": ["-y", "@refresh-dev/rce-mcp"],
    "env": {
      "RCE_WORK_DIR": "/path/to/admin-panel"
    }
  }
}
```

## 🚀 Usage

**1. Start RCE session:**
```bash
cd your-project
rce dev --url http://localhost:3000 --serverCmd "npm run dev"
```

**2. Restart MCP servers in Cursor:**
```
Cmd+Shift+P → "MCP: Restart All Servers"
```

**3. Use AI agent:**
```
"Navigate to /login, enter email test@example.com, click sign in"
```

## 🛠️ Available Tools

The MCP server exposes these tools to AI agents:

### Navigation & Interaction
- `mcp_rce_rce_action_navigate({url})` - Navigate to URL
- `mcp_rce_rce_action_click({selector})` - Click element
- `mcp_rce_rce_action_type({selector, text})` - Type into input
- `mcp_rce_rce_action_press-key({key})` - Press keyboard key
- `mcp_rce_rce_action_hover({selector})` - Hover over element

### Screenshots & Recording
- `mcp_rce_rce_screenshot-latest()` - Get current screenshot
- `mcp_rce_rce_frames()` - List all captured frames
- `mcp_rce_rce_shot({index})` - Time-travel screenshot
- `mcp_rce_rce_diff({from, to})` - DOM diff between frames

### Tab Management
- `mcp_rce_rce_tabs()` - List browser tabs

### Advanced
- `mcp_rce_rce_action_snapshot()` - Get HTML snapshot
- `mcp_rce_rce_action_wait-for({selector, state})` - Wait for element

## 🔍 How It Works

The MCP server:
1. Spawns `rce action` commands with your parameters
2. Connects to running RCE session via Unix socket
3. Returns results to the AI agent

**Architecture:**
```
Cursor → MCP Server → rce action → Socket → RCE Recorder → Browser
```

## 🎯 Example Agent Workflow

```
Agent: "Go to the app and create a new todo item"

  1. mcp_rce_rce_action_navigate({url: "http://localhost:3000/todos"})
  2. mcp_rce_rce_action_click({selector: "button.new-todo"})
  3. mcp_rce_rce_action_type({selector: "input.todo-text", text: "Buy milk"})
  4. mcp_rce_rce_action_click({selector: "button.save"})
  5. mcp_rce_rce_screenshot-latest() → Verify todo created
  
All recorded for later replay! 📹
```

## 🐛 Troubleshooting

**"Recorder not running" error:**
```bash
# Make sure RCE is running in your project:
cd your-project
rce dev --url http://localhost:3000
```

**"ENOENT: no such file" error:**
- Check `RCE_WORK_DIR` points to correct project
- Ensure RCE session is active

**Actions timeout:**
- Increase Playwright timeout (default: 30s)
- Check if selector is correct
- Use `mcp_rce_rce_action_snapshot()` to see current DOM

## 📝 License

MIT

