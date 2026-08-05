# Wayfinder — Working Context

> **Read this file at the start of every session before making changes.**
> It carries decisions, gotchas, and open work that are **not** derivable from the
> code or git history. Keep it current: when you make a non-obvious decision,
> hit a trap worth remembering, or close/open a backlog item, update this file in
> the same commit.

Last updated: **2026-08-05** (after v0.3.0)

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

**⚠️ Folder nesting.** The GitHub repo root == the `wayfinder-travel-planner-main/` folder.
If you downloaded a ZIP you may be one level up; `package.json` marks the real root.

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

Supabase project: `cxonflruhbypxfonjtes` → `https://cxonflruhbypxfonjtes.supabase.co`.
Get keys from the Supabase dashboard (Project Settings → API Keys) or Lovable Cloud.
The publishable key is public by design (it ships in the browser bundle); **`service_role`
is not — never put it in a file, a chat, or this repo.**

> Tip: `VITE_SUPABASE_URL` and the publishable key can always be recovered from the deployed
> production JS bundle if you lose them. The server-only keys cannot.

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

---

## 4. What shipped recently

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

---

## 6. Known gaps — verified vs not

**Verified against live Supabase + real browser (25/25 checks, v0.3.0):** booking exclusivity,
budget excluding candidates, blank-slate activities, drag persistence across reload, dashboard
cards deriving from real trip state, travel estimate matching hand-checked OSRM output.

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
- Smart paste for Airbnb/VRBO/Amtrak links → auto-fill the lodging form (the spec's "pasted-link
  fetch once built" — the comparison table is already built to receive it).
- No live rail API. Train estimates are a labelled heuristic: road miles ÷ 50 mph + 1h.

**Worth considering**
- `updateTripItem` is called once per row on a drag reorder (N requests). Fine at current sizes;
  a batch endpoint would be better if itineraries get long.
- Migrate all server fns off the deprecated `.inputValidator()` in one pass.
- The Lodging map and Trip Details map both mount their own `APIProvider`. Harmless, but a shared
  provider higher in the tree would be cleaner.

**Housekeeping**
- Test user `claude-manual-entry-verify@example.com` still exists in Supabase auth. Deleting a
  user needs the `service_role` key — remove it from the dashboard (Authentication → Users).
  All of its trip data has been cleaned up.

---

## 8. Working agreements

- **Don't commit or push unless asked.** Verify first — the user has been explicit about
  testing before any commit.
- Pushing to `main` triggers a production deploy **and** syncs to Lovable. Confirm before pushing
  unless already told to.
- Log every user-facing change in `CHANGELOG.md` using the existing format: an Overview, then
  entries with both a `_Technical:_` and a `_For everyone:_` line.
- When a spec's premise doesn't match the code, say so and build to the underlying intent rather
  than silently following or silently ignoring it.
