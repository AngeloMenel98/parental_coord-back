# Working agreement

This repository runs on **ODD (Organic Driven Development)**.

SDD phases (`sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`,
`sdd-apply`, `sdd-verify`, `sdd-archive`) are **not** used here. No `openspec/`
directory, no proposal/spec/design artifacts as a separate stage. Engram entries
under `sdd/<change>/*` from earlier work are historical records only.

## Route

- Explore the code before proposing or writing anything.
- **Small change** (understood, contained risk, resumable from the request plus
  `git diff`): work inline. No plan file, no phase artifacts.
- **Large change** (needs several sessions, waits on something external, or would
  not survive a context reset): before the first source write, create
  `odd/tasks/<feature>.md` and mirror it to the Engram topic `odd/<feature>/tasks`
  (project `parental_coord-back`).
- A reported failure is reproduced before it is declared fixed.
- Where a deterministic test and a clear expected outcome exist: observe red
  before the fix, green after.

## Feature document shape

Fixed order, growing log last:

1. Header — objective, branch, delivery strategy, test runner.
2. `## Specs` — numbered `S1..Sn`. Quote the user's exact strings, messages and
   examples verbatim; never paraphrase a requirement.
3. `## Tasks` — one line per task: ID, linked `S#`, route (inline/delegated),
   status, commit.
4. `## Log` — `L1` is the original request verbatim; later corrections,
   decisions and evidence are appended.

## Commits

Large work lands in reviewable units (about 400 authored changed lines), with
Conventional Commit messages, tests and docs in the same commit as the behavior.
Never push or open a PR unless asked.

## Close

Every code change ends with `Risk: item N (reason)` or `Risk: none`.

## Repo

NestJS + TypeScript, pnpm.

- `pnpm test` — unit tests (jest)
- `pnpm test:e2e` — e2e
- `pnpm lint`, `pnpm build`
