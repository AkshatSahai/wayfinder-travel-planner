# Wayfinder — Working Context

> **Read this file at the start of every session before making changes.**
> It carries decisions, gotchas, and open work that are **not** derivable from the
> code or git history. Keep it current: when you make a non-obvious decision,
> hit a trap worth remembering, or close/open a backlog item, update this file in
> the same commit.

Last updated: **2026-08-16** (repo hygiene: LF normalization + prettier gate green;
last feature release v0.4.0, verified end-to-end in production)

---

## 1. Project snapshot

AI-assisted travel planner. Type a trip in plain English (or enter it manually) and get a
workspace with destination curation, lodging, transport, activities, a day-by-day itinerary,
and a live budget.

| | |
|---|---|
| Stack | TanStack Start (React 19, TanStack Router/Query), Vite 8, Tailwind v4, shadcn/ui |
| Data | Supabase (Postgres + auth), RLS on every table |
| AI | Vercel AI SDK → Gemini, **server-side only** |
| Repo | `github.com/AkshatSahai/wayfinder-travel-planner` (branch `main`) |
| Deploy | Vercel → **https://wayfinder-travel-planner.vercel.app** (auto-deploys from `main`) |
| Also synced to | Lovable (see `AGENTS.md` — do not rewrite pushed history) |

**⚠️ Not Next.js.** Specs and outside docs sometimes say "Next.js" — it's TanStack Start.
File-based routing rules live in `src/routes/README.md`. `routeTree.gen.ts` is generated.

**⚠️ Folder nesting — and a ZIP is not a clone.** The GitHub repo root ==
the `wayfinder-travel-planner-main/` folder. If you downloaded a ZIP you may be one level up;
`package.json` marks the real root. A ZIP extract also has **no `.git` directory**, so nothing
edited inside it can ever be committed, pushed, or deployed — `git status` there fails with
`fatal: not a git repository`. Work from a real `git clone`; check for `.git` before starting.

**⚠️ Line endings on Windows.** `.gitattributes` pins the working tree to LF. Before it
existed, a fresh clone on Windows (where Git defaults `core.autocrlf` to `true`) checked out
CRLF, and `npx eslint src/` then reported ~12,400 errors — every one of them ``Delete `␍` ``.
It reads as catastrophic breakage; nothing is actually wrong with the code. If you ever see
this, **don't** run `eslint --fix` — it rewrites all 124 files and buries a config problem in a
huge diff. Fix the checkout instead:
`git config core.autocrlf false && git rm --cached -r . && git reset --hard`.
The tell that the source is fine: exactly 7 `react-refresh` warnings and no other rule firing.

---

## 2. Environment variables

Local `.env` is gitignored. **The client and server read different names for the same values** —
this bites every time:

| Purpose | Client (Vite, build-time) | Server (`process.env`) |
|---|---|---|
| Supabase URL | `VITE_SUPABASE_URL` | `SUPABASE_URL` |
| Supabase key | `VITE_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |

Set **all four** locally or the app renders but every server function 401s and the workspace
throws `notFound()` (a confusing 404 with no obvious cause).

Server-only keys, all optional — each provider degrades to a setup card when absent:
`GOOGLE_API_KEY` (Places + Geocoding), `VITE_GOOGLE_MAPS_KEY` (browser Maps key),
`DUFFEL_API_KEY` (flights), `EIA_API_KEY` (gas prices), `TICKETMASTER_API_KEY` (events).

**`SUPABASE_SERVICE_ROLE_KEY` (server-only) is required as of v0.4.0** — trip sharing's
`redeemInvite` and `listCollaborators` are the first code to actually call `supabaseAdmin`
(`client.server.ts`), previously defined but unused. Without it, joining a trip fails with
`Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY`. This is easy to get
*subtly* wrong rather than obviously wrong: pasting the **anon/publishable key** into this
variable by mistake doesn't error — `supabaseAdmin` still builds a working client, just one
with no more privilege than a normal user, so it silently stays subject to RLS. The tell is
`supabaseAdmin.auth.admin.*` calls failing with `"User not allowed"`, or an RLS-scoped query
via `supabaseAdmin` returning fewer rows than actually exist. The real `service_role` key is
in Supabase dashboard → Project Settings → API Keys, and looks nothing like the publishable
key — if it looks similar, it's the wrong one.

Supabase project: `cxonflruhbypxfonjtes` → `https://cxonflruhbypxfonjtes.supabase.co`.
Get keys from the Supabase dashboard (Project Settings → API Keys) or Lovable Cloud.
The publishable key is public by design (it ships in the browser bundle); **`service_role`
is not — never put it in a file, a chat, or this repo.**

> Tip: `VITE_SUPABASE_URL` and the publishable key can always be recovered from the deployed
> production JS bundle if you lose them. The server-only keys cannot.

### Repo access (GitHub CLI)

Two things bite when setting this up on a new machine — both look like something else:

- **A successful `gh auth login` does not necessarily configure git.** Passing explicit flags
  (e.g. `--git-protocol https`) suppresses the interactive "Authenticate Git with your GitHub
  credentials?" prompt, so `gh auth status` reports a healthy login while `git push` still has
  no credential helper and fails to authenticate. Fix: `gh auth setup-git`. Verify with
  `git config --global --get-regexp credential` — it should list a `gh auth git-credential`
  helper for `https://github.com`.
- **The default token scopes omit `workflow`.** A device-flow login grants `repo`, `read:org`,
  and `gist`. That covers everything in this repo today, but any push whose diff touches
  `.github/workflows/` will be rejected by GitHub with a scope error that reads like a
  permissions problem on the repo. Fix when needed: `gh auth refresh -s workflow`.

---

## 3. Conventions and decisions you can't infer from the code

### Lodging: "candidate" vs "booked" — the most important one

Stays live in `trip_items` with `kind: "lodging"`, distinguished by `category`:

- `"candidate"` — on the Lodging comparison table/map only. **Not** in the itinerary, **not**
  counted in the budget.
- `"booked"` — the confirmed stay. Appears in the itinerary and counts as spend.

`committedItems()` in `src/lib/workspace-store.ts` is the **single chokepoint** that filters
candidates out. Anything that totals money or lists itinerary rows must go through it —
if you add a new surface that sums `cost_cents`, use it or you'll silently count stays the
user is only comparing.

Booking is **exclusive**: booking a stay demotes any previously booked one back to candidate
(implemented in `bookMut` in `trips.$tripId.tsx`). The spec never said; the modal says so in the UI.

**Why `category` and not a new column:** DDL can't be run with only a publishable key, and
Supabase migrations here are applied by the Lovable/Supabase pipeline. Reusing the existing
`category` TEXT column avoided an unverifiable migration. Activity rows use `category` for
their own taxonomy (Food, Nature, …) — that's fine, because `isLodgingCandidate()` checks
`kind === "lodging"` too.

### Activities: "staged" vs scheduled — a null `day_index`

The activity-side counterpart of lodging's candidate/booked split (above), added in v0.5.0.

- **Staged** — `kind: "activity"` with **`day_index IS NULL`**. Lives in the Activities tab's list
  only. Not on the itinerary, not counted in the budget.
- **Scheduled** — any non-null `day_index`. On the itinerary, counts as spend.

**Why a null `day_index` and not a `category` value:** activity rows already use `category` for
their own taxonomy (Food, Nature, …), so the lodging trick genuinely can't be reused here.
`trip_items.day_index` was already nullable, so "no day" already meant "not on the itinerary" —
this needed **no migration**.

`committedItems()` in `src/lib/workspace-store.ts` filters staged activities alongside lodging
candidates, so it remains the single chokepoint for anything that totals money or lists itinerary
rows. `stagedActivities()` is its inverse for the Activities tab.

⚠️ **Do not reintroduce a `day_index ?? 0` fallback.** `ItineraryPanel` used to coerce a null day
to Day 0, which is precisely what dumped every freshly-added activity onto Day 1. Rows without a
day are now dropped from the itinerary, not defaulted.

**Budget decision:** staged activities are excluded from the budget total, mirroring lodging
candidates — added-but-unscheduled is not yet spend. This was a judgement call, not a spec
requirement; the spec only required that the *itinerary* not change. Flipping it is one line in
`committedItems()`.

**Derived state that must count both:** the Trip Details "Add activities" task counts activities
regardless of scheduling state. Routing it through `committedItems()` made staging ten activities
still show the task as outstanding.

### The Activities tab is the master list (v0.5.0 A3)

It shows **every** activity — unscheduled rows read "Any day", scheduled ones carry a "Day N"
badge. It deliberately no longer empties after "Build out itinerary".

**Why:** the itinerary chat can add an activity straight onto a day. Under A1's staged-only tab
that activity would exist on the itinerary and be invisible on Activities, which is exactly the
desync A3 was meant to prevent. `stagedActivities()` still exists and still drives what
"Build out itinerary" acts on — the button's disabled state keys off the *unscheduled* count,
not the list length.

### Itinerary chat rewrites positions, and that is not optional

`chatItinerary` returns **operations** (`move` / `remove` / `add` / `swap_days` / `retime`), never
prose the client has to interpret. Guardrails match `buildItinerary`: operations naming an unknown
id are dropped, `day_index` is clamped, and ops per turn are capped (20) so one message can't
rewrite the trip.

Three things that are easy to get wrong here, all found by testing:

- **`swap_days` must move every kind**, not just activities. Lodging and transport sit on days
  too; swapping only activities strands the booked stay on the wrong day.
- **Newly added rows must be fed into the day renumbering explicitly.** They're created *after*
  the items snapshot is taken, so they aren't in it — a chat-added activity otherwise keeps its
  placeholder `sort_order` and collides with whatever already sits at that position.
- **Every mutating path funnels through `renumberDay()`** (`workspace-store.ts`), shared with
  `buildItinerary`. Both AI paths hand back positions computed without knowledge of the rows
  already on that day.

Chat edits are applied immediately but snapshot what they touch first, so the confirmation toast
can offer Undo — fuzzy title matching ("the candy shop") can resolve to the wrong row and a
removal is otherwise unrecoverable. The snapshot captures prior day/order/time for every touched
row, ids of anything created, and full copies of anything deleted.

⚠️ **Testing note:** the database reflects a chat edit *before* the mutation resolves, so a test
that polls the DB and then clicks "Undo" will race the toast. Wait for the button, not the data.

### Itinerary building: the planner only sees staged activities

`buildItinerary` (`trip-ai.functions.ts`) is sent only the **staged** activities, never the rows
already on the itinerary. Two consequences that both bit during v0.5.0 A2:

1. **The model numbers `sort_order` from 0 every time.** On a trip that already has items on a
   day — including the booked lodging row — its assignments collide with them. Fixed by
   renumbering *every* row on each affected day client-side after assignment
   (`buildMut` in `trips.$tripId.tsx`), ordered by start time with untimed rows keeping their
   prior relative order. **Don't apply the model's `sort_order` directly.** The symptom is two
   rows sharing a `(day_index, sort_order)`, which makes intra-day order arbitrary and destabilises
   the next drag.
2. **The model is not trusted with completeness or range.** `day_index` is clamped to the trip's
   day count, duplicate ids are dropped, and any activity the model omitted is appended rather
   than silently lost.

Enrichment (Places lookup for activities with no location/coords) runs *before* scheduling so
grouping has real coordinates, and the result is written back onto the activity's `details` —
`location` and `coords` are only filled when absent, never overwriting what the traveler typed.
A missing `GOOGLE_API_KEY` or a Places outage degrades to scheduling without coordinates rather
than failing the build.

The model returns a wall-clock `"HH:MM"`; `start_time` is a timestamp column, so it is only
meaningful once combined with that day's real date — see `timestampFor` in `buildMut`.

### The activity feed is append-only, and attribution is enforced by RLS

`trip_activity` (migration `20260817000000`) backs the B3 change feed. Two deliberate properties:

- **Append-only.** `authenticated` is granted only `SELECT, INSERT`, and there are no UPDATE or
  DELETE policies. Rows disappear only through the trip's `ON DELETE CASCADE`. Don't add an UPDATE
  policy to "fix" an entry — a feed you can rewrite isn't a record of anything.
- **`actor_id` is pinned to `auth.uid()` in the INSERT policy.** Without that clause any trip member
  could write entries attributed to a different collaborator, which would make the whole "who did
  what" premise unverifiable. Verified: a forged `actor_id` is rejected with `42501`.

Membership uses the existing `is_trip_member()` rather than a hand-rolled UNION over
`trips`/`trip_collaborators`. A raw subquery against `trips` inside this policy would be evaluated
under trips' own SELECT policy — the shape that produced both RLS bugs in §8.

**GRANT is not optional and its absence is silent.** RLS decides which rows a role may touch; GRANT
decides whether it may touch the table at all. Policies that look correct still fail every request
with `permission denied for table` when the GRANT is missing.

⚠️ **`supabase/config.toml` pins a dead project ref** (`mocvqmruxvpwgnxiszmc`) while the app uses
`cxonflruhbypxfonjtes`. The config's ref doesn't resolve in DNS at all — almost certainly left from
the original Lovable scaffold. Nothing writes to the wrong database because the name simply fails to
resolve, but `supabase db push` will look broken for reasons unrelated to your schema. Migrations
here are applied by hand in the SQL editor regardless.

⚠️ **Re-running an old migration file is what "relation already exists" means.** The SQL editor runs
a multi-statement script as one implicit transaction, so a failed batch rolls back entirely and
leaves nothing half-applied — but check *which file* you pasted before debugging the SQL.

### Trip creation modes

`parsed_params.entry_mode === "manual"` marks a manually-created trip. It drives:
- Activities opening on a blank slate (`autoBrowse={!isManualTrip}`).

**Setting `trip.destination` at creation is what skips AI curation.** `DestinationPickerDialog`'s
query is gated on the dialog being open, and the dashboard only opens it on demand. Manual trips
therefore never touch Gemini during creation. Leave `destination` null (a region, not a city)
and the user is expected to pick one via the dialog.

### Coordinates live in `parsed_params`, not columns

`origin_coords` / `destination_coords` (`{lat, lng}`) are stored in the `parsed_params` JSONB.
Every downstream consumer (Google DirectionsService, OSRM, Duffel) takes **place-name strings**,
so the string stays the contract and coords are pure enrichment — no migration needed.
Lodging rows carry their own `details.coords` plus `details.location` text.

Distance in the lodging table is **haversine straight-line**, not road distance. Expect it to be
noticeably shorter than the Transport tab's driving miles (e.g. 223 mi vs 317 mi Chicago→Traverse City).
That's not a bug.

### The workspace is client-only

`src/routes/_authenticated/route.tsx` sets `ssr: false`. **The entire trip workspace never
server-renders.** Consequences:
- You cannot test any workspace UI with `curl` — you'll only ever get the app shell.
- Verifying workspace changes requires a real browser (see §5).
- The landing page (`/`) *does* SSR, so `curl` is fine there.

### Server function style

All server fns use `createServerFn().inputValidator(...)`, which logs a deprecation warning
(`use .validator()` instead) on every dev boot. **Every** existing server fn does this — the
warnings are pre-existing noise, not something you introduced. Keep new fns consistent with the
existing style, or migrate all of them at once.

Providers are imported with dynamic `import()` inside handlers so a missing key fails at call
time as a catchable error (surfaced via `ProviderSetupCard`) rather than at module load.

### Trip sharing (v0.4.0) — membership-based RLS, not app-level checks

Collaboration is enforced entirely by Postgres RLS, same as everything else in this codebase —
`trips.functions.ts` never adds `.eq("user_id", ...)` filters, so extending access to
collaborators is a pure RLS change (`supabase/migrations/20260805000000_trip_collaborators.sql`),
not a code change to the existing trip/item server fns.

- **`is_trip_member(trip_id, user_id)`** is `SECURITY DEFINER`. Without that, the `trips` SELECT
  policy subqueries `trip_collaborators`, whose own SELECT policy subqueries `trips` again —
  real risk of RLS recursion. `SECURITY DEFINER` runs the check once, outside RLS. It's used by
  `trip_items`/`trip_collaborators`/`trip_invites` policies, but **not** by `trips` itself — see
  the RETURNING gotcha below for why.
- **`trip_items.user_id` is creator provenance only**, not an access-control key, post-rewrite —
  a collaborator's added items are stamped with their own id, not the trip owner's. Don't
  assume `trip_items.user_id === trips.user_id`.
- **`supabaseAdmin` (`client.server.ts`) now has two real call sites**, both in
  `trip-collaborators.functions.ts`: `redeemInvite` (the invitee has zero row access to
  `trip_invites` before joining, so token lookup must bypass RLS) and `listCollaborators`
  (collaborator emails live in `auth.users`, unreachable via the user-scoped client). It was
  previously defined but unused anywhere.
- **`src/integrations/supabase/types.ts` has hand-added entries** for `trip_collaborators` and
  `trip_invites` (marked inline) ahead of a real `supabase gen types typescript` regeneration —
  the file's header says "do not edit directly," and this is a deliberate, temporary exception.
  Replace with the generated version when convenient.
- **The `_authenticated` route's post-login redirect now preserves the query string**
  (`window.location.pathname + window.location.search`, and `auth.tsx`'s `navigateToTarget`
  splits it back out for `navigate()`) — needed so `/join/:id?token=...` survives being
  bounced through `/auth` for sign-in. Before this fix it silently dropped the token.
- **The join route lives at `/join/:tripId`, not `/trips/:tripId/join`.** TanStack Router's
  flat file convention makes a file whose dot-path *extends* another route's path a **child**
  of it, rendered only through that parent's `<Outlet/>`. `trips.$tripId.tsx` (the workspace
  page) renders no `<Outlet/>`, so a `trips.$tripId.join.tsx` file would silently never mount —
  the URL matches the *parent* workspace route instead, which runs its own `getTrip` and 404s
  for a non-member. `/join/:tripId` (file `join.$tripId.tsx`) has no shared path prefix with
  the workspace route, so it's a sibling instead and mounts correctly. If you ever need a route
  nested under an existing dynamic route, either add `<Outlet/>` to the parent or give the child
  a non-nested path like this one.
- **RLS bug #1 — self-referencing SELECT policy breaks `INSERT ... RETURNING`.** The first
  version of `trips_select`/`trips_update` called `is_trip_member(id, auth.uid())`, which
  re-queries `trips` internally. Within a single `INSERT ... RETURNING` statement (exactly what
  `createTrip`'s `.insert().select().single()` compiles to), a row isn't visible to a *separate*
  sub-query against the same table until the statement completes — so the implicit
  SELECT-policy check on the just-inserted row always failed, throwing the generic
  `"new row violates row-level security policy for table trips"`, even though a later, separate
  `SELECT` worked fine. **Fix:** policies on `trips` check ownership inline
  (`auth.uid() = user_id`), only subquerying `trip_collaborators` (a different table, never the
  one being written to) for the collaborator branch. `is_trip_member()` itself stays fine for
  `trip_items` policies, since it never re-queries `trip_items`.
- **RLS bug #2 — unqualified column name resolved to the wrong table.** The inline collaborator
  check first read `EXISTS (SELECT 1 FROM trip_collaborators c WHERE c.trip_id = id AND ...)`.
  `trip_collaborators` has its own `id` primary key, so the bare `id` resolved to
  `trip_collaborators.id` (innermost scope wins), not the intended outer `trips.id` — silently
  comparing a collaborator row's own id to its `trip_id`, never true. This made the entire
  collaborator branch dead code: a collaborator could redeem an invite (the `trip_collaborators`
  row was created fine) but then couldn't see the trip at all, while the owner's own access
  masked the bug in casual testing. **Fix:** qualify explicitly as `trips.id`. General lesson:
  when writing an RLS policy's subquery against a *different* table, always qualify the outer
  table's columns explicitly, even when it looks unambiguous — it usually isn't once the other
  table has a same-named column.
- **Migration applied manually, and iteratively.** Per the "no DDL with only a publishable key"
  constraint above, this migration was written by an agent and applied by the user directly via
  the Supabase SQL editor. It took **four** rounds to get right in production (function/table
  creation order, the two RLS bugs above, plus a `SUPABASE_SERVICE_ROLE_KEY` misconfiguration on
  Vercel) — confirmed only by real end-to-end browser testing with two live Supabase users, not
  by the SQL editor reporting "success" (which just means the SQL was syntactically valid and
  ran, not that the policies do what you think). Confirm any future collaboration-schema change
  the same way: two real users, a real invite link, a real second browser session.

---

## 4. What shipped recently

### v0.4.0 (sharing, Book button, activities manual+fetch) — verified end-to-end in production
1. **Trip sharing, Phase 1.** Invite links, `trip_collaborators`/`trip_invites` tables,
   membership-based RLS. Refresh-to-see-changes only — no realtime, no presence (both deferred,
   see §7). Requires `SUPABASE_SERVICE_ROLE_KEY` set correctly on Vercel — see §2. Shipped with
   three real bugs caught only by full two-user browser verification, not by the migration
   "succeeding" in the SQL editor — see §3 for all three (RETURNING self-query, column
   shadowing, join-route nesting).
2. **Lodging → Book button.** The comparison table's Source column is now a Book action, sharing
   the existing `onBook`/`bookMut` mutation with the detail dialog's "Book this stay" button.
3. **Activities → manual add + paste-a-link.** A manual-add form (reusing `PlaceAutocomplete`)
   sits above the browse gate; a new URL-metadata fetch (`url-metadata.server.ts`, hand-rolled
   OG-tag regex, no scraping dependency) prefills empty form fields from a pasted link, always
   reviewed before adding.

### v0.2.0 (manual entry) — commit `893fc67`
Landing page gained a **"Plan with AI" | "Plan it myself"** toggle. Manual mode collects
origin/destination via `PlaceAutocomplete` + native date inputs, geocodes both server-side
(`resolvePlaces`), and creates the trip with no AI call anywhere in the path.

`PlaceAutocomplete` degrades to a plain text input in **three** independent ways: no
`VITE_GOOGLE_MAPS_KEY`, Google firing `gm_authFailure`, or any error caught by its boundary.
A broken Maps key must never block trip entry.

### v0.3.0 (this release) — commit `efd1fca`
1. **Lodging → comparison tool.** Sortable table + map + detail dialog; only "Book this stay" commits.
2. **Budget → chip in the meta bar**, breakdown in a popover. The right rail is gone.
3. **Activities → blank slate** on manual trips.
4. **Itinerary → dnd-kit drag and drop** across and within days, persisted via `updateTripItem`.
5. **Destination tab → Trip Details dashboard** (countdown, travel-time estimator, booking status,
   derived task list). AI curation moved into `DestinationPickerDialog`.

Also removed: `budget-rail.tsx`, `destination-panel.tsx`, and the `getRecommendations` server fn
(AI tips were retired by decision, not accident).

**Retired route param:** `?tab=destination` no longer exists (it's `?tab=details`). `validateSearch`
uses `.catch(undefined)` so old links fall through to the dashboard instead of 404ing.

---

## 5. Testing playbook

**Static gates** (fast, run before every commit):
```bash
npx tsc --noEmit          # must be silent
npx eslint src/           # 0 errors; 7 react-refresh warnings in components/ui are pre-existing
npm run build             # compiles every module incl. SSR — catches more than tsc alone
```

The eslint count is the load-bearing one: **exactly 7 warnings and 0 errors** is the healthy
baseline. Thousands of errors that are all ``Delete `␍` `` mean your checkout is CRLF, not that
the code regressed — see the line-endings note in §1 and fix the checkout, never the files.

**Workspace UI** requires a real browser (see §3 — `ssr: false`). The approach that worked:

1. Create a Supabase user via the auth REST API (`mailer_autoconfirm` is on, so signup returns
   a session immediately — no email round-trip).
2. Launch headless Edge with `puppeteer-core` pointed at
   `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` (no Chromium download needed).
3. Seed `localStorage["sb-cxonflruhbypxfonjtes-auth-token"]` with the session JSON to get past
   the client-side auth guard.
4. Wait on `[data-testid="trip-meta-bar"]` rather than a fixed timeout — the trip query is
   client-side and slow to resolve.

Stable `data-testid` hooks already in place: `trip-meta-bar`, `budget-chip`, `trip-countdown`,
`travel-estimate`, `booking-status`, `pending-tasks`, `lodging-table`, `lodging-manual`,
`activities-blank-slate`, `itinerary-day-{n}`, `destination-chat`, `candidate-grid`, `top-pick`,
`waypoint-chips`, `destination-map`.

**Server functions can't be called with hand-written JSON.** TanStack Start RPC bodies are
seroval-encoded; plain `curl -d '{"data":{...}}'` fails in `parsePayload` with a confusing
`Seroval Error (step: 3)`. Test the underlying provider directly, or go through the browser.

⚠️ **Write state-independent assertions.** A drag test that hardcoded "day 0 → day 1" passed once
and then failed forever because the previous run had already moved the item. Read current state,
act on a *different* target, assert it changed.

**Don't hard-reload a page whose session you manually seeded into `localStorage`.** Supabase
rotates refresh tokens by default — a hand-built session survives *one* recovery cycle (the
reload inside the seeding step itself) but a *second* `page.reload()` on that same page can
silently sign the user out (no redirect, just missing UI state) if the rotated token isn't
persisted the way a real browser session would be. Fix: never reload a seeded page more than
once. For "does user B now see what user A did," open a **fresh page with a fresh sign-in**
instead of reloading — costs one extra REST call, avoids the whole class of flakiness. This bit
the v0.4.0 collaboration tests specifically (an owner page reloaded to check the Share dialog
after a collaborator joined).

**RLS bugs are invisible to "the SQL ran without error."** A migration applying cleanly proves
the SQL is syntactically valid, not that the policy logic is correct — both RLS bugs in §3
(RETURNING self-query, column shadowing) passed a clean `CREATE POLICY` and only surfaced as
wrong *behavior* under real multi-user traffic. When debugging "policy exists but access is
denied/wrong," a disposable `SECURITY INVOKER` SQL function that echoes back
`auth.uid()`/`auth.role()` (or, cautiously, counts/lists what the caller can actually see) is
far more useful than staring at the policy text — drop it once you're done.

---

## 6. Known gaps — verified vs not

**Verified against live Supabase + real browser (25/25 checks, v0.3.0):** booking exclusivity,
budget excluding candidates, blank-slate activities, drag persistence across reload, dashboard
cards deriving from real trip state, travel estimate matching hand-checked OSRM output.

**Verified against live Supabase + real browser, two real users, production (v0.4.0):**
invite-link generation and redemption, collaborator appearing in the Share dialog, a
collaborator's added item becoming visible to the owner (confirms RLS write access, not just
UI), Lodging Book button, Activities manual-add, Activities URL-fetch prefill (tested against a
real Wikipedia page, correctly pulled the `og:title`-derived page title).

**Never exercised — needs keys that aren't in local `.env`:**
- **Flight** travel estimates (Duffel). Car and train are confirmed working.
- Google Places **autocomplete suggestions** and the Places geocode path. Only the keyless
  Nominatim fallback has actually run.
- Live maps — locally they render "Map isn't connected yet".
- Ticketmaster events and EIA gas prices.

Production has these keys, so the quickest check is the live site.

---

## 7. Backlog

**Known broken upstream**
- **TravelPayouts hotel API is discontinued** (every endpoint 404s, confirmed with a valid token).
  The panel correctly reports unavailable. A replacement live hotel source is the top item.

**Requested but not built**
- **Realtime sync for shared trips (Phase 2)** — subscribe to Supabase `postgres_changes` on
  `trips`/`trip_items` filtered by `trip_id`, call the existing `invalidate()` chokepoint in
  `trips.$tripId.tsx` from the event handler.

  ✅ **The database side is done** (migration `20260817000000_realtime_and_activity_feed.sql`,
  applied 2026-08-17). It *did* need a schema change, contrary to the earlier note here that said
  otherwise: `trips`/`trip_items` were not in the `supabase_realtime` publication, so a channel
  reported `SUBSCRIBED` and then delivered **zero** events forever. Now verified live — INSERT,
  UPDATE and DELETE all arrive, plus INSERT on `trip_activity`. `REPLICA IDENTITY FULL` is what
  makes the DELETE payload carry the row title for "X removed Y".

  ⚠️ **`SUBSCRIBED` is not evidence.** Supabase reports it happily for a table that isn't in the
  publication. Always confirm with an actual write; see `scratchpad/partb-verify.mjs` for the shape.

  Still to build in the app: `supabase.realtime.setAuth(token)` before subscribing, or RLS-protected
  `postgres_changes` deliver nothing.
- **Presence indicator (Phase 3)** — "who's viewing this trip," ordered after Phase 2 since it
  needs the same realtime channel plumbing.
- **Owner vs. shared badge** in `trips.index.tsx` — `listTrips` now also returns trips the user
  collaborates on (as of v0.4.0's RLS rewrite), but the list doesn't select `user_id` so there's
  no visual distinction yet.
- Smart paste for Airbnb/VRBO/Amtrak links → auto-fill the Lodging/Transport forms. Activities
  got its own paste-a-link fetch in v0.4.0; the shared abstraction wasn't built preemptively —
  extending it to Lodging/Transport is the natural next step now that it's tested once.
- No live rail API. Train estimates are a labelled heuristic: road miles ÷ 50 mph + 1h.

**Worth considering**
- `updateTripItem` is called once per row on a drag reorder (N requests). Fine at current sizes;
  a batch endpoint would be better if itineraries get long.
- Migrate all server fns off the deprecated `.inputValidator()` in one pass.
- The Lodging map and Trip Details map both mount their own `APIProvider`. Harmless, but a shared
  provider higher in the tree would be cleaner.

**Housekeeping**
- **`npm audit` reports 4 transitive advisories** (2026-08-16): `brace-expansion`, `js-yaml`,
  `nanoid` (high) and `postcss` (moderate). All are DoS or build-tooling issues, none is a direct
  dependency, and every one reports `fixAvailable: true` — so plain `npm audit fix` should clear
  them without a forced major bump. Left alone deliberately rather than folded into an unrelated
  change. Re-run all three static gates afterwards: these sit under Vite/ESLint, so a bad bump
  surfaces as a build failure, not a test failure.
- v0.5.0 verification test users still exist in Supabase auth (trips and items all deleted; only
  the auth rows remain): `claude-a1-verify-a1run1@`, `claude-a2-verify-a2run1@`,
  `claude-a2-verify-a2run2@`, `claude-a2-verify-a2run3@`, `claude-a3-verify-a3run1@`,
  `claude-a3-verify-a3run2@` — all `@example.com`.
- Test users `claude-manual-entry-verify@example.com`, `claude-share-owner-verify@example.com`,
  and `claude-share-collab-verify@example.com` still exist in Supabase auth. Deleting a user
  needs the `service_role` key (now set on Vercel as of v0.4.0, so this could be scripted going
  forward) — remove them from the dashboard (Authentication → Users), or ask for it to be done
  via `supabaseAdmin.auth.admin.deleteUser()`. All of their trip data has been cleaned up.

---

## 8. Incident log: getting v0.4.0 trip sharing live (2026-08-06)

Trip sharing looked done after static gates passed and the code was pushed — it wasn't. Getting
it actually working in production took seven distinct failures across the DB migration, RLS
policies, routing, and env config, found only by real two-user browser testing. Logged in order
hit, so a future session (human or agent) recognizes the symptom fast instead of re-diagnosing
from scratch. Full technical detail for the RLS/routing bugs is in §3; this is the chronological
"what broke, in what order, how we knew" version.

1. **Migration fails: `relation "public.trip_collaborators" does not exist`.**
   Symptom: SQL editor errors on `CREATE FUNCTION is_trip_member` referencing a table that
   doesn't exist yet. Cause: the function was defined before the tables it queries.
   `LANGUAGE sql` functions are validated against the catalog at creation time (unlike
   `plpgsql`, which only syntax-checks), so this fails immediately — nothing else in the script
   had run yet. Fix: reorder the migration — both tables first, then the function, then every
   policy that depends on it.

2. **Same error again on retry.** Not a re-occurrence — the user re-ran the *old* copy of the
   file (from GitHub, which didn't have the fix pushed yet). Lesson: when handing over corrected
   SQL mid-session, paste the full corrected block directly in chat rather than saying "re-run
   the file," since the fix may not be pushed/synced anywhere the user would think to re-fetch
   it from.

3. **`createTrip` fails: `new row violates row-level security policy for table "trips"`,
   reproduced with a direct REST `INSERT`, even though the JWT's `sub` exactly matched the
   `user_id` being inserted.** This turned out to be RLS bug #1 in §3 — `trips_select` called
   `is_trip_member()`, which re-queries `trips`, and that self-query can't see a row still being
   inserted in the same `INSERT ... RETURNING` statement. Diagnosed by testing the *same* insert
   twice: once with `Prefer: return=representation` (fails) and once without (succeeds,
   `201`) — proved the row itself was fine and only the RETURNING-triggered SELECT check failed.
   Fix: check ownership inline on `trips`' own policies instead of via the helper (§3 bug #1).

4. **After the RLS-policy fix was applied, the join flow got past invite lookup but
   `getTrip` still failed for the collaborator** (`"Cannot coerce the result to a single JSON
   object"` — Postgres's `.single()` error for zero rows). A direct REST `SELECT` as the
   collaborator confirmed `trips` returned `[]` even though the matching `trip_collaborators`
   row demonstrably existed (checked by ID). This was RLS bug #2 in §3 — the collaborator
   `EXISTS` subquery's unqualified `id` resolved to `trip_collaborators.id`, not `trips.id`.
   Diagnosed by directly querying `pg_policies` to confirm the policy text matched what was
   intended, which it did — meaning the bug was in the *logic*, not a deployment mismatch,
   which narrowed it to the shadowing issue. Fix: qualify as `trips.id` explicitly.

5. **The join page never rendered — URL matched, but the screen showed "Loading trip…" (the
   workspace page's loading state) instead of "Joining trip…" (the join page's).** This was the
   TanStack Router nesting bug in §3: `trips.$tripId.join.tsx` was a *child* route of
   `trips.$tripId.tsx` by file-naming convention, and the parent renders no `<Outlet/>`, so the
   child silently never mounted while the parent's own (failing, for a non-member) `getTrip`
   query ran instead. Diagnosed by inspecting `routeTree.gen.ts`'s generated `getParentRoute`
   for the join route. Fix: moved the route to `/join/:tripId` (file `join.$tripId.tsx`), which
   shares no path prefix with the workspace route and is therefore a sibling, not a child.

6. **`redeemInvite` fails: `Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY`.**
   Straightforward — this feature is the first code to ever call `supabaseAdmin`, and the
   project's Vercel env vars had never needed it before. Fix: add the var in Vercel, redeploy.

7. **Same call fails differently after adding the var: `TypeError: Headers.set: "DROP POLICY
   ...`.** The *value* pasted into `SUPABASE_SERVICE_ROLE_KEY` was the SQL fix text from earlier
   in the conversation, not the actual key — an easy mix-up when multiple secrets/snippets are
   in flight in the same session. Fix: re-copy the actual `service_role` value from the Supabase
   dashboard.

8. **Same call fails a third way: `"This invite link is no longer valid"`, even though a
   direct REST query (as the owner) confirmed the invite row existed, unrevoked, exact token
   match.** The service-role key was now a syntactically plausible secret but still the wrong
   *value* — turned out to be the anon/publishable key pasted again. This one doesn't error
   loudly: a low-privilege key still builds a working Supabase client, just one still subject to
   RLS, so admin-scoped queries just quietly return fewer/zero rows instead of failing outright.
   Diagnosed with a **temporary, safe diagnostic**: a debug branch in `redeemInvite` that called
   `supabaseAdmin.auth.admin.listUsers()` (fails with `"User not allowed"` for a non-privileged
   key — a reliable tell) and a `count`-only query against `trip_invites` (returned `0` despite
   a real row existing — proof RLS was still being applied, which a genuine service-role key
   would bypass entirely). Never logged the key itself, only pass/fail behavior. Removed once
   confirmed. Fix: paste the real `service_role` key (Project Settings → API Keys — it looks
   nothing like the publishable key).

9. **Test harness (not the app) flake: after a collaborator joined, reloading the *same*
   Puppeteer page as the owner made the Share button vanish entirely** (`clickByText` returned
   `false`; the button wasn't in the DOM). Root cause was in the test rig, not the app —
   Supabase's default refresh-token rotation means a hand-seeded `localStorage` session survives
   exactly one recovery cycle; a second hard reload of the same page can silently drop the
   session. Fixed by never reloading a seeded page twice — open a fresh page with a fresh
   sign-in for each verification step instead (see §5).

**End state:** full flow verified — owner creates trip → generates invite link → second real
account redeems it and lands in the trip → owner sees them in the Share dialog → collaborator
adds an item → owner sees it after a refresh. Lodging Book button and Activities URL-fetch
re-verified in the same pass. All fixes are committed on `main` (commits `df5e850` through
`9aab1e5`); the corrected migration SQL in `supabase/migrations/20260805000000_trip_collaborators.sql`
now matches exactly what's live in Supabase.

---

## 9. Working agreements

- **Don't commit or push unless asked.** Verify first — the user has been explicit about
  testing before any commit.
- Pushing to `main` triggers a production deploy **and** syncs to Lovable. Confirm before pushing
  unless already told to.
- Log every user-facing change in `CHANGELOG.md` using the existing format: an Overview, then
  entries with both a `_Technical:_` and a `_For everyone:_` line.
- When a spec's premise doesn't match the code, say so and build to the underlying intent rather
  than silently following or silently ignoring it.
