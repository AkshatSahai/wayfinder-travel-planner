# Feature Tracking

Living doc. Update this whenever we decide to hold a feature, scope something out, scope it
back in later, or ship something that needs real manual testing. Unlike `CHANGELOG.md` (what
shipped) and `context.md` (architecture/decision log), this file exists so nothing falls through
the cracks between "built" and "verified," or between "discussed" and "actually scheduled."

## Needs manual testing
(Built, but can't be verified without a real account, real API keys, or real usage — needs a
human run-through.)

- [ ] **Flight travel estimates (Duffel)** — confirm live flight search/pricing returns sane
      results end-to-end. Untested locally (no local Duffel key). Added 2026-08-17.
- [ ] **Places autocomplete suggestions in-browser** — confirm destination/activity search
      suggestions behave correctly while typing. Untested locally. Added 2026-08-17.
- [ ] **Ticketmaster events** — confirm event search/results in the Activities browse dialog.
      Untested locally. Added 2026-08-17.
- [ ] **Live gas prices (EIA)** — confirm drive-cost estimates reflect real current prices.
      Untested locally. Added 2026-08-17.
- [ ] **Live maps in local dev** — maps are reported to only work in production; confirm
      whether this is still true and why. Added 2026-08-17.
- [ ] **Day start time field** (itinerary timing fix) — confirm setting a day's start time
      correctly feeds drive-time/route guidance without writing a timestamp onto any activity.
      Added 2026-08-17.
- [ ] **Per-item pinned arrival time + conflict check** (itinerary timing fix) — confirm pinning
      a specific activity's time flags a realistic conflict (not enough travel time from the
      prior stop) and doesn't false-positive on reasonable schedules. Added 2026-08-17.
- [ ] **Quieter advisor banner** (itinerary timing fix) — confirm the restyled A4 advisor note
      still surfaces after a drag-reorder, reads correctly, and no longer references a stale or
      mismatched time. Added 2026-08-17.
- [ ] **Chat drawer layout** (itinerary timing fix) — confirm the collapsible chat drawer opens/
      closes cleanly and the day tabs/list/map layout is unaffected when it's closed. Added
      2026-08-17.

## Scoped, not yet built
(Decided to build, not started or paused.)

- [ ] **Presence indicator** — show who else is currently viewing a shared trip. Realtime
      plumbing already exists (`use-trip-realtime`); the indicator itself isn't built. Added
      2026-08-17.
- [ ] **Hotel data source replacement** — TravelPayouts (the original hotel search provider) is
      discontinued/dead (all endpoints 404). Manual "Add your stay" is the current workaround;
      need a real hotel search API. Top backlog item. Added 2026-08-17.
- [ ] **Owner vs. shared trip badge** — the trips list doesn't yet distinguish trips you own from
      trips shared with you, even though shared trips are already returned. Added 2026-08-17.
- [ ] **Smart paste for Lodging/Transport links** — paste-a-link metadata fetch (Airbnb, VRBO,
      Amtrak, etc.) currently only works in Activities; not extended to Lodging or Transport.
      Added 2026-08-17.

## Out of scope / deferred
(Explicitly decided not to build now, or ever.)

- None yet — items land here once we actively decide to hold or drop them, rather than by
  default.
