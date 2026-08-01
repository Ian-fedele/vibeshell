# vibeshell

An open-source, terminal-first agentic coding assistant built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

> **Status: pre-alpha.** Phase 0 — nothing to see here yet. Roadmap in progress.

## Why vibeshell?

- **Open and hackable** — extension points (commands, hooks, subagents, MCP) are the product, not an afterthought.
- **No telemetry.** Ever. Your code and prompts go to the model provider you configure, and nowhere else.
- **Terminal-first** — works with any editor, any workflow.

## Quickstart

```sh
npm i -g vibeshell
export ANTHROPIC_API_KEY=sk-ant-...
cd your-project
vibeshell "explain this repo"
```

Default model: `claude-opus-5` (configurable).

## Development

```sh
pnpm install
pnpm dev "hello"     # run the spike from source
pnpm build           # bundle to dist/
pnpm test            # vitest
pnpm typecheck
```

## License

Apache-2.0
