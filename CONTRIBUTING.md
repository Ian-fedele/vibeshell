# Contributing to vibeshell

Thanks for your interest! vibeshell is in early development (pre-alpha), so the codebase is moving fast.

## Ground rules

- Open an issue before starting significant work so we can align on approach.
- Keep PRs focused — one change per PR.
- All PRs need passing CI (typecheck, lint, tests).

## Development setup

```sh
pnpm install
pnpm dev "hello"
pnpm test
```

Node ≥ 20 and pnpm are required.

## Code style

Prettier enforces formatting (`pnpm lint`). TypeScript strict mode is on; don't weaken it.
