# @refresh-dev/rce

**CLI tool for browser automation with time-travel debugging.**

RCE (Refresh Context Engine) provides a command-line interface for recording and controlling browser sessions with frame-by-frame DOM capture.

## 📦 Installation

```bash
npm install -g @refresh-dev/rce
```

## 🚀 Quick Start

```bash
# Start recording your app
rce dev --url http://localhost:3000 --serverCmd "npm run dev"

# Browser opens, RRWeb starts recording
# Navigate, click, interact - everything is captured

# In another terminal - control the browser
rce action browser_navigate --json '{"url":"http://localhost:3000/login"}'
rce action browser_type --json '{"selector":"#email","text":"user@example.com"}'
rce action browser_click --json '{"selector":"button[type=submit]"}'

# View captured frames
rce frames

# Time-travel screenshot
rce shot --index 50

# Generate DOM diff
rce diff --from 10 --to 50 --format html
```

## 📖 Commands

### `rce dev`
Start browser recording session.

**Options:**
- `--url URL` - Initial URL to navigate to
- `--serverCmd "cmd"` - Dev server command to run
- `--headless` - Run browser invisibly
- `--clear-state` - Clear saved cookies/login
- `--port N` - UI server port (default: 43210)

**Example:**
```bash
rce dev --url http://localhost:5173 --serverCmd "npm run dev"
```

### `rce action`
Execute browser action on running session.

**Available actions:**
- `browser_navigate` - Navigate to URL
- `browser_click` - Click element (by CSS selector)
- `browser_type` - Type into input
- `browser_press_key` - Press keyboard key
- `browser_hover` - Hover over element
- `browser_snapshot` - Get HTML snapshot

**Example:**
```bash
rce action browser_click --json '{"selector":"#submit-btn"}'
```

### `rce frames`
List all captured frames with timestamps.

```bash
rce frames --json
```

### `rce shot`
Generate screenshot at specific frame.

```bash
rce shot --index 50              # Frame index
rce shot --at "+5000"            # 5 seconds from start
rce shot --at "2025-10-19T12:00" # Specific timestamp
```

### `rce diff`
Generate DOM diff between two frames.

```bash
rce diff --from 10 --to 50 --format html
rce diff --from 10 --to 50 --format json
```

### `rce screenshot`
Get latest screenshot.

```bash
rce screenshot --json
```

### `rce tabs`
List browser tabs.

```bash
rce tabs list --json
```

## 🎯 Use with MCP

For Cursor integration, use the MCP server: `@refresh-dev/rce-mcp`

## 📁 Output Structure

```
.rce/
  ├── control.sock           # IPC socket for live control
  ├── storage-state.json     # Saved cookies/auth (persists login)
  └── data/<session-id>/
      ├── rrweb/
      │   ├── events.rrweb.jsonl  # DOM mutations
      │   └── frames.jsonl        # Frame index
      ├── screenshots/
      │   ├── latest.png          # Current screenshot
      │   └── shot_*.png          # Time-travel screenshots
      ├── logs/
      │   ├── console.jsonl       # Browser console
      │   ├── network.jsonl       # HTTP requests
      │   └── js_errors.jsonl     # JavaScript errors
      └── actions/
          └── actions.jsonl       # Action timeline
```

## ⚙️ Configuration File

Create `rce.config.json` in your project directory:

```json
{
  "url": "http://localhost:3000",
  "serverCmd": "npm run dev",
  "bootWaitMs": 1500,
  "viewport": { "width": 1280, "height": 800 },
  "rrweb": {
    "recordCanvas": true,
    "collectFonts": true,
    "sampling": { "mousemove": 50, "input": "last" }
  },
  "ui": {
    "port": 43210,
    "screencastFps": 12,
    "jpegQuality": 70
  }
}
```

## 🔐 Session Persistence

RCE automatically saves browser state (cookies, localStorage) so login persists:

**Login once:**
```bash
rce dev --url http://localhost:3000
# Log in via browser UI
# Ctrl+C to stop
```

**Next session - already logged in:**
```bash
rce dev --url http://localhost:3000
# Opens with saved session ✓
```

**Clear saved session:**
```bash
rce dev --clear-state
```

## 🎥 UI Server

While `rce dev` runs, visit http://localhost:43210 to see:
- Live browser feed
- Real-time screenshot stream
- Session metadata

## 🐛 Debugging

**View logs:**
```bash
tail -f .rce/data/<session-id>/logs/console.jsonl
tail -f .rce/data/<session-id>/logs/network.jsonl
```

**Replay session:**
```bash
rce serve  # Opens UI server for replay
```

## 📝 License

MIT

