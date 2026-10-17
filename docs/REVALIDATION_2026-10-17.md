# Dashboard Revalidation — 2026-10-17

## Scope

This pass corrects dashboard alignment, responsive editing, and local save ordering. The visual dashboard authoring controls and the existing Dashboard-service adapter remain in place.

## Layout and rendering changes

- `DashboardDocument.layout` remains the canonical 12-column desktop arrangement. Optional `responsiveLayouts.md` and `responsiveLayouts.sm` store deliberate edits for the 8-column and single-column views. Existing documents without these fields continue to render from their desktop layout.
- Breakpoints use the measured canvas width: `lg` applies above 1,100 px, `md` above 760 px through 1,100 px, and `sm` at 760 px or below. A stable wrapper is observed with `ResizeObserver`, including the initial measurement, window changes, and sidebar collapse. Zero-width observations cannot replace a valid measurement.
- Mounting and responsive reflow only derive display layouts. They do not write the document or create Undo history. Completed pointer drags/resizes and keyboard move/resize actions persist to the active breakpoint.
- Collision handling preserves intentional row spacing instead of pulling later tiles into earlier gaps. Widths and positions are constrained to the active grid, including minimum widths in the single-column view.
- The legacy CSS Grid and relative-position rules no longer compete with the widget layout engine. Editor fields align across label/hint differences; widget controls and chart headers wrap within their tiles; charts resize with their tiles and compact content can scroll without covering its header.
- Chart cache identity follows the query and widget source rather than the document revision, so moving a widget does not by itself rerun its query.

Previously overwritten coordinates require an existing exported backup or manual rearrangement; this update does not reconstruct missing layout history.

## Local persistence changes

Local autosave keeps its 900 ms debounce and serializes writes. Preview and the Dashboards button flush and await pending work before navigating; unmount also flushes pending work. Undo replaces a pending edit and queues its restored document after any older in-flight write.

Only completion of the latest edit can show **Saved locally**. Failed local writes remain available for retry and prevent the editor's navigation buttons from leaving prematurely. Remote publication has a separate loading state, cannot overwrite edits made during its request, and does not change a successful local save into a local failure when the remote service fails.

The core self-test and static audit now accept either consistent quotation style for the read-only startup invariant. The invariant itself is unchanged.

## Executed validation

| Check | Result |
|---|---|
| `npm run ci:verify` | Passed release-workflow validation, release fixtures, lint, core invariants, unit tests, static audit, TypeScript, and Electron bundle verification |
| Unit and mock contract tests | 78 passed; 2 live contract tests skipped |
| Native Electron E2E | 4 passed, including the existing boot and Axe accessibility smoke test |
| Synthetic-demo visual review | Checked widths 1,500 → 1,100 → 1,920 → 820 → 1,500 px, including row alignment and content fit |

The focused unit tests cover breakpoint projection and persistence, active-grid constraints, no-op reflows, stable width observation, save ordering, Undo, navigation flushing, and publication races.

The native dashboard tests cover:

- unchanged stored documents and disabled Undo through window resizing and sidebar collapse;
- aligned metric rows and editor inputs, bounded tiles, and absence of tile overlap;
- keyboard movement followed by immediate Preview, editor return, and persisted Undo;
- real pointer resizing after first opening at medium width, retained medium-layout overrides, and unchanged desktop positions on return to a larger window.

Each Electron test uses a disposable profile. The test launcher supplies `--no-sandbox` only in a root-owned development container; ordinary CI launches retain the sandbox.

## Verification limits

All dashboard UI validation used the built-in synthetic demo. No live Keen credentials were supplied or used. The two live contract tests were skipped, so this pass makes no new assertion about current Analytics or Dashboard-service behavior. Native installer packaging, signing, and publication are handled by the existing release workflow after the source update is pushed.
