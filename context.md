# Wayfinder — Working Context

> **Read this file at the start of every session before making changes.**
> It carries decisions, gotchas, and open work that are **not** derivable from the
> code or git history. Keep it current: when you make a non-obvious decision,
> hit a trap worth remembering, or close/open a backlog item, update this file in
> the same commit.

Last updated: **2026-08-19** — after **v0.9.0** removed all AI from the Itinerary tab (the A2
scheduler, A3 chat, A4 advisor, and A5 day map) and replaced it with a static activity map plus a
distance list. Several §3 subsections below are now marked **SUPERSEDED**; they are kept on
purpose — read them before proposing to rebuild anything they describe.

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

### Places photos go through our own proxy — never embed the key in a URL

`GOOGLE_API_KEY` must never appear in anything the browser sees. Places photo URLs are built by
`photoProxyUrl()` in `google-places.server.ts` and point at **`/api/places/photo`**, handled in
`src/server.ts`; that handler calls Places with the key server-side and streams the bytes back.

⚠️ **Never reintroduce `https://places.googleapis.com/v1/{name}/media?...&key=${apiKey}`.** That
form was returned to the client as an `<img src>`, publishing the key to every visitor from v0.1
through v0.5.0. Consumers only ever render `photo_url`, so the fix lives entirely in the producer —
if you add a new Places-backed image, use `photoProxyUrl()`.

⚠️ **The `name` parameter is security-critical.** It is interpolated into a URL we sign with our
key, so it is validated against `^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$` and anything else
is rejected with 400. Without that check the route is an **open relay** — anyone could point it at
another Google endpoint and have us authenticate the call for them. Traversal, absolute-URL,
endpoint-swap and query-injection inputs are all covered by the probe suite.

The proxy lives in `server.ts` rather than a route file because this TanStack Start version ships
**no server-route API** (no `createServerFileRoute`/`ServerRoute` export), and a server function
cannot stream raw image bytes.

**IP-restricting `GOOGLE_API_KEY` is not available — don't retry it.** Vercel's docs state
deployments "can come from any IP address" by default; static egress needs Secure Compute or the
Static IPs add-on (Enterprise). An IP restriction would break production on the next deploy. The
proxy removes the exposure, which was the real risk; the remaining controls are the existing API
restriction (Places New + Geocoding only) plus per-API quota caps and a billing alert.

**`VITE_GOOGLE_MAPS_KEY` is referrer-restricted (verified live, 2026-08-17).** Google reports
`REQUEST_DENIED — "API keys with referer restrictions cannot be used with this API"` on server-side
REST calls, and Static Maps returns **403** for a disallowed origin while allowing
`wayfinder-travel-planner.vercel.app` and `localhost:*`.

⚠️ **What that does and does not buy you.** Static Maps still returned **200 with no `Referer`
header at all**. HTTP-referrer restrictions constrain *browsers*, which always send a Referer; they
cannot block a scripted request that simply omits one. So this stops the key being lifted from the
JS bundle and reused on another website — the actual risk for a key that ships to the client — but
it is **not** a hard security boundary. Per-API quota caps and billing alerts remain the real
backstop. Don't read "restricted" as "safe from all abuse".

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

### Itinerary day view: droppable ids and collision detection (v0.5.0 A5)

> **Partly superseded by v0.9.0.** The droppable-id and collision-detection rules below are still
> live and still load-bearing — day tabs and drag-to-schedule survived. The `dayPlan` caching and
> Google-notes paragraphs at the end of this section describe code that no longer exists.

The Itinerary tab shows one day at a time (tabs + list on the left, map on the right). Two
non-obvious things make dragging across days work:

- **Day tabs use `daytab-N`, day columns use `day-N`.** The selected day renders *both*, and two
  droppables registered under one id break dnd-kit's registry — drops onto tabs silently did
  nothing. `resolveTargetDay` handles both prefixes (check `daytab-` first; `"daytab-2"` does not
  start with `"day-"`, so order is safe either way, but be explicit).
- **Collision detection is `pointerWithin` with a `closestCorners` fallback**, not `closestCorners`
  alone. `closestCorners` compares the *dragged row's* rectangle, and an itinerary row is far wider
  than a day tab — its corners overlap the neighbouring tab even with the pointer dead-centre, so
  drops landed one day off, reproducibly. The fallback is still needed for empty day columns, where
  the pointer may be inside no droppable at all.

`dayPlan` (route + notes) is cached on `(tripId, dayIndex, stop signature)` with
`staleTime: Infinity`, so flipping between day tabs replays from cache — verified as 0 extra calls
across 6 re-visits.

⚠️ **Google publishes no "popular times" through any Places API tier** (checked against the
data-fields reference). Opening hours exist but only on the **Enterprise** SKU. So day notes are
split by provenance and labelled: **Live · Google** restates values Google actually returned
(rating, review count, editorial summary — all already in the field mask, no extra cost), and
**Guidance** is model-written. Never label model output as live data, and don't re-attempt popular
times.

⚠️ **`http://localhost:8080` is not on the Maps browser key's referrer allowlist**, so the day map
shows its "Map key was rejected" fallback in local dev (`RefererNotAllowedMapError` in console).
The app handles this correctly; it is a key-config gap, not a code bug. Add
`http://localhost:8080/*` to the key's allowed referrers to see maps locally. Note Static Maps
accepting a spoofed `Referer` header is *not* evidence the JS API will accept an origin — they
match differently.

### The drag advisor never calls the AI speculatively (v0.5.0 A4) — SUPERSEDED (v0.9.0)

> **The drag advisor was removed in v0.9.0.** `assessDay`, `averageDayCost`, and
> `adviseItineraryChange` are all gone. Kept below because the *reasoning* still applies to
> anything similar: if you ever add a feature that calls a model in response to routine user
> activity, the local-gate pattern and the anti-nag rules here are the bar to clear. Note that
> `checkArrivalConflict` — the pin-a-time check — survived, precisely because it never called a
> model at all.

`assessDay()` in `src/lib/itinerary-advice.ts` is a pure local heuristic pass that runs after a
manual drag. **Only if it returns a signal does `adviseItineraryChange` call Gemini at all.** A
drag that trips nothing costs nothing — no network request, verified by counting
requests off the wire, not by "no note appeared".

This gating is the point of the feature, not an optimisation. context.md's v0.2.1 entry records
cascading retries exhausting the AI quota; an advisor that evaluated every drag would repeat it.

Anti-nag rules live in code (`runAdvisor` in `trips.$tripId.tsx`), not in the prompt: one visible
note at a time, no consecutive notes about the same item, a dismissed item never notifies again,
and a per-session call budget (`ADVISOR_CALL_BUDGET`). The model is additionally told to return
`surface: false` for anything a reasonable traveler would shrug at, and it does decline.

⚠️ **The advisor must assess the POST-drag arrangement.** The React Query cache still holds
pre-drag state when `onReorder` fires, so reading `data.items` finds the moved item still on its
old day and every heuristic silently returns nothing — the whole feature looks broken while
appearing to work. Project the `moves` array over the current items instead of waiting for a
refetch.

Advice is fire-and-forget: the drag persists first and is never blocked, delayed, or failed by the
advisor. Notes are ephemeral React state, never persisted, so stale advice about a plan that has
since changed cannot survive a reload.

### The Activities tab is the master list (v0.5.0 A3)

It shows **every** activity — unscheduled rows read "Any day", scheduled ones carry a "Day N"
badge. It deliberately no longer empties after "Build out itinerary".

**Why:** the itinerary chat can add an activity straight onto a day. Under A1's staged-only tab
that activity would exist on the itinerary and be invisible on Activities, which is exactly the
desync A3 was meant to prevent. `stagedActivities()` still exists and still drives what
"Build out itinerary" acts on — the button's disabled state keys off the *unscheduled* count,
not the list length.

### Itinerary chat rewrites positions, and that is not optional — SUPERSEDED (v0.9.0)

> **The itinerary chat was removed entirely in v0.9.0** — `chatItinerary`, its operations schema,
> research mode, and the undo snapshot are all gone. Kept below for two durable lessons that
> outlive it: a model that edits data should return **operations, not prose**, and any batch of
> fuzzy-matched edits needs an undo. `renumberDay()` still exists and is still the chokepoint for
> anything that places rows on a day.

`chatItinerary` returns **operations** (`move` / `remove` / `add` / `swap_days`), never prose the
client has to interpret. Guardrails match `buildItinerary`: operations naming an unknown id are
dropped, `day_index` is clamped, and ops per turn are capped (20) so one message can't rewrite the
trip. There is no `retime` op — see the v0.6.0 entry in §3 below and §4: neither the AI planner nor
chat assigns clock times any more, only position.

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

### Timing is manual now, not AI-assigned (v0.6.0)

Root cause of the "chat says 9 AM but the display order doesn't match" bug: `timestampFor()`
wrote a wall-clock string with **no timezone offset** into `start_time` (a `TIMESTAMPTZ` column).
Postgres stored that as a UTC instant; `minutesFromTimestamp()` then read it back with the
browser's **local** `getHours()`. Anyone not in UTC got a mismatch between what was written and
what was sorted/displayed. `category` was investigated first (the original report suspected it)
and ruled out — it only affects one advisor heuristic (nightlife before 4pm in
`itinerary-advice.ts`), never ordering.

Fix and the resulting design, both in `workspace-store.ts`:
- `timestampFor`/`minutesFromTimestamp` now both operate in UTC, so "9 AM" round-trips correctly
  regardless of the browser's timezone. The column still isn't a real instant — it's a label for
  "this wall-clock time on this day of the trip" — UTC is just the fixed convention used to store
  and read it consistently.
- **The AI planner and chat no longer assign clock times at all** — `buildItinerary`'s
  `scheduleSchema` and `chatItinerary`'s op schema both dropped `start_time`/`retime`. Sequencing
  is 100% by position (`sort_order`) now. This sidesteps the timezone class of bug entirely for
  the AI paths rather than just patching the read/write mismatch.
- The one remaining `start_time` write path is a traveler manually pinning a single item's arrival
  time (a popover on the item's time chip, `itinerary-panel.tsx`). Pinning **never re-derives
  order** — `renumberDay()` calls from `buildMut`/`applyOps` in `trips.$tripId.tsx` always pass
  `minutes: null` now, so a pinned time is metadata + a conflict check, not something that moves
  the item. This matches the spec's intent: drag order is the one source of truth for sequence.
- Pinning runs `checkArrivalConflict` (`itinerary-advice.ts`) — a new pure, local heuristic in the
  same family as `assessDay`/A4: sums duration + straight-line travel time (30mph assumed, same
  order of magnitude as the "long hop" check) for everything ahead of the pinned item in display
  order, and flags if the pinned time is earlier than that allows. No AI call.
- Each day also got an optional `day_start_times` column on `trips` (JSONB, keyed by day index),
  set from the day column header. It's read into `dayPlan`'s guidance prompt as context and used
  as the arrival-check's fallback "day start" when the first item has no pinned time of its own —
  it is never written onto a `trip_items` row.
- The drag advisor banner (A4) was kept, not removed — restyled as a smaller dismissible pill
  instead of a bordered callout, per an explicit user call weighing "remove it" against "it was
  built on purpose to catch exactly this."
- The itinerary chat moved from an always-visible block above the day tabs into a `Sheet`-based
  right-side drawer, opened on demand — chosen over a permanently-split 3-column layout so the day
  list and map keep their existing full width by default. **Superseded in v0.7.0** — see below;
  the `Sheet` read as a detached popup rather than part of the screen, so it was replaced.

### Itinerary intelligence, drag-and-drop, and chat research (v0.7.0) — PARTLY SUPERSEDED (v0.9.0)

> **Two of these four survived v0.9.0.** "Remove = unschedule for activities" and the draggable
> activities panel (including the `list-` id prefix) are still live and still correct. The
> clustering pass (`geo-cluster.ts`) and everything about chat — the inline tab switcher and
> research mode — were deleted with the AI. The clustering entry is worth keeping for its finding:
> **the model was never computing distance**, it was pattern-matching on coordinate text. If
> proximity ever matters again, measure it.

**Real distance, not inferred proximity.** `buildItinerary` was trusting Gemini to infer
geographic grouping from raw `lat,lng` text in the prompt — no real distance was ever computed.
A reported case (four venues a few minutes apart in Merrillville/Michigan City, IN) landed on
different days despite the model being shown their coordinates. Fixed with a small greedy
union-find clustering pass (`src/lib/geo-cluster.ts`, `clusterByDistance`, using the existing
`haversineMiles`) run over enriched activities before the prompt is built; activities within
`CLUSTER_RADIUS_MILES` (9, transitively chained) get a shared `cluster CN` label handed to the
model as a **measured fact**, with an explicit instruction not to split a cluster just to even out
day sizes. The model still makes the final call (a conflicting preferred date or a full day can
still override), but it's no longer inferring proximity from scratch.

**Remove = unschedule for activities, not delete.** `ItineraryPanel`'s `onRemove` prop changed
from `(id: string) => void` to `(item: Item) => void` so the caller can branch on `kind` without a
lookup. In `trips.$tripId.tsx`, an activity's remove now calls a new `unscheduleMut`
(`day_index: null, sort_order: 0` via the existing `updateItemFn`) instead of `removeMut`
(hard delete); every other kind (`block`/`transport`/`lodging`) is unchanged, since only activities
have a staged/scheduled duality (`isStagedActivity`). The Activities tab's own remove button is
untouched — it's still a real delete, and is the only place one exists now.

**Draggable activities panel — the `list-` id prefix.** A new left-side panel
(`ActivitiesDragPanel`/`ActivityListRow` in `itinerary-panel.tsx`) shows every activity, staged and
scheduled, as a drag source. A scheduled activity's row already exists as a draggable in its day
column, so the panel's rows use a **prefixed** drag id (`list-${item.id}`) — the same trick as the
existing `day-N`/`daytab-N` split, needed because dnd-kit's registry breaks if two draggables share
an id in one `DndContext`. `handleDragStart`/`handleDragEnd` strip the prefix to resolve the real
row. Dropping onto the day column with the item's origin day resolving to `null` (staged) is
treated as "first-time scheduling," not a move — no source-day cleanup patch, since there's nothing
to clean up. Dropping back onto the panel's own droppable (`activities-panel`) unschedules a
scheduled activity via the same path as the itinerary remove button above.
- `ItemMove`'s `moved` callback shape changed `fromDay: number` → `fromDay: number | null`
  end-to-end (`itinerary-panel.tsx` through `runAdvisor` in `trips.$tripId.tsx`) to carry this.
  `adviseItineraryChange`'s `from_day` was already nullable, so no server-side schema change.
- `runAdvisor`'s projection also changed from `committedItems(...)` to filtering out only lodging
  candidates: `committedItems` excludes staged activities *before* the move is applied, so a
  newly-scheduled (previously staged) activity would otherwise be invisible to the advisor's
  post-drag day check. Filtering only `isLodgingCandidate` keeps everything else (including
  not-yet-remapped staged rows, which the day filter downstream naturally excludes since their
  `day_index` stays null) so the remap actually takes effect.

**Chat: inline tab switcher, not an overlay.** The `Sheet` drawer is gone. The itinerary's
right-hand slot (day panel column) now has a small "Map" / "Ask AI" tab toggle
(`rightView: "map" | "chat"` state) — "Map" renders the existing `ItineraryDayPanel` untouched,
"Ask AI" renders the same message-list/input JSX as a plain in-flow `<div>`, no portal/backdrop/
fixed positioning. Chosen (per user decision) over a 4-column squeeze or a horizontal activities
shelf — see the layout options weighed at the time for the alternatives not taken.

**Chat research mode — additive, no response-shape change.** `chatItinerary`'s exported
`chatItinerarySchema`/`ItineraryOp` are unchanged; the actual Gemini call now uses an internal-only
superset schema (`chatRoutedSchema`) with `intent: "edit" | "research" | "clarify"`,
`research_query`, `day_index_hint`. A research turn returns `operations: []` and puts the answer in
`reply` — the caller already treated an empty-operations response as "just show the reply, nothing
to apply," so this needed zero changes downstream (`chatMut`/`applyOps`/undo/toast/chat bubble).
Research answers are grounded in a real Places search (new `searchNearby` in
`google-places.server.ts`, generalizing the previously-private `searchTextCategory` from 7 canned
category strings to arbitrary free text) centered on the referenced day's stops' centroid — which
required adding `lat`/`lng` to `chatItinerary`'s `items` input schema (it previously only carried a
`location` address string, no coordinates) — or the destination's geocoded location if no day is
implicated. Real results are then handed to a second `generateStructured` call instructed to use
*only* the given places and explain proximity/fit, not invent anything. A "clarify" intent (can't
tell which day/place a research question means) short-circuits before any Places call, mirroring
the existing edit-ambiguity rule ("never guess at a removal") extended to research targets.

### Day map location bug + removing day start time (v0.7.1)

**Bug: `details.coords` vs. flat `details.lat`/`details.lng`.** `coordsOf()` in
`itinerary-day-panel.tsx` reads `item.details.coords = { lat, lng }` — the shape every writer in
the codebase uses (AI enrichment in `buildItinerary`/`chatItinerary`, lodging) **except one**: the
Places browse dialog's Add handler (`activities-panel.tsx`) did `details: a`, spreading the raw
search result verbatim. `mapPlace()` in `google-places.server.ts` returns `lat`/`lng` as flat
top-level keys, not nested under `coords` — so activities added that way (e.g. "Albanese Candy
Factory," reported as the trigger case) got real coordinates saved under the wrong key, and the
day map's "nothing to plot" fallback fired despite the data genuinely being there.
`trip_items.details` is unvalidated JSON (`z.any()`), so nothing catches this class of mismatch at
write time — worth remembering if another writer is added later.

Fixed both ends, deliberately not just one:
- `coordsOf()` now falls back to flat `details.lat`/`details.lng` when `details.coords` is absent
  — this is what actually fixes *already-saved* rows immediately, with no backfill/migration
  needed (the "real stored data" for existing activities genuinely is in the flat shape).
- The Add handler now nests coordinates under `details.coords` like every other writer, so new
  adds through this flow stop drifting from the rest of the codebase.
- A reader-only fix (without the writer fix) would have been a permanent patch masking a bug that
  keeps recurring for every future add through that path; a writer-only fix wouldn't have helped
  any activity already saved before the fix shipped. Needed both.

**Day start time removed.** The per-day "Start" input (added in v0.6.0's B3) is gone — UI, the
`day_start_time` param on `dayPlan`'s prompt, `trips.day_start_times` (dropped via migration
`20260817020000_drop_day_start_times.sql`), and `checkArrivalConflict`'s now-unused
`dayStartMinutes` parameter (its fallback is a hardcoded `0` now). It never affected the actual
map/route calculation (OSRM distance/duration between real coordinates) — only AI guidance-note
text — and was judged not worth the manual-input UI now that the itinerary's timing model has
moved to drag-order-is-truth plus optional per-item pinned times (see the v0.6.0 entry above).

### Manually-added activities never got coordinates (v0.7.2)

A second, unrelated day-map location bug, found right after v0.7.1 shipped: v0.7.1 fixed activities
added via the Places browse dialog (real coordinates, saved under the wrong field). This one is
activities added through the **manual form** — those never had coordinates at all, not a
field-name mismatch. Traced to three compounding gaps:
- `activity-manual-form.tsx` only ever submitted `details: { location, duration_hours,
  preferred_date }` — `location` is a plain string, no `coords` anywhere.
- `place-autocomplete.tsx`'s suggestion picker only passes up the prediction's display **text**
  (`onChange(s.text)`) — it never calls Places Details to resolve a `placeId` to coordinates. Its
  own docstring claimed "coordinates are resolved server-side at submit" — that was aspirational;
  nothing implemented it. (Fixed as of this entry — the docstring now points at where it actually
  happens.)
- `addTripItem` inserted `details` exactly as sent, no geocoding. The only geocoding anywhere
  (`lookupPlaceDetails`) was wired into `buildItinerary`'s enrichment, which only runs on **staged**
  activities when "Build out itinerary" is clicked — never at manual-add time, and never for an
  activity already scheduled onto a day (like the reported case).

**Fix: one chokepoint, not three.** `enrichActivityLocation()` in `trips.functions.ts`, called from
`addTripItem` before every insert, scoped to `kind === "activity"`:
- Skips entirely if `details.coords` already exists (browse-dialog and chat-added activities
  already carry real ones — this is a no-op for them, not a duplicate lookup).
- Otherwise calls `lookupPlaceDetails(title, near)`, where `near` is `details.location` if typed,
  else the trip's `destination` (one extra `trips` select by `trip_id`) — the same
  "name + destination" fallback `buildItinerary`'s own enrichment already uses.
  Every activity, regardless of how it was created, passes through `addTripItem` to be inserted,
  so this is the one place that can guarantee "gets real coordinates if they can be found" without
  fixing each entry point (manual form, autocomplete, chat) separately.
- Non-fatal by design — a missing key, an outage, or zero results just means the activity saves
  without coordinates, same as before this existed. Never blocks the add.
- **TS gotcha**: typing the lookup context param directly against the real Supabase client's
  `context.supabase` type (deeply generic, many `.select()` overloads) hit
  `TS2589: Type instantiation is excessively deep and possibly infinite`. Fixed with a narrow local
  `TripLookupContext` type and an explicit `as unknown as TripLookupContext` cast at the one call
  site — bypasses the structural comparison entirely rather than trying to make the narrow type
  structurally assignable from the real client type.
- **Does not retroactively fix rows saved before this shipped** (e.g. "Albanese Candy Factory," the
  reported case) — no backfill/migration. The already-scheduled row needs to be unscheduled (back
  to staged) and either re-added or picked up by a re-run of "Build out itinerary" (its own
  enrichment now finds it, since it's staged and coordinate-less).

### Itinerary layout: full-width map + persistent chat sidebar (v0.8.0) — SUPERSEDED (v0.9.0)

> **The chat sidebar is gone and the grid is one column again.** The map-height finding below is
> the part that carried forward: readability under a busy day was purely a function of container
> height, not any code-level truncation, and `FitToPins` has no pin-count ceiling. That's why
> v0.9.0 could point the same map at the *whole trip's* activities and only needed to raise the
> height again (450px → 520px).

The map and chat used to share one toggleable slot (`rightView: "map" | "chat"`) beside the day
column — cramped (map got only half the row) and only one visible at a time. Reworked in
`itinerary-panel.tsx`:
- Outer grid became `grid lg:grid-cols-[minmax(0,1fr)_210px]` — a fixed-width right column plus a
  flexible left one is the standard way to pin a sidebar width while letting the main area flex;
  chosen over hand-computing an exact percentage split, which would fight with the fixed-width
  requirement on the same column anyway.
- Left column: the activities-panel + day-tabs/day-column row is unchanged in behavior, just no
  longer paired with the map in its own 2-col grid — the day column now takes the full width of
  its `flex-1` slot. A new full-width block renders `dayPanel` directly beneath it, no toggle
  wrapper, no branch.
- Map height: `itinerary-day-panel.tsx`'s three fixed-height wrappers (pins branch, "nothing to
  plot" fallback, AND the `stops.length === 0` "nothing scheduled" empty state — three, not two;
  worth checking all call sites when changing a shared height convention, not just the ones that
  first come to mind) went from `320px` to `450px`. `DestinationMap`'s own `h-full` wrappers needed
  no change — they fill whatever height the parent gives them, and `FitToPins`'s `map.fitBounds`
  has no pin-count ceiling, so readability under a busy day was purely a function of container
  height, not any code-level truncation.
- Chat sidebar: always rendered now, no `rightView` state. Styled with the same tokens
  `AppSidebar` uses for its dark-green look (`bg-sidebar`, `text-sidebar-foreground`,
  `text-sidebar-muted`, `bg-sidebar-active`) rather than the neutral card style the toggle version
  had. "Full height" is CSS grid's default `align-items: stretch` — the chat column automatically
  matches the left column's rendered height with no extra code, since it's a sibling grid item.
  This isn't the same as viewport height (`h-screen`, like the *actual* `AppSidebar`) — it's scoped
  inside the Itinerary tab's own content area, not a sibling of the page shell.

### The Itinerary tab has no AI in it (v0.9.0)

This is a deliberate, explicit reversal of four releases of work (A2–A5, v0.6.0's chat drawer,
v0.7.0's clustering and research mode, v0.8.0's chat sidebar). It was scoped as a full replacement,
not an incremental change, and confirmed as such before any code was deleted. **Don't "restore"
any of it without a new decision** — the superseded sections above explain what each piece did and
why it was built, which is exactly the material that makes rebuilding it tempting.

**What survived, and why the split falls where it does.** The rule applied was *remove the
software's opinion, keep the traveler's tools*:

| Kept | Removed |
|---|---|
| Day tabs, drag-to-day, drag-to-unschedule, blocks | `buildItinerary` (AI day assignment) |
| Pinned arrival time + `checkArrivalConflict` | `chatItinerary` (+ research mode) |
| `committedItems` / staged-vs-scheduled semantics | `adviseItineraryChange` (drag advisor) |
| `renumberDay`, the `day-N`/`daytab-N`/`list-` id prefixes | `dayPlan` (per-day route + AI notes) |

`checkArrivalConflict` is the one advisory left. It survived the cut **because it never called a
model** — it's a pure local heuristic, and it answers a question the traveler asked by pinning a
time rather than volunteering an opinion about a drag. It now reports through a toast: the inline
pill it used to render in was shared with the A4 advisor, and that pill went with the advisor.

**Three consequences that are easy to get wrong if you touch this later:**

- **The map is trip-wide, not day-scoped.** `renderMapPanel` deliberately takes no day index. It
  renders once, below the day row, and is unaffected by `selectedDay`. Re-scoping it to the
  selected day would quietly recreate the thing that was removed.
- **`coordsOf()` moved to `workspace-store.ts` and must stay reachable.** It was salvaged out of
  the deleted `itinerary-day-panel.tsx`. Its `details.coords` → flat `details.lat`/`details.lng`
  fallback is the whole of the v0.7.1 fix; losing it silently un-plots every activity added
  through the Places browse dialog before that release.
- **`lookupPlaceDetails` and `searchTextCategory` are NOT orphans.** They sit in the same provider
  file as the deleted `searchNearby` and look equally AI-adjacent. They are not: `lookupPlaceDetails`
  is the v0.7.2 geocoding chokepoint every activity insert runs through, and `searchTextCategory`
  backs the Activities browse dialog. Deleting either breaks activity coordinates with no error.

### Two different distance measurements, and why they must not be merged (v0.10.0)

The Itinerary tab shows driving numbers in two places. They look alike and are computed from
completely different things — conflating them is the obvious mistake here, so both hooks live in
`src/hooks/use-activity-distances.ts` with the distinction documented at the top of the file.

| | Surface | Measures | Order-dependent? | Server fn |
|---|---|---|---|---|
| **From-stay** | Activities panel rows | booked lodging → activity | No | `distancesFromLodging` |
| **Leg** | Day timeline, between cards | stop → next stop in the day's order | **Yes** | `dayDistanceMatrix` |

They agree **only** for the first stop after the lodging on its day — verified live: with the day
ordered stay → Shedd → Field, Shedd's leg and its from-stay figure were both `1.9 mi · 5 min`,
while Field's leg (`0.5 mi`) and its from-stay (`1.7 mi`) differed. Dragging Field to first made
its leg become `1.7 mi`, matching its from-stay exactly, because it was then the first stop. If
those two ever agree for a non-first stop, one of them is reading the wrong source.

⚠️ **The shared query key must be sorted by id.** Both `ActivityMapPanel` and `ItineraryPanel`
call `useActivityDistances` with the same activity set in *different orders* — the route passes an
unsorted list to the map panel while `ItineraryPanel` sorts its copy by `day_index`. A key built
from array order produces two different keys for identical data and fires the same request twice.
`signatureOf()` sorts before joining; verified as exactly **one** `distancesFromLodging` call with
both surfaces mounted.

### Day legs use a distance MATRIX, not a route per ordering (v0.10.0)

`getDistanceMatrix` (`providers/osrm.server.ts`) asks OSRM's `table` service for the **full N×N**
matrix of a day's stops — the same endpoint `getDistancesFrom` uses, minus the `sources=0`
parameter that limits it to one row.

**Why a matrix and not a route through the stops in order:** legs are sequence-dependent and the
sequence changes on every drag. Routing per ordering means a network round trip on every drop.
Keying the matrix on the *set* of stops instead makes reordering a pure client-side lookup —
verified live: a drag-reorder changed every leg while `dayDistanceMatrix` stayed at **1 call**.
Only adding or removing a stop changes the key.

⚠️ **`getRouteForCoords` was deleted in v0.10.0**, not merely orphaned. It had been dead since
v0.9.0 removed `dayPlan`, and it is exactly what someone would reach for to build legs — leaving
it in place invited quietly undoing the above. Don't reintroduce it for this purpose.

⚠️ **`getDistanceMatrix` deliberately does not chunk**, unlike `getDistancesFrom`. Chunking a
matrix correctly needs O(n²/CHUNK²) requests to cover cross-chunk pairs; a single day never has
that many stops. It throws past `MATRIX_MAX_POINTS` (40) rather than returning a truncated matrix
the caller would read as complete.

**No-coordinate stops break the numbers, not the rail.** A leg renders only when *both* ends have
coordinates. A stop without them keeps its node (hollow) and the spine runs past it unbroken, but
both adjacent gaps read "no location". The rejected alternative was bridging — drawing a real
A→C leg across the unlocated B — which puts a mileage figure next to a stop it never measured
from. Verified: `Zoo → [no location] → Relax, no plans (hollow) → [no location] → Powers`.

**The rail's node vocabulary** (built to the "option C" mockup, confirmed by screenshot):

| Node | Meaning |
|---|---|
| Solid `primary`, 14px | the booked stay — anchors the day it sits on |
| Hollow, grey ring, 12px | an ordinary stop |
| Hollow, grey ring, **40% opacity** | a stop with no coordinates |

⚠️ **The hollow ring is `border-muted-foreground/45`, deliberately NOT `border-border`.** `--border`
is `oklch(0.9 …)` — nearly white — and at that lightness the hollow node barely registered and the
faded variant disappeared outright. This was invisible in the DOM (the testids and computed styles
were all correct) and only showed up in a screenshot. If you restyle these, look at a render.

The mockup's node is navy; this uses the app's green `--primary` instead, since every other accent
in the app is green and the blue was mockup styling rather than a brand decision.

**The spine is drawn as per-row segments, not one absolute line.** It has to start at the first
node's centre and end at the last node's centre, and a single line with a fixed inset can only
guess where those land once row heights vary (a pinned time chip, a wrapped title). Each row draws
a half-segment above and below its node — skipped at the two ends — and each leg row draws a full
one. This also handles dragging for free: leg rows unmount mid-drag, so the remaining row segments
become adjacent and the spine stays continuous with no special case.

**Timeline and dnd-kit.** Leg rows are plain, non-sortable divs interleaved between `SortableRow`s
inside the existing `SortableContext`; the sortable ids stay exactly `dayItems.map(i => i.id)`, so
`handleDragEnd` and the `day-N`/`daytab-N`/`list-` prefix resolution are untouched. Legs are
**hidden while a drag is in flight** (`dragging` state) — cards translate during a drag but the
interleaved legs don't, so leaving them visible points numbers at the wrong pairs mid-gesture.

### Distances come from one OSRM `table` call, not N route calls (v0.9.0)

`getDistancesFrom()` (`providers/osrm.server.ts`) uses OSRM's **table** service with `sources=0` —
one request returns the origin's row of the full matrix, so a trip with twenty activities costs
one call rather than twenty. The public demo server is rate-limited and this runs whenever the
activity set changes, so the naive loop over `getRouteForCoords` would have been a real problem
rather than a stylistic one. Targets are chunked at 50 (the demo server's ceiling is 100
coordinates including the source).

⚠️ **Not every OSRM build returns the `distance` annotation**, only `duration`. When it's absent
the leg comes back with `miles: null` and `distancesFromLodging` (`travel.functions.ts`)
substitutes `haversineMiles` — straight-line, marked with an asterisk in the UI so it isn't
presented as road distance. The drive time is real either way. The fallback lives in the caller,
not the provider, so `osrm.server.ts` stays free of app imports (pulling in `workspace-store`
would drag zustand into the server bundle for one pure function).

The whole thing is non-fatal by design: a routing outage returns every leg unrouted plus an
`error` string, and the map and activity list still render. Distances are a convenience on this
screen, not something worth failing the tab over.

### Itinerary building: the planner only sees staged activities — SUPERSEDED (v0.9.0)

> **`buildItinerary` was deleted in v0.9.0**, so nothing below describes live code. Kept for the
> general lesson, which applies to any future feature that lets a model assign positions: **don't
> trust the model with completeness, range, or ordering.** It numbered `sort_order` from 0 every
> time with no knowledge of rows already on the day; the client-side renumbering
> (`renumberDay`, still live) is what made that safe.

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

### Live sync: two channels, because item rows can't say who changed them

`useTripRealtime` (`src/hooks/use-trip-realtime.ts`) owns the one subscription per open trip.
Freshness and attribution deliberately come from **different tables**:

| Concern | Source | Why |
|---|---|---|
| Refresh the workspace (B1) | `postgres_changes` on `trips` + `trip_items` | Any change should refresh; who did it is irrelevant |
| "Sarah moved X" (B2/B3) | `postgres_changes` on `trip_activity` | Only these rows carry a trustworthy actor |

⚠️ **Don't try to attribute a change from a `trip_items` payload.** `trip_items.user_id` is creator
provenance (§ above): on an UPDATE it still holds whoever first created the row, not whoever just
moved it. Notifications built on it would credit the wrong person.

Three things that fail *silently* if omitted:

1. **`realtime.setAuth(token)` before subscribing.** The socket authenticates separately from
   PostgREST. Without it, RLS-protected `postgres_changes` deliver nothing — and the channel still
   reports `SUBSCRIBED`.
2. **Re-apply the token on `TOKEN_REFRESHED`.** Supabase rotates access tokens; the socket keeps
   whichever it was given, so a long-lived tab goes deaf partway through a session.
3. **`removeChannel` on unmount / trip change.** Otherwise switching trips leaks subscriptions and
   every later change fires N refetches.

Row events are debounced (250ms) because one drag rewrites several rows and Postgres emits one
event each — the traveler did one thing and needs one refetch. Activity events are **not** debounced;
each is a distinct action.

### Activity is logged per INTENT, not per row

Mutating server fns in `trips.functions.ts` take an optional `activity` descriptor. One user action
→ one `trip_activity` row → one toast and one feed entry, even when the action rewrote a dozen rows.
Logging per changed row would make both the toast stream and the feed useless; a single drag would
fire five notifications. Callers doing internal bookkeeping (renumbering a day, applying an AI plan)
omit it deliberately.

`logActivity` is fire-and-forget: a failure is logged server-side and swallowed. **An audit trail
must never be able to fail the edit it describes.**

The actor's email is denormalised into `details.actor_email` from the JWT claims at write time, so
rendering the feed needs no admin lookup per row.

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

### v0.10.0 (itinerary distances: from-stay + leg-by-leg timeline) — 2026-08-19

**Verified end-to-end in a live browser on 2026-08-19** (headless Edge + puppeteer-core, live
Supabase project, seeded Chicago trip). See §3's "Two different distance measurements" and "Day
legs use a distance MATRIX" for the design. No schema or migration change — purely code.

Adds the two distance surfaces described in §3, plus a vertical timeline treatment for the day
schedule (spine, a node per stop, the stay's node filled, legs on the rail between cards).
`getRouteForCoords` deleted; `getDistanceMatrix` + the `dayDistanceMatrix` server fn added;
`useActivityDistances`/`useDayLegs` extracted into `src/hooks/use-activity-distances.ts` so the
map panel and the activities panel share one query.

All six checks passed: the two numbers proved genuinely distinct (and converged exactly when the
reordered day made a different activity first); a drag-reorder recalculated every leg with
**zero** additional `dayDistanceMatrix` requests; the no-lodging trip degraded cleanly; an
unlocated block produced "no location" on both sides without a bridged figure; exactly one
`distancesFromLodging` call served both surfaces; and no AI-backed handler fired.

⚠️ **Whole-mile rounding was a real defect caught in verification, not a nitpick.** The first
implementation rounded to integers, which turned a genuine 0.5 mi hop into **"0 mi"** — reading
as a failure rather than a short walk — and flattened 1.7 and 1.9 into the same "2 mi", hiding
the very difference the feature exists to show. `formatLeg` now uses one decimal under 10 miles.

### v0.9.0 (Itinerary tab: static activity map, no AI) — 2026-08-19

**Verified end-to-end in a live browser on 2026-08-19** (headless Edge + puppeteer-core, live
Supabase project, seeded 4-day trip). See §3's "The Itinerary tab has no AI in it (v0.9.0)"
and "Distances come from one OSRM `table` call" for the design, and `FEATURE_TRACKING.md` for
the per-item evidence. The acceptance criterion passed: **all 17 server-fn calls observed across
the session were non-AI** (`getTrip`, `distancesFromLodging`, `updateTripItem(s)`, `addTripItem`),
with a positive control confirming the probe catches `searchTransport` on the Transport tab.
One gap: map pins were asserted but **not visually confirmed** — no Maps key locally. **No schema or migration change** — purely
code. `npx tsc --noEmit`, `npx eslint src/`, and `npm run build` all pass (eslint clean apart from
the 7 pre-existing `react-refresh` warnings, which is the documented "source is fine" tell).

A full replacement of the Itinerary screen's behavior, not an incremental change. Removed:
`buildItinerary` (A2 AI scheduler) and `geo-cluster.ts`, `chatItinerary` (A3, including v0.7.0's
research mode), `adviseItineraryChange` (A4 drag advisor) and `assessDay`/`averageDayCost`,
`dayPlan` (A5 per-day route map + AI notes) and `itinerary-day-panel.tsx`, and `searchNearby`.
Added: `ActivityMapPanel` (a trip-wide static map + a distance/drive-time list),
`getDistancesFrom` in the OSRM adapter, and the `distancesFromLodging` server fn.

Day tabs, drag-to-schedule, drag-to-unschedule, blocks, pinned arrival times, and the budget's
staged-vs-scheduled treatment are all unchanged — the three scope questions that decided this
(keep day grouping? keep pinned times? change the budget?) were asked and answered before any
deletion, and all three came back "keep current behavior."

⚠️ **`whats-new-dialog.tsx` renders `CHANGELOG.md` directly** (`?raw` import) and derives
`CURRENT_VERSION` from its first `## vX.Y.Z` heading. The changelog entry is therefore user-facing
product copy, not just a developer record — it's what travelers see in the What's New dialog, and
adding an entry is what bumps the version badge in the sidebar.

### v0.8.0 (itinerary layout: full-width map + persistent chat sidebar) — 2026-08-17

Not yet verified end-to-end in a live browser — see §3's "Itinerary layout: full-width map +
persistent chat sidebar (v0.8.0)" for the design, and `FEATURE_TRACKING.md` for the manual-test
checklist, which specifically calls out testing a day with 4+ activities (not just the 3-item
cases used so far) since that was the actual point of the height change. No schema/migration
change — purely `itinerary-panel.tsx` (layout) and `itinerary-day-panel.tsx` (map height, 320px →
450px, three call sites).

Replaced the Map/Ask AI toggle (one shared slot, only one visible at a time) with the map full-
width below the activities/day-schedule row and a permanently-visible chat sidebar on the right,
styled like the app's own left nav.

### v0.7.2 (manually-added activities never got coordinates) — 2026-08-17

Not yet verified end-to-end in a live browser — see §3's "Manually-added activities never got
coordinates (v0.7.2)" for the design, and `FEATURE_TRACKING.md` for the manual-test checklist. No
schema/migration change — purely code, in `addTripItem` (`trips.functions.ts`).

A second, unrelated day-map location bug found right after v0.7.1: activities added through the
manual form never got coordinates at all (not a field-name mismatch like v0.7.1 — genuinely never
geocoded). Fixed with one new server-side enrichment step, `enrichActivityLocation()`, run for
every activity insert regardless of source (manual form typed/autocompleted/blank, browse dialog,
chat) rather than fixing each entry point separately. Does not retroactively fix rows already
saved without coordinates — see the workaround (unschedule + re-add or re-run "Build out
itinerary") in §3.

### v0.7.1 (day map location bug, remove day start time) — 2026-08-17

Not yet verified end-to-end in a live browser — see §3's "Day map location bug + removing day
start time (v0.7.1)" for the design, and `FEATURE_TRACKING.md` for the manual-test checklist.
**Needs the new migration applied to the live Supabase project** (drops `trips.day_start_times`)
before this is usable in production.

1. **Fixed the day map "nothing to plot" bug** — a coordinate field-name mismatch (`details.coords`
   vs. flat `details.lat`/`details.lng`) in the Places browse-and-add flow. Fixed both the reader
   (fallback, fixes already-saved activities immediately) and the writer (stops new adds from
   drifting the same way).
2. **Removed the per-day start time field** — UI, `dayPlan`'s prompt input, and the
   `trips.day_start_times` column, all the way out. Never affected the actual map/route math.

### v0.7.0 (itinerary intelligence, drag-and-drop, chat research) — 2026-08-17

Not yet verified end-to-end in a live browser — see §3's "Itinerary intelligence, drag-and-drop,
and chat research (v0.7.0)" for the design, and `FEATURE_TRACKING.md` for the manual-test
checklist. No schema/migration change this round (no new columns) — purely code.

1. **Geography-aware clustering** in `buildItinerary` — real haversine distance, not inferred
   proximity, drives which activities are grouped onto the same day.
2. **Remove from itinerary unschedules, not deletes** — an activity removed from the Itinerary tab
   goes back to staged; the Activities tab is the only place a real delete happens now.
3. **Draggable activities panel** — a persistent left-side list (staged + scheduled activities)
   that's itself a drag source onto any day, using a `list-` id prefix to avoid colliding with the
   same item's day-column row in the same `DndContext`.
4. **Chat became an inline Map/Ask AI tab switcher** in the day panel's slot, replacing the
   `Sheet`-based drawer from v0.6.0, which read as a detached popup.
5. **Chat research mode** — open-ended questions get answered from a real Places search grounded
   in the referenced day's actual stops, not the model's general knowledge; additive, no response
   shape change (`operations: []` + `reply` already covered this case).

### v0.6.0 (itinerary timing fix + UI cleanup) — 2026-08-17

Not yet verified end-to-end in a live browser — see §6/§7 and `FEATURE_TRACKING.md` for what
still needs a real multi-day trip run-through. Migration `20260817010000_day_start_times.sql`
(adds `trips.day_start_times`) applied to the live Supabase project on 2026-08-17 and confirmed
with `select day_start_times from trips limit 1;` (returned `null`, as expected — no trip has set
one yet). The column itself is real; the app code that reads/writes it is still unverified live.

1. **Timezone root-cause fix** for the "9 AM doesn't match display order" bug — see §3, "Timing
   is manual now, not AI-assigned."
2. **AI planner and chat stopped assigning clock times.** `buildItinerary`/`chatItinerary` only
   ever place by day + position now; the `retime` chat op was removed.
3. **Per-day start time** (`trips.day_start_times`, JSONB) — set from the day column header,
   feeds `dayPlan`'s guidance prompt, never written onto an item.
4. **Per-item pinned arrival time** — a popover on the item's time chip in `itinerary-panel.tsx`,
   backed by a new `checkArrivalConflict` heuristic in `itinerary-advice.ts` (same local,
   no-AI-call pattern as the A4 drag advisor).
5. **Chat moved into a right-side drawer** (shadcn `Sheet`), opened via an "Ask AI" button,
   instead of an always-visible block above the day tabs.
6. **Trimmed itinerary cards** — dropped the subtitle/description and planner-reason lines, and
   the inline cost. Restyled the A4 advisor banner as a smaller dismissible pill rather than
   removing it (kept on purpose — see §3).

### v0.5.0 (activities/itinerary AI overhaul + live collaboration) — 2026-08-17

Shipped as PRs #1–#9, all merged to `main` and deployed. Verified live in production: the photo
proxy serves real bytes and the server key appears nowhere in the page.

**Part A — activities and itinerary**
1. **A1 — activities stage instead of scheduling themselves.** Adding an activity used to write it
   onto Day 1. Now `day_index IS NULL` means staged; see §3.
2. **A2 — "Build out itinerary".** Gemini schedules staged activities onto days, with Places
   enrichment for anything missing a location. `updateTripItem` gained `details`; new
   `updateTripItems` batch endpoint.
3. **A3 — itinerary chat.** Returns *operations* (move/remove/add/swap_days/retime), not prose, and
   every batch is undoable from its toast. The Activities tab became the master list.
4. **A4 — drag advisor.** A local heuristic pass gates the AI call, so a benign drag costs nothing.
5. **A5 — day tabs + per-day route map.** OSRM routes a day's stops from stored coordinates; notes
   are split into **Live · Google** vs **Guidance**.
6. **Security — Places photo proxy.** `GOOGLE_API_KEY` was embedded in every photo URL sent to the
   browser, from v0.1 through v0.5.0. Now `/api/places/photo`; see §2.

**Part B — live collaboration**
7. **Migration** `20260817000000_realtime_and_activity_feed.sql` — publication, `REPLICA IDENTITY
   FULL`, and the append-only `trip_activity` table.
8. **B1–B3** — live sync, attributed toasts, activity feed. **B4 (presence) not attempted.**

**Repo hygiene:** `.gitattributes` pins LF (a fresh Windows clone previously produced ~12,400
phantom eslint errors), and `activities-panel.tsx` was reformatted so `npx eslint src/` passes on
`main` again — it had been failing with 188 errors.

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

### Techniques that made v0.5.0's testing trustworthy

**Count server-fn calls off the wire — and decode the id first.** TanStack Start posts to
`/_serverFn/<base64url>` where the payload is JSON containing
`"<fnName>_createServerFn_handler"`. Matching the *raw* URL for a function name finds nothing and
silently reports **zero calls**, which turns "no AI call fired" into a vacuous pass. Decode the
segment before matching. This is what proves claims like "a benign drag costs nothing".

**Two accounts means two browser CONTEXTS.** `browser.createBrowserContext()` per user gives each
its own storage; two tabs in one context share a session and prove nothing about per-user filtering.
Required for anything about "excluding your own changes".

**Poll for toasts, don't sleep past them.** Sonner auto-dismisses (6s here). A single sample taken
after the window reports an empty list for a notification that did appear — an early B2 run "failed"
this way. Accumulate `[data-sonner-toast]` text across the window instead.

**A DB-polling helper can outrun the UI.** Test helpers that wait on the database return as soon as
the row changes — which happens *before* the mutation resolves and the toast renders. Waiting for
the button/toast, not the data, is what fixed the A3 undo test.

**Prefix-matching `data-testid` is a trap.** `[data-testid^="itinerary-day-"]` also matched the day
side panel, reporting a phantom second day column. Match exactly (`/^itinerary-day-\d+$/`) or give
the sibling a different prefix.

**Assert the honest expectation, not the hoped-for one.** The day map legitimately renders a
fallback locally (referrer allowlist), and a non-member legitimately never renders the workspace at
all — so waiting on `trip-meta-bar` for them is the wrong assertion. Its *absence* is the pass.

---

## 6. Known gaps — verified vs not

**Verified against live Supabase + OSRM + real browser (v0.9.0, 2026-08-19):** zero AI calls from
the Itinerary tab (all 17 server-fn calls decoded and non-AI, with a positive control proving the
probe catches an AI handler when one fires); trip-wide map pin set non-empty and identical across
all day tabs; real OSRM distances from the booked stay with the lodging *candidate* correctly
ignored; legacy flat-coords rows still plot (the `coordsOf` salvage); pinned arrival time + its
conflict toast; drag-to-schedule; unschedule-not-delete; add block; the no-lodging state; and
budget totals unchanged from pre-v0.9.0 semantics.

⚠️ **Two gaps remain on v0.9.0.** (1) **Map pins were never seen.** Their existence was inferred
from the absence of the empty state plus the distance table, which is real evidence but not a
rendering check — no `VITE_GOOGLE_MAPS_KEY` locally, and `localhost` is not on the key's referrer
allowlist anyway. Confirm in production. (2) **The straight-line mileage fallback never fired** —
public OSRM returned road distance every time — so that branch is untested, not passing.

**Not yet verified — v0.6.0 (itinerary timing fix):** the day-start-time field, per-item pinned
arrival time + its conflict check, the quieter advisor banner, and the chat drawer all need a real
multi-day trip run-through — none of it has been exercised against a live Supabase project (the
`day_start_times` migration also hasn't been applied yet). Tracked with checkboxes in
`FEATURE_TRACKING.md` rather than duplicated here — check that file off as each is confirmed.

**Verified against live Supabase + real browser (25/25 checks, v0.3.0):** booking exclusivity,
budget excluding candidates, blank-slate activities, drag persistence across reload, dashboard
cards deriving from real trip state, travel estimate matching hand-checked OSRM output.

**Verified against live Supabase + real browser, two real users, production (v0.4.0):**
invite-link generation and redemption, collaborator appearing in the Share dialog, a
collaborator's added item becoming visible to the owner (confirms RLS write access, not just
UI), Lodging Book button, Activities manual-add, Activities URL-fetch prefill (tested against a
real Wikipedia page, correctly pulled the `og:title`-derived page title).

**Verified against live Supabase / Gemini / Places / OSRM + real browser (v0.5.0):**
- **A1** 22 assertions — itinerary unchanged on add, 51 staged rows uncapped, drag still persists.
- **A2** 17 — every activity scheduled, pinned dates honoured, a location-less activity looked up
  and persisted, zero `(day, sort_order)` collisions on an incremental rebuild.
- **A3** 19 — fuzzy-name resolution, day swap in both directions, undo restores a removed row, an
  ambiguous request moves nothing.
- **A4** 11 — **advisor calls counted off the wire**: 5 benign drags → 0 calls; an overloaded day →
  exactly 1.
- **A5** 12 — one day column instead of four stacked, real drive estimate, Live/Guidance badges,
  0 extra AI calls across 6 tab re-visits.
- **Photo proxy** 11 — 7/7 hostile `name` inputs rejected 400; the key absent from 54 images, 211
  requests and 300KB of HTML, with a control assertion proving the scan wasn't matching nothing.
- **Part B migration** 8 — realtime delivers INSERT/UPDATE/DELETE (previously 0 events); a forged
  `actor_id` rejected `42501`; a non-member reads 0 rows.
- **B1–B3** 13, **two real accounts in two isolated browser contexts** — collaborator's change
  reaches the owner with no reload, the owner gets **zero** attributed toasts for their own edit,
  one multi-row drag logs exactly **one** activity entry.

**Never exercised — needs keys that aren't in local `.env`:**
- **Flight** travel estimates (Duffel). Car and train are confirmed working.
- Google Places **autocomplete suggestions** in the browser (the server-side Places *search* and
  *geocode* paths are now well exercised by A2/A5).
- Ticketmaster events and EIA gas prices.
- **Live maps locally** — but for a different reason than before: the key works, `localhost:8080`
  simply isn't on its referrer allowlist, so the map shows its "key was rejected" fallback. Maps do
  render in production.

Production has these keys, so the quickest check is the live site.

---

## 7. Backlog

**Known broken upstream**
- **TravelPayouts hotel API is discontinued** (every endpoint 404s, confirmed with a valid token).
  The panel correctly reports unavailable. A replacement live hotel source is the top item.

**Requested but not built**
- ~~**Realtime sync for shared trips (Phase 2)**~~ — **shipped in v0.5.0 (B1–B3)**: live sync,
  attributed change notifications, and the activity feed. Migration
  `20260817000000_realtime_and_activity_feed.sql` applied 2026-08-17; see §3 for the two-channel
  design and the three silent-failure guards.
- **Presence indicator (B4 / Phase 3)** — "who's viewing this trip," via `realtime.presence` on the
  channel `useTripRealtime` already opens. **Not attempted** in v0.5.0; B1–B3 was the scoped
  deliverable. The plumbing it needs now exists, so this is a small addition rather than a new
  system.
- **Owner vs. shared badge** in `trips.index.tsx` — `listTrips` now also returns trips the user
  collaborates on (as of v0.4.0's RLS rewrite), but the list doesn't select `user_id` so there's
  no visual distinction yet.
- Smart paste for Airbnb/VRBO/Amtrak links → auto-fill the Lodging/Transport forms. Activities
  got its own paste-a-link fetch in v0.4.0; the shared abstraction wasn't built preemptively —
  extending it to Lodging/Transport is the natural next step now that it's tested once.
- No live rail API. Train estimates are a labelled heuristic: road miles ÷ 50 mph + 1h.

**Worth considering**
- ~~`updateTripItem` once per row on a drag reorder~~ — **done in v0.5.0**: `updateTripItems` applies
  a whole batch in one request, and `reorderMut` uses it. That also made one drag log one activity
  entry instead of N.
- Migrate all server fns off the deprecated `.inputValidator()` in one pass.
- The Lodging map, Trip Details map and the new itinerary day map each mount their own
  `APIProvider`. Harmless, but a shared provider higher in the tree would be cleaner — now three
  call sites rather than two.
- **Proxy-cache the Places photos.** `/api/places/photo` sets a 24h immutable `Cache-Control`, so
  browsers and the CDN cache it, but every cold miss still costs a Places photo request. If imagery
  volume grows, cache the bytes rather than only the response.

**Housekeeping**
- **`npm audit` reports 4 transitive advisories** (2026-08-16): `brace-expansion`, `js-yaml`,
  `nanoid` (high) and `postcss` (moderate). All are DoS or build-tooling issues, none is a direct
  dependency, and every one reports `fixAvailable: true` — so plain `npm audit fix` should clear
  them without a forced major bump. Left alone deliberately rather than folded into an unrelated
  change. Re-run all three static gates afterwards: these sit under Vite/ESLint, so a bad bump
  surfaces as a build failure, not a test failure.
- ⚠️ **Four `claude-*` verification users from the v0.9.0 and v0.10.0 passes are still in Supabase
  auth** (2026-08-19). Every trip and `trip_items` row they owned was deleted via the owner's own
  JWT and confirmed gone (`trips` and `trip_items` both return `[]`), so **no orphan data
  remains** — only the auth rows. They can't be removed here because `SUPABASE_SERVICE_ROLE_KEY`
  isn't available on this machine (no `.env`; only the two *public* Supabase values are
  recoverable from the deployed bundle). They are
  `claude-v090-verify-1787117562267@example.com`,
  `claude-v090-verify-1787120412192@example.com`,
  `claude-v090-verify-1787121183193@example.com`, and one earlier
  `claude-v090-verify-*@example.com` whose email wasn't captured before a failed first seed killed
  the script. Delete all four via `auth/v1/admin/users` with the service-role key, the same way
  the previous 10 were cleared.

  **Why this keeps growing, and how to stop it.** The seeder writes credentials to
  `scratchpad/creds.json` immediately after signup (not doing so is what lost the first email),
  and reuses that account when the file exists. But **deleting `creds.json` during cleanup forces
  the next run to sign up a fresh user** — that alone produced two of the four. `creds.json` holds
  only a throwaway account's password, so leave it in place between passes; it lives in a
  session-scoped temp directory and disappears on its own. The durable fix is the service-role
  key, which would let cleanup delete the account outright.
- ~~Leftover `claude-*` verification users in Supabase auth.~~ **Done 2026-08-17** — all 10
  (3 from v0.4.0, 7 from v0.5.0) deleted via `auth/v1/admin/users` with the service-role key, which
  is now in `.env`. Zero `claude-*` accounts remain. Future test users can be scripted away the
  same way rather than accumulating.
- **`src/integrations/supabase/types.ts` now carries THREE hand-added tables** —
  `trip_collaborators`, `trip_invites` (v0.4.0) and `trip_activity` (v0.5.0) — each marked inline.
  The file header says "do not edit directly". Worth one `supabase gen types typescript` pass to
  retire all three at once. ⚠️ `supabase/config.toml` pins a **dead** project ref
  (`mocvqmruxvpwgnxiszmc`, no DNS) while the app uses `cxonflruhbypxfonjtes`, so fix that first or
  the CLI will appear broken for unrelated reasons.
- **`http://localhost:8080` is not on the Maps browser key's referrer allowlist**, so the itinerary
  day map falls back to "Map key was rejected" in local dev while working in production. One line
  in the Cloud Console fixes it.

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

## 9. What broke during v0.5.0, and why (2026-08-16 → 17)

Every one of these passed the static gates and looked fine; each was caught only by an assertion
against real state. Recorded so the *class* of mistake is recognisable, not just the instance.

1. **The AI planner's `sort_order` collided with rows already on the day.** `buildItinerary` is only
   given *staged* activities, so it numbers from 0 — landing on top of the booked stay at day 0 #0.
   Invisible on a first build (nothing is there yet); surfaced only by adding activities to an
   *already-built* itinerary. **Lesson: test the second run, not just the first.**
   → `renumberDay()`, now shared by every path that places rows on a day.

2. **The itinerary chat repeated it for newly-added rows.** They are created *after* the items
   snapshot, so they were absent from the renumbering set and kept a placeholder position. Same bug,
   new entry point — which is why the fix became a shared helper rather than a local patch.

3. **`swap_days` initially moved only activities**, stranding the booked stay on the wrong day.
   Day-level operations must move *every* kind, not just the one you were thinking about.

4. **The drag advisor read pre-drag state.** It ran off the React Query cache, which still held the
   old arrangement, so the moved item was not yet on its target day and every heuristic returned
   nothing. The feature looked fully wired up and did nothing at all. → project the `moves` array
   over current items instead of waiting for a refetch.

5. **Drops onto day tabs landed one day off.** `closestCorners` compares the *dragged row's*
   rectangle, and a full-width itinerary row overlaps the neighbouring tab even with the pointer
   dead-centre. → `pointerWithin` first, `closestCorners` only as fallback. Reproducible, not flake.

6. **Two droppables shared one id.** The selected day renders both a tab and a column, both
   registered as `day-N`; dnd-kit's registry broke and tab drops silently did nothing.
   → `daytab-` namespace.

7. **`eslint` was already failing on `main`** — 188 prettier errors in `activities-panel.tsx` from a
   v0.4.0 commit that skipped `prettier --write`. The repo's own documented pre-commit gate did not
   pass before this release.

8. **A fresh Windows clone produced ~12,400 phantom eslint errors** (`Delete ␍`), because Git for
   Windows defaults `core.autocrlf=true` and the repo had no `.gitattributes`. Reads as catastrophic
   breakage; the code was fine. → LF pinned in `.gitattributes`.

9. **The first Part B migration would have failed four more times** after the reported
   `owner_id` error — missing GRANTs, a missing `ON DELETE`, an unpinned `actor_id`, and a
   hand-rolled membership UNION. Fixed in one pass rather than one round each; see §3.

**And three test bugs that masqueraded as product bugs**, worth equal attention because each nearly
produced a false report: a URL-prefill assertion against a page that serves no `og:description`; a
"0 advisor calls" pass that was counting nothing, because the server-fn id is base64url-encoded; and
a toast assertion that sampled after the toast had auto-dismissed. Techniques in §5.

---

## 10. Working agreements

- **Don't commit or push unless asked.** Verify first — the user has been explicit about
  testing before any commit.
- **Branch for every change; ask before `main`.** Pushing to `main` triggers a production deploy
  **and** syncs to Lovable, so it is a release, not a save point. Feature branches get their own
  Vercel preview.
- Log every user-facing change in `CHANGELOG.md` using the existing format: an Overview, then
  entries with both a `_Technical:_` and a `_For everyone:_` line.
- When a spec's premise doesn't match the code, say so and build to the underlying intent rather
  than silently following or silently ignoring it. v0.5.0 hit this three times — "popular times"
  don't exist in any Places API tier, IP-restricting a key is impossible on Vercel's dynamic egress,
  and `trip_items` payloads can't attribute a change. Each was reported and built around rather than
  faked.

### Evidence standards that have earned their keep

- **Verify against real state, not the UI's appearance.** Assert on the database, on decoded network
  requests, on counted events. "It looked right" has hidden a real bug here more than once.
- **A green status is not a result.** `SUBSCRIBED` is reported for tables that deliver nothing;
  "the SQL ran without error" says nothing about RLS behaviour; "no note appeared" doesn't mean no
  call was made. Confirm with an actual write, an actual read, an actual count.
- **Include a control assertion when proving an absence.** The photo-proxy leak check also asserts
  the *browser* key IS findable — otherwise "0 leaks" could just mean the search was broken.
- **Two accounts means two browser contexts.** Anything about per-user behaviour is unprovable with
  one session in two tabs.
- **Suspect the test first when something "fails".** Of the failures in v0.5.0, roughly a third were
  bad assertions rather than bad code — see §9.

### Merging a stack of PRs

Merging one PR does **not** retarget the next one to `main`; it keeps pointing at a now-merged
branch, and merging it there ships nothing. Retarget each PR (`gh pr edit N --base main`) before
merging it, and re-check `mergeable` after every merge. Expect a `context.md` conflict when two
branches both documented the same area — it is usually two versions of the same paragraph, and the
newer one wins.
