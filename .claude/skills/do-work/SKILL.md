---
name: do-work
description: Execute a self-contained unit of work end-to-end — plan, implement, verify with feedback loops, and commit. Use when the user asks to "do work", "pick up this task", build a feature, fix a bug, or wants a piece of work taken from plan through to a committed change.
---

# Do Work

Take a unit of work from intent to a committed change. Follow the four phases in order. Do not skip ahead — each phase gates the next.

## Phase 1 — Plan

Understand the work before touching code.

- [ ] Restate the goal in one or two sentences. Confirm scope with the user if ambiguous.
- [ ] Explore the relevant files; match the project's existing patterns and domain language.
- [ ] Write a short plan: the files to change and the behavior to add/fix.
- [ ] For non-trivial work, present the plan and get approval before implementing.

Keep the unit small and coherent — one logical change that can land in a single commit. If the work is larger, split it and run this skill per slice.

## Phase 2 — Implement

How you implement depends on whether the change is **backend** or **frontend**.

**Backend** — services, server-side logic, anything with `*.test.ts` next to it (e.g. `app/services/*`, `app/lib/*.server.ts`): drive it with **red/green**, one test at a time, tracer-bullet style.

- [ ] Pick the next smallest slice of behavior. Write **one** failing test for it (red). Run it and watch it fail for the right reason.
- [ ] Write the minimal code to make that one test pass (green). Re-run; confirm it's green.
- [ ] Repeat one test → one implementation. Do not batch tests up front — each test responds to what the last cycle taught you. See the [tdd](../tdd/SKILL.md) skill for depth.

**Frontend** — React components, routes, UI/JSX: do **not** force test-first here. Implement the change directly following surrounding patterns; add tests only where they're genuinely useful.

For both:

- [ ] Prefer the smallest edit that satisfies the goal.
- [ ] Follow surrounding conventions (naming, structure, comment density).
- [ ] Do not commit yet.

## Phase 3 — Feedback loops

Run the project's checks and **fix until both pass**. Never commit on a red check.

```bash
pnpm typecheck   # react-router typegen && tsc
pnpm test        # vitest run
```

Loop:

1. Run `pnpm typecheck`. If it fails, fix the types and re-run.
2. Run `pnpm test`. If it fails, fix the code (or the test if it was wrong) and re-run.
3. Repeat until both are clean.

Rules:

- Fix the root cause; do not suppress errors or skip tests to force green.
- If a failure reveals the plan was wrong, return to Phase 1.
- Re-run the check you changed after every fix, not just once at the end.

## Phase 4 — Commit

Only after both checks pass.

- [ ] Review the diff (`git diff`) — confirm it matches the plan and contains nothing stray.
- [ ] Stage the related changes.
- [ ] Write a focused commit message describing the behavior change (not the mechanics).
- [ ] Commit. If on the default branch, create a feature branch first.

Do not push or open a PR unless the user asks.

## Checklist

```
[ ] Plan written and (if needed) approved
[ ] Change implemented, scoped to one unit
    [ ] Backend: built test-by-test via red/green tracer bullets
    [ ] Frontend: implemented directly, no forced test-first
[ ] pnpm typecheck passes
[ ] pnpm test passes
[ ] Diff reviewed
[ ] Committed with a clear message
```
