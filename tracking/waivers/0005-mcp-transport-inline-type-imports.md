# Waiver: 0005 — inline `import("http")` types in the MCP transport

> Two lint rules contradict each other in exactly one file. The safety rule wins; the style rule is
> scoped off for that file alone, in `eslint.config.mjs`.

| Field | Value |
| --- | --- |
| **Rule violated** | ESLint `@typescript-eslint/consistent-type-imports` ("`import()` type annotations are forbidden") |
| **Status** | `active` |
| **Owner** | @stavarengo |
| **Created date** | 2026-08-28 |
| **Expiry date** | 2026-12-31 (review — retire as soon as either rule stops forcing the other's hand) |
| **Scope** | Exactly one file: `src/obsidian/mcpHttpServer.ts`, and exactly one rule, named in the `eslint.config.mjs` override block. Every other file, and every other rule in that file, stays fully gated. |

## Reason

`obsidianmd/no-nodejs-modules` forbids any `import ... from "http"` statement, type-only ones included, because a plugin that reaches for a Node builtin at load time is broken on mobile — Obsidian there has no `http` to give. That rule is not negotiable and its own preset forbids suppressing it inline (`eslint-comments/no-restricted-disable`). The transport therefore names the three types it needs (`IncomingMessage`, `ServerResponse`, `Server`) with inline `import("http")` annotations, which are erased at build time and reach no one's phone. That is precisely the form `consistent-type-imports` forbids.

So the two rules leave no legal spelling. The Obsidian rule is the one that protects users; the style rule steps aside, for one file.

## Risk

Type imports in that single file are written in a form the rest of the codebase does not use, so someone reading it may copy the pattern into a file where the plain `import type` is both legal and preferred. Mitigated by the comment on the override block and by the rule staying on everywhere else.

## Exit plan

Retire when either rule relaxes: `obsidianmd/no-nodejs-modules` learning that a type-only import is erased, or `consistent-type-imports` gaining an escape for it. Check on the next `eslint-plugin-obsidianmd` or `typescript-eslint` upgrade; if the type-only import becomes legal, replace the three aliases with one `import type { IncomingMessage, Server, ServerResponse } from "http"` and delete the override block.

## Replacement

A plain `import type ... from "http"` statement in `src/obsidian/mcpHttpServer.ts`, with no override in `eslint.config.mjs`.
