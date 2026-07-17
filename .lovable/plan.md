## Fix

Move the `recMut = useMutation(...)` call in `src/routes/_authenticated/trips.$tripId.tsx` **above** the `isLoading` / `notFound()` early returns, so every hook runs on every render regardless of load state.

Since `recMut`'s `mutationFn` closes over `destination`, `trip.start_date`, `trip.end_date`, `trip.budget_cents`, `totalCents`, and `items` — values that don't exist before data loads — restructure like this:

1. Keep all hooks at the top: `useParams`, `useQueryClient`, all five `useServerFn` calls, `useState`, the `useQuery`, and **all** `useMutation` calls (`updateMut`, `addMut`, `removeMut`, `recMut`).
2. For `recMut`, pass the derived values as arguments to `mutate` rather than closing over them: `mutationFn: (vars: {...}) => recFn({ data: vars })`.
3. Compute `destination`, `totalCents`, `items`, etc. *after* the early returns as today.
4. Update the `onRefreshTips` call on `<BudgetRail />` to pass the current values: `onRefreshTips={() => recMut.mutate({ destination, start_date: trip.start_date, end_date: trip.end_date, budget_cents: trip.budget_cents, total_cents: totalCents, itemsSummary: ... })}`.
5. Leave the rest of the file (JSX, other mutations, tabs) unchanged.

No other files need changing. This unblocks the workspace so the tabs (Destination / Lodging / Transport / Activities / Itinerary) actually render.
