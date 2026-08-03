# vibeshell

An open-source **desktop app for running multiple AI coding agents at once** — tiled panes, workspaces, and multiple providers — built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

> **Status: pre-alpha.** Actively building the desktop app (phase D2 of the roadmap). Expect sharp edges.

## Why vibeshell?

- **Many agents, one window** — run several sessions side by side in resizable panes, grouped into workspaces.
- **Multi-provider** — Claude today, with a provider seam so others (e.g. OpenAI) slot in without touching the UI.
- **Open and hackable** — extension points (commands, hooks, subagents, MCP) are the product, not an afterthought.
- **No telemetry.** Ever. Your code and prompts go to the model provider you configure, and nowhere else.

## Architecture

Three parts (see `agentic-dev-env-roadmap.md` for the full picture):

- **Engine** (`src/`) — a Node service that manages agent sessions over a provider seam and exposes them over a local WebSocket (the sidecar, `src/server.ts`).
- **Front-end** (`desktop/src/`) — a React UI that connects to the engine and renders each session's event stream as a pane.
- **Shell** (`desktop/src-tauri/`) — a thin [Tauri](https://tauri.app) (Rust) app that hosts the webview and window.

## Development

### Prerequisites

- Node ≥ 20 and [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (for the Tauri shell) — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Xcode Command Line Tools (macOS) / the [Tauri system deps](https://v2.tauri.app/start/prerequisites/) for your OS
- `export ANTHROPIC_API_KEY=sk-ant-...` (or sign in via `claude` / the Claude Agent SDK's auth)
- For the Grok provider: `export XAI_API_KEY=xai-...` (a developer key from console.x.ai — separate from a SuperGrok/X consumer subscription)

### Run the desktop app

```sh
pnpm install                 # engine deps
pnpm -C desktop install      # front-end deps
pnpm dev                     # starts the engine sidecar + the desktop app together
```

`pnpm dev` runs both processes via `concurrently`. The engine's working directory (where you run it) is the directory the agent operates on. To run them separately:

```sh
pnpm dev:engine              # WebSocket engine on ws://localhost:4517
pnpm dev:desktop             # Tauri window (needs Rust on PATH)
```

### Engine package scripts

```sh
pnpm build       # bundle the engine + sidecar to dist/
pnpm test        # vitest (engine unit tests)
pnpm typecheck   # tsc --noEmit
pnpm lint        # prettier --check
```

The `desktop/` app manages its own toolchain and is excluded from the engine's CI.

## Extensibility

**MCP servers.** Drop a `.mcp.json` in the working directory (the Claude Code convention) and vibeshell loads it for that session:

```json
{
  "mcpServers": {
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" }
  }
}
```

MCP tool calls go through the same approval prompt as any other gated tool.

**Custom slash commands.** A `<name>.md` under `.vibeshell/commands/` (or `.claude/commands/`) becomes `/name`. Sending `/name args` expands the template (`$ARGUMENTS` → your args) before the agent sees it.

**Subagents.** A `<name>.md` under `.vibeshell/agents/` (frontmatter `description` / optional `tools`, `model`; body is the system prompt) becomes a subagent the main agent can delegate to.

## Providers

Pick a provider in the top bar. **Claude** (default) runs on the Claude Agent SDK. **Grok** (xAI) runs on our own agent loop against xAI's OpenAI-compatible API (`XAI_API_KEY`) — useful as a fallback when Claude is rate-limited. Both go through the same approval, undo, and worktree layers. Every layer above the provider is provider-agnostic, so adding another backend is one adapter file behind `src/agent/providers/`.

## Self-hosted development (building vibeshell in vibeshell)

vibeshell is itself a coding agent operating on whatever directory the engine runs in — so it can improve its own code. Toggle **isolate** in the top bar and each new session runs in its own git worktree on a branch (`vibeshell/<sessionId>`): edits never touch your main checkout or other sessions, and on close the work is committed to that branch for you to review and merge. This is the safe way to let the agent edit the engine that's running it.

## Remote access (connecting from another machine)

The engine binds to `127.0.0.1` by default and has **no authentication** — a
session is arbitrary code execution as you. Never expose it directly on a LAN or
the public internet. To drive it from another machine (e.g. a Linux laptop
talking to the engine on your Mac), tunnel over a trusted boundary.

### Recommended: SSH tunnel

Leave the engine on loopback (its default) and forward the port from the client:

```sh
# on the engine host (your Mac): run the engine as usual — bound to 127.0.0.1:4517
pnpm dev:engine

# on the client (the Linux laptop): forward local 4517 → the Mac's engine
ssh -N -L 4517:localhost:4517 you@your-mac
```

Now the UI on the laptop uses the default `ws://localhost:4517` — no config, no
exposed port, and the traffic rides SSH's encryption:

```sh
pnpm -C desktop dev            # Tauri window (or a browser at the Vite dev URL)
```

### Alternative: a tailnet (Tailscale)

For always-on access without holding an SSH session open, put both machines on a
[Tailscale](https://tailscale.com) tailnet, bind the engine to its tailnet
address, and point the UI at it:

```sh
# on the Mac — bind to the tailnet interface (prints a security warning on startup)
VIBESHELL_HOST=100.x.y.z pnpm dev:engine

# on the Linux laptop — aim the UI at the Mac's tailnet address
VITE_ENGINE_URL=ws://100.x.y.z:4517 pnpm -C desktop dev
```

`VIBESHELL_HOST` binds the engine to a routable interface — it warns on startup
because the port is now reachable by anything that can route to that network, so
keep the tailnet private. `VITE_ENGINE_URL` overrides the URL the UI dials. Even
on a tailnet only devices you've added can reach the port; do not substitute a
raw LAN IP.

## License

Apache-2.0
