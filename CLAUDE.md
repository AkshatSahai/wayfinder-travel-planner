# CLAUDE.md

## Start every session by reading `context.md`

**Before answering questions or changing code in this repo, read [`context.md`](./context.md).**

It is the durable memory for this project: architecture decisions that aren't visible in the
code, environment traps, what has and hasn't been verified, and the open backlog. It travels
with the repo, so it applies on any device and in any session.

**Keep it current.** When you make a non-obvious decision, hit a trap worth remembering, or
open/close a backlog item, update `context.md` in the same commit as the change. A stale
context file is worse than none — it will be trusted.

## Before Starting Each Session

1. **`git pull`** — fetch the latest changes from GitHub before touching anything.
2. **Make your changes** to the project.
3. **Run the checks** — `npx tsc --noEmit && npx eslint src/ && npm run build`.
4. **`git add .`**
5. **`git commit -m "..."`** with a message describing the changes.
6. **`git push`** — send the changes back to GitHub.

> **`git pull` is all you need to get current.** It brings this clone up to date with the latest
> version on GitHub in place — there is nothing to redownload, and you should never replace a clone
> with a fresh ZIP. A ZIP extract has no `.git` directory, so nothing edited inside it can be
> committed, pushed, or deployed (see `context.md` §1).

Steps 4–6 are the normal end of a session: commit and push without waiting to be asked.
⚠️ `git push` to `main` deploys to production and syncs to Lovable, so step 3 is not optional —
never push a build that doesn't pass.

## Quick orientation

- **Check `FEATURE_TRACKING.md`** for what's scoped-but-unbuilt, built-but-unverified (needs
  manual testing), and explicitly deferred. Update it whenever that status changes.
- **TanStack Start, not Next.js.** Routing conventions are in `src/routes/README.md`.
- The repo root is the folder containing `package.json`. A ZIP download nests it one level deeper.
- Client and server read **different env var names** for Supabase — see `context.md` §2. Getting
  this wrong produces a 404 on the trip workspace with no obvious cause.
- The trip workspace is `ssr: false`, so it cannot be tested with `curl` — see `context.md` §5.

## Before committing

```bash
npx tsc --noEmit && npx eslint src/ && npm run build
```

Run this before every commit — see **Before Starting Each Session** above. Pushing to `main`
deploys to production and syncs to Lovable.
