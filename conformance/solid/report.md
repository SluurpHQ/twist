# Solid's tests on Twist

3671 pass, 1142 fail, 703 files (176 did not load, 238 test Solid's internals)

## Why files did not load

- 59 × Cannot find module '@solidjs/web/server-functions/server'
- 26 × SyntaxError: Export named 'renderToStream' not found
- 23 × SyntaxError: Export named 'hydrate' not found
- 14 × SyntaxError: Export named 'renderToString' not found
- 13 × SyntaxError: Export named 'isStatic' not found
- 6 × SyntaxError: Export named 'Dynamic' not found
- 3 × SyntaxError: Export named 'useHead' not found
- 2 × SyntaxError: Export named 'createRevealOrder' not found
- 2 × SyntaxError: Export named 'NoHydration' not found
- 2 × SyntaxError: Export named 'getHydrationWriter' not found
- 2 × SyntaxError: Export named 'createRequestEvent' not found
- 2 × Cannot find module '../../src/server.js'
- 1 × SyntaxError: Export named '_resetExternalSourceConfig' not found
- 1 × SyntaxError: Export named 'enforceLoadingBoundary' not found
- 1 × Cannot find module '../src/map.js'
- 1 × SyntaxError: Export named '$REFRESH' not found
- 1 × SyntaxError: Export named 'hasStaticKeys' not found
- 1 × SyntaxError: Export named '$DEVCOMP' not found
- 1 × Cannot find module '../src/refresh/index.js'
- 1 × SyntaxError: Export named 'effect' not found
- 1 × SyntaxError: Export named 'clientOnly' not found
- 1 × Cannot find module '@solidjs/web'
- 1 × SyntaxError: Export named 'addEvent' not found
- 1 × Cannot find module 'solid-js/internal/container-trace'
- 1 × Cannot find module '../src/server-mock.js'
- 1 × Cannot find module '@solidjs/diagnostics'
- 1 × Cannot find module '@solidjs/web/frames'
- 1 × SyntaxError: Export named 'httpHeader' not found
- 1 × SyntaxError: Export named 'HydrationScript' not found
- 1 × SyntaxError: Export named 'Reveal' not found
- 1 × Cannot find module '@solidjs/web/serialization'
- 1 × SyntaxError: Export named 'readShallow' not found
- 1 × SyntaxError: Export named 'getTraceContext' not found
- 1 × Cannot find module '../src/render.js'

## Files

| file | pass | fail | note |
|---|---|---|---|
| signals/tests/a34-writes-then-derivations.test.ts | 2 | 6 |  |
| signals/tests/action-await-contract.test.ts | 4 | 0 |  |
| signals/tests/action-completion-race.test.ts | 0 | 1 |  |
| signals/tests/action-done-window.test.ts | 0 | 3 |  |
| signals/tests/action-loading-rail.test.ts | 4 | 1 |  |
| signals/tests/action-thenable-assimilation.test.ts | 1 | 3 |  |
| signals/tests/action.test.ts | 63 | 4 |  |
| signals/tests/adoption-unchanged-key-read-3706.test.ts | 0 | 0 |  |
| signals/tests/affects-audit-2893.test.ts | 7 | 1 |  |
| signals/tests/affects-propagation.test.ts | 5 | 4 |  |
| signals/tests/async-chain-supersession.test.ts | 5 | 3 |  |
| signals/tests/async-landing-deps-3461.test.ts | 0 | 2 |  |
| signals/tests/async-lane-landing-equals-order.test.ts | 1 | 0 |  |
| signals/tests/attribution-benchmark-eval.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-current-origin.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-effect-cycle.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-engine-cost.test.ts | 0 | 0 |  |
| signals/tests/attribution-fan-out.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-feedback-findings.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-feedback.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-graph-growth.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-holds.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-immutable-update.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-interactions.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-lean-gate.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/attribution.js' |
| signals/tests/attribution-list-identity.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-navigation.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-optimistic-revert.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-provenance.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-relay-tear.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-timeline.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-unstable-memo.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-values.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-wasted-recompute.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-waterfall-eval.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution-wide-scope.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/attribution.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/autodispose-contract.test.ts | 2 | 2 |  |
| signals/tests/autodispose-pending-release.test.ts | 4 | 2 |  |
| signals/tests/body-end-supersession-visibility.test.ts | 0 | 1 |  |
| signals/tests/born-held.test.ts | 2 | 2 |  |
| signals/tests/boundary-not-born-held-3540.test.ts | 4 | 8 |  |
| signals/tests/boundary-output-frame-reader.test.ts | 4 | 0 |  |
| signals/tests/client-error-hook.test.ts | 2 | 5 |  |
| signals/tests/compute-write-joins-transition.test.ts | 1 | 1 |  |
| signals/tests/contested-effect.test.ts | 1 | 2 |  |
| signals/tests/context.test.ts | 3 | 3 |  |
| signals/tests/createEffect.test.ts | 24 | 0 |  |
| signals/tests/createErrorBoundary.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'clearSnapshots' not found |
| signals/tests/createLoadingBoundary.on.test.ts | 2 | 5 |  |
| signals/tests/createLoadingBoundary.test.ts | 15 | 11 |  |
| signals/tests/createMemo.test.ts | 40 | 40 |  |
| signals/tests/createOptimistic.test.ts | 35 | 33 |  |
| signals/tests/createProjection.draft-lifetime-3585.test.ts | 9 | 8 |  |
| signals/tests/createReaction.test.ts | 2 | 3 |  |
| signals/tests/createRevealOrder.test.ts | 0 | 1 | SyntaxError: Export named 'createRevealOrder' not found |
| signals/tests/createRoot.test.ts | 20 | 2 |  |
| signals/tests/createSignal.test.ts | 10 | 0 |  |
| signals/tests/createTrackedEffect.test.ts | 16 | 3 |  |
| signals/tests/derived-write-then-derivation-3733.test.ts | 17 | 20 |  |
| signals/tests/dev.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/diagnostics.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/dev.js' |
| signals/tests/direct-commit-readers-posture.test.ts | 0 | 3 |  |
| signals/tests/direction-rule-probe.test.ts | 0 | 1 |  |
| signals/tests/disposed-read-lifecycle.test.ts | 5 | 0 |  |
| signals/tests/dist-artifacts.test.ts | 1 | 21 |  |
| signals/tests/dormant-memo-chain-3554.test.ts | 2 | 4 |  |
| signals/tests/effect-error-phases.test.ts | 5 | 6 |  |
| signals/tests/effect-mainline-ownership-3412.test.ts | 4 | 0 |  |
| signals/tests/effect-phase-writes.test.ts | 8 | 2 |  |
| signals/tests/enableExternalSource.test.ts | 0 | 1 | SyntaxError: Export named '_resetExternalSourceConfig' not found |
| signals/tests/enforceLoadingBoundary.test.ts | 0 | 1 | SyntaxError: Export named 'enforceLoadingBoundary' not found |
| signals/tests/equals-comparator-errors.test.ts | 1 | 5 |  |
| signals/tests/error-silent-recovery.test.ts | 0 | 7 |  |
| signals/tests/errorHalt.test.ts | 2 | 7 |  |
| signals/tests/falsy-error-identity.test.ts | 4 | 16 |  |
| signals/tests/finalize-reentry.test.ts | 0 | 4 |  |
| signals/tests/first-observer-stale-reader.test.ts | 1 | 0 |  |
| signals/tests/flatten-async-iterable.test.ts | 4 | 7 |  |
| signals/tests/flatten-needs-unwrap.test.ts | 1 | 2 |  |
| signals/tests/flush-in-action.test.ts | 3 | 3 |  |
| signals/tests/flush.test.ts | 6 | 0 |  |
| signals/tests/fuzz-findings-l2.test.ts | 7 | 1 |  |
| signals/tests/gc.test.ts | 1 | 0 |  |
| signals/tests/getOwner.test.ts | 2 | 0 |  |
| signals/tests/graph-size-diagnostics.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/dev.js' |
| signals/tests/graph.test.ts | 21 | 0 |  |
| signals/tests/heap-mark-incremental.test.ts | 1 | 1 |  |
| signals/tests/held-conditional-effect.test.ts | 0 | 1 |  |
| signals/tests/held-conditional-memo.test.ts | 1 | 1 |  |
| signals/tests/held-derivation-not-a-proposal-3612.test.ts | 8 | 11 |  |
| signals/tests/held-effect-restage-run-3802.test.ts | 1 | 1 |  |
| signals/tests/held-frame-dependencies.test.ts | 0 | 2 |  |
| signals/tests/held-restore.test.ts | 3 | 1 |  |
| signals/tests/held-truth-lane-only.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/constants.js' |
| signals/tests/inv4-projection-dispose-shadow.test.ts | 1 | 0 |  |
| signals/tests/ispending-combined-atomic-3442.test.ts | 0 | 3 |  |
| signals/tests/isPending-held-sync-memo.test.ts | 1 | 0 |  |
| signals/tests/ispending-in-boundary-on-3528.test.ts | 1 | 5 |  |
| signals/tests/isPending-memo-consistency.test.ts | 2 | 3 |  |
| signals/tests/ispending-memo-gate-3766.test.ts | 6 | 0 |  |
| signals/tests/ispending-memo-unstamped-hold-3457.test.ts | 1 | 0 |  |
| signals/tests/issue-3800-repro.test.ts | 7 | 1 |  |
| signals/tests/iterator-supersede-close.test.ts | 0 | 2 |  |
| signals/tests/l2-contract.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/l2-fuzz-existing-rules.test.ts | 0 | 5 |  |
| signals/tests/lane-ambient-write-replay.test.ts | 3 | 0 |  |
| signals/tests/lane-contract.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/lane-frame-deferred-run-3662.test.ts | 0 | 3 |  |
| signals/tests/lane-frame-held-lane-3662.test.ts | 1 | 4 |  |
| signals/tests/lane-hold-on-observation.test.ts | 4 | 5 |  |
| signals/tests/lane-outside-view.test.ts | 1 | 7 |  |
| signals/tests/lane-pass-stamped-effect-3662.test.ts | 0 | 1 |  |
| signals/tests/lane-uninitialized-landing-3648.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/late-pending-equality.test.ts | 4 | 4 |  |
| signals/tests/latest-async.test.ts | 1 | 0 |  |
| signals/tests/latest-created-inside-window.test.ts | 2 | 0 |  |
| signals/tests/latest-held-till-flush.test.ts | 14 | 8 |  |
| signals/tests/latest-isPending-consistency.test.ts | 5 | 3 |  |
| signals/tests/latest-lazy-companion-backfill.test.ts | 2 | 0 |  |
| signals/tests/latest-pending-probe-mid-flight.test.ts | 1 | 0 |  |
| signals/tests/latest-plain-write-purity.test.ts | 4 | 0 |  |
| signals/tests/latest-probe-order-independence.test.ts | 1 | 1 |  |
| signals/tests/latest-repeated-writes.test.ts | 4 | 0 |  |
| signals/tests/latest-shadow-owned-write.test.ts | 2 | 0 |  |
| signals/tests/latest-unobserved-memo.test.ts | 3 | 0 |  |
| signals/tests/loading-fallback-in-flush-3540.test.ts | 8 | 1 |  |
| signals/tests/loading-fallback-release-3540.test.ts | 0 | 2 |  |
| signals/tests/loading-on-frame-following-3540.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/loading-on-rearm-3540.test.ts | 2 | 5 |  |
| signals/tests/loading-on-rearm-reveal-3540.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/loading-reset-collects-forwarded-3459.test.ts | 0 | 1 |  |
| signals/tests/loading-value.test.ts | 22 | 14 |  |
| signals/tests/mapArray-notready-safety.test.ts | 3 | 9 |  |
| signals/tests/mapArray-smallmove.test.ts | 0 | 1 | Cannot find module '../src/map.js' |
| signals/tests/maparray-store-nonkeyed.test.ts | 2 | 0 |  |
| signals/tests/mapArray.test.ts | 7 | 0 |  |
| signals/tests/mount-over-foreign-hold-3761.test.ts | 4 | 1 |  |
| signals/tests/nested-render-effect-async-cleanup.test.ts | 0 | 5 |  |
| signals/tests/observe-exclude.test.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| signals/tests/observe-idle-cost.test.ts | 0 | 0 |  |
| signals/tests/observe-records.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/oncleanup-reentrant-dispose-3601.test.ts | 5 | 0 |  |
| signals/tests/onCleanup.test.ts | 5 | 0 |  |
| signals/tests/onSettled.test.ts | 13 | 0 |  |
| signals/tests/optimistic-lane-release.test.ts | 1 | 3 |  |
| signals/tests/optimistic-lane-transaction-ownership.test.ts | 0 | 2 |  |
| signals/tests/optimistic-mount-binding-3835.test.ts | 0 | 2 |  |
| signals/tests/optimistic-mount-nested-memo-3835.test.ts | 0 | 4 |  |
| signals/tests/optimistic-move-duplicate-3548.test.ts | 0 | 1 |  |
| signals/tests/optimistic-move-keyed-show-3662.test.ts | 2 | 0 |  |
| signals/tests/optimistic-outside-refetch-619.test.ts | 0 | 5 |  |
| signals/tests/optimistic-over-held-row-3796.test.ts | 2 | 0 |  |
| signals/tests/optimistic-read-lane-not-transaction-3698.test.ts | 3 | 3 |  |
| signals/tests/optimistic-refetch-longer-3568.test.ts | 4 | 0 |  |
| signals/tests/optimistic-settle-verdicts.test.ts | 1 | 2 |  |
| signals/tests/optimistic-signal-refetch-hold.test.ts | 1 | 1 |  |
| signals/tests/optimistic-store-layer-scope.test.ts | 4 | 1 |  |
| signals/tests/optimistic-store-refetch-hold.test.ts | 2 | 3 |  |
| signals/tests/optimistic-undefined-override.test.ts | 6 | 0 |  |
| signals/tests/overlapping-flights.test.ts | 2 | 1 |  |
| signals/tests/owned-scope-write-guard.test.ts | 14 | 0 |  |
| signals/tests/pending-companion-lane-parent.test.ts | 0 | 1 |  |
| signals/tests/pending-gated-landing-replay.test.ts | 1 | 0 |  |
| signals/tests/pending-source-repark.test.ts | 1 | 1 |  |
| signals/tests/posture-born-held-and-observation.test.ts | 1 | 4 |  |
| signals/tests/posture-store-parity.test.ts | 0 | 1 | not ours: Cannot find module '../src/store/store.js' |
| signals/tests/propagation-isolation.test.ts | 2 | 0 |  |
| signals/tests/question-scoped-pending.test.ts | 16 | 22 |  |
| signals/tests/recompute-missed-wake.test.ts | 2 | 0 |  |
| signals/tests/recompute-preserves-disposed-3621.test.ts | 0 | 1 | SyntaxError: Export named '$REFRESH' not found |
| signals/tests/refresh-await.test.ts | 2 | 10 |  |
| signals/tests/repeat.test.ts | 11 | 0 |  |
| signals/tests/resolve-in-action.test.ts | 3 | 2 |  |
| signals/tests/resolve.test.ts | 3 | 1 |  |
| signals/tests/reveal-carve-out.test.ts | 1 | 3 |  |
| signals/tests/reveal-gating-contract.test.ts | 2 | 0 |  |
| signals/tests/root-dispose-pending-action-3561.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/router-transition-error-commit.test.ts | 0 | 1 |  |
| signals/tests/rules-index.test.ts | 0 | 3 |  |
| signals/tests/runWithOwner.test.ts | 3 | 0 |  |
| signals/tests/scheduler-livelock.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/constants.js' |
| signals/tests/settle-folds-queued-writes.test.ts | 0 | 2 |  |
| signals/tests/settle-walk-invariant.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/async.js' |
| signals/tests/shallow-store-proxy-children.test.ts | 0 | 1 | not ours: Cannot find module '../src/store/store.js' |
| signals/tests/shared-effect-no-entangle.test.ts | 4 | 0 |  |
| signals/tests/snapshot-derived-store-rows.test.ts | 4 | 1 |  |
| signals/tests/snapshot.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'clearSnapshots' not found |
| signals/tests/spec-async-semantics.test.ts | 15 | 37 |  |
| signals/tests/stale-read-uninitialized-cross-transition.test.ts | 1 | 1 |  |
| signals/tests/store-unchanged-read-independent-write-3688.test.ts | 2 | 2 |  |
| signals/tests/store/adoption-lane-rollback.test.ts | 0 | 2 |  |
| signals/tests/store/async-setter.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/store/child-companion-walk.test.ts | 2 | 0 |  |
| signals/tests/store/createOptimisticStore.test.ts | 42 | 38 |  |
| signals/tests/store/createProjection.async.test.ts | 0 | 1 |  |
| signals/tests/store/createProjection.jsdom.test.ts | 1 | 0 |  |
| signals/tests/store/createProjection.test.ts | 7 | 13 |  |
| signals/tests/store/createStore.test.ts | 51 | 14 |  |
| signals/tests/store/deep-chained-view.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/store.js' |
| signals/tests/store/deep-held-visibility.test.ts | 0 | 1 |  |
| signals/tests/store/deep-overlay-rewalk.test.ts | 3 | 0 |  |
| signals/tests/store/derived-optimistic-retained-row-3859.test.ts | 0 | 2 |  |
| signals/tests/store/derived-optimistic-shadow.test.ts | 4 | 0 |  |
| signals/tests/store/derived-presence-async-3726.test.ts | 3 | 5 |  |
| signals/tests/store/derived-retained-draft-row-3767.test.ts | 2 | 1 |  |
| signals/tests/store/enumerator-presence-nodes.test.ts | 2 | 16 |  |
| signals/tests/store/flight-owned-transaction.test.ts | 2 | 2 |  |
| signals/tests/store/fold-3164.test.ts | 0 | 2 |  |
| signals/tests/store/fold-privatization-order.test.ts | 10 | 0 |  |
| signals/tests/store/fold-scheduling.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/store.js' |
| signals/tests/store/fold-slot-identity.test.ts | 0 | 6 |  |
| signals/tests/store/kanban-a17-fixture.test.ts | 2 | 1 |  |
| signals/tests/store/lane-authority-twins.test.ts | 1 | 6 |  |
| signals/tests/store/latest-read-after-write-3576.test.ts | 0 | 1 |  |
| signals/tests/store/native-collections.test.ts | 8 | 2 |  |
| signals/tests/store/next-smoke.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/target.js' |
| signals/tests/store/optimistic-ambient-capture.test.ts | 0 | 1 |  |
| signals/tests/store/optimistic-chained-revert-3672-memo.test.ts | 1 | 5 |  |
| signals/tests/store/optimistic-chained-revert-3672.test.ts | 0 | 4 |  |
| signals/tests/store/optimistic-draft-visibility-3665.test.ts | 2 | 6 |  |
| signals/tests/store/optimistic-list-mutation-matrix.test.ts | 892 | 8 |  |
| signals/tests/store/optimistic-maparray-index-frame-f1.test.ts | 43 | 0 |  |
| signals/tests/store/optimistic-observer-invariance.test.ts | 0 | 2 |  |
| signals/tests/store/optimistic-removed-prop-3883.test.ts | 6 | 0 |  |
| signals/tests/store/optimistic-untracked-reads-f3-f5.test.ts | 9 | 2 |  |
| signals/tests/store/overlay-rebuild-3689.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/store.js' |
| signals/tests/store/overlay.test.ts | 7 | 4 |  |
| signals/tests/store/owner-stamp.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/target.js' |
| signals/tests/store/pr3017-function-leaves.test.ts | 4 | 0 |  |
| signals/tests/store/privatization-observer-identity.test.ts | 0 | 2 |  |
| signals/tests/store/projection-absent-key-tracking.test.ts | 4 | 0 |  |
| signals/tests/store/projection-root-overlay.test.ts | 3 | 3 |  |
| signals/tests/store/projection-slot-release.test.ts | 0 | 6 |  |
| signals/tests/store/projection-transition-isolation.test.ts | 1 | 3 |  |
| signals/tests/store/reconcile-captured-proxies.test.ts | 7 | 2 |  |
| signals/tests/store/reconcile-resend-identity.test.ts | 2 | 2 |  |
| signals/tests/store/reconcile.test.ts | 40 | 7 |  |
| signals/tests/store/recursive-effects.test.ts | 4 | 0 |  |
| signals/tests/store/retained-draft-row-3767.test.ts | 1 | 0 |  |
| signals/tests/store/shallow-loading.test.ts | 0 | 8 |  |
| signals/tests/store/shallow.test.ts | 0 | 1 | not ours: Cannot find module '../../src/store/store.js' |
| signals/tests/store/shared-child-multiparent.test.ts | 1 | 2 |  |
| signals/tests/store/sidecar-composition.test.ts | 1 | 0 |  |
| signals/tests/store/signal-store-twins-qd.test.ts | 0 | 4 |  |
| signals/tests/store/store-in-store-tracking.test.ts | 0 | 7 |  |
| signals/tests/store/storePath.test.ts | 0 | 29 | not ours: a Solid 1 compat helper |
| signals/tests/store/unchanged-presence-no-hold-3743.test.ts | 0 | 0 |  |
| signals/tests/store/utilities-no-proxy.test.ts | 0 | 1 | SyntaxError: Export named 'hasStaticKeys' not found |
| signals/tests/store/utilities.test.ts | 0 | 1 | not ours: SyntaxError: Export named '$RECORD' not found |
| signals/tests/store/woken-transaction-adopts-staged-bump.test.ts | 1 | 0 |  |
| signals/tests/store/write-floor.test.ts | 7 | 2 |  |
| signals/tests/strict-read-pending-store.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/error.js' |
| signals/tests/strict-read-snapshot-scope-3675.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/core.js' |
| signals/tests/strictRead.test.ts | 5 | 7 |  |
| signals/tests/superseded-before-first-commit.test.ts | 0 | 1 |  |
| signals/tests/superseded-flight-pending-source.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| signals/tests/superseded-source-blocks-3462.test.ts | 0 | 2 |  |
| signals/tests/syncThenable.test.ts | 15 | 12 |  |
| signals/tests/tick-scoped-pass-transaction.test.ts | 0 | 2 |  |
| signals/tests/transition-corpse-revival.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/constants.js' |
| signals/tests/transition-orphan-recompute.test.ts | 1 | 1 |  |
| signals/tests/transitionEntanglement.test.ts | 0 | 2 |  |
| signals/tests/transitionMerge.test.ts | 0 | 1 |  |
| signals/tests/treeshake.test.ts | 0 | 1 |  |
| signals/tests/uninitialized-visibility.test.ts | 1 | 6 |  |
| signals/tests/until-entanglement.test.ts | 1 | 5 |  |
| signals/tests/until.test.ts | 7 | 10 |  |
| signals/tests/untrack.test.ts | 3 | 0 |  |
| signals/tests/untracked-async-read.test.ts | 1 | 2 |  |
| signals/tests/untracked-read-after-await.test.ts | 0 | 1 | not ours: Cannot find module '../src/core/dev.js' |
| signals/tests/verdict-contract.test.ts | 0 | 5 |  |
| signals/tests/verdict-mount-first-pass-3851.test.ts | 0 | 3 |  |
| signals/tests/verdict-mount-loading-flush-loop.test.ts | 0 | 0 |  |
| signals/tests/visibility-oracle-posture.test.ts | 1184 | 0 |  |
| signals/tests/visibility-oracle-store.test.ts | 110 | 43 |  |
| signals/tests/visibility-oracle.test.ts | 88 | 38 |  |
| signals/tests/write-proposals-3494.test.ts | 9 | 3 |  |
| signals/tests/zombie-create-path-keeps-flag.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/zombie-recompute-keeps-flag.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| signals/tests/zombie-rerun-after-commit-3546.test.ts | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| solid/test/client-hydration.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/client-recovery-record.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/component.spec.ts | 0 | 1 | SyntaxError: Export named '$DEVCOMP' not found |
| solid/test/container-trace.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/container-trace.js' |
| solid/test/cross-package-fields.spec.ts | 0 | 0 |  |
| solid/test/dev.spec.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| solid/test/dist-client-artifact.spec.ts | 0 | 1 | not ours: Cannot find module '../dist/solid.js' |
| solid/test/hybrid-memo-handoff.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hybrid-store-handoff.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hydrate-window.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hydration-latch.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hydration-null-owner-3609.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hydration-root-snapshot-scope-3504.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/hydration-state-api.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/id-parity.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/core.js' |
| solid/test/internal-surface.spec.ts | 0 | 4 |  |
| solid/test/lazy-strict-read-3675.spec.ts | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| solid/test/multi-root-hydration.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/package-exports.spec.ts | 0 | 1 |  |
| solid/test/public-boundary-exports.spec.ts | 1 | 1 |  |
| solid/test/published-declarations.spec.ts | 0 | 1 |  |
| solid/test/refresh-hydration.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/refresh-prod.spec.ts | 0 | 1 | Cannot find module '../src/refresh/index.js' |
| solid/test/refresh.spec.ts | 0 | 1 | not ours: Cannot find module '../src/attribution.js' |
| solid/test/reveal.spec.ts | 0 | 1 | SyntaxError: Export named 'createRevealOrder' not found |
| solid/test/server/async-retry-child-reset.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/console-footer.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/dist-server-artifact.spec.ts | 0 | 1 | not ours: Cannot find module '../../dist/server.js' |
| solid/test/server/export-parity.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/flow.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/nohydration.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/observe-server.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/reveal-ssr.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/server-diagnostics.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/server-write-deprecation.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/shallow-projection.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/signals.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/ssr-async.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/ssr-scope-lazy-id.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/server/ssr-scope.spec.ts | 0 | 1 | not ours: Cannot find module '../../src/server/index.js' |
| solid/test/shallow-hydration.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client/hydration.js' |
| solid/test/signals.spec.ts | 35 | 1 |  |
| web/test/async-landing-deps-3461.spec.tsx | 0 | 2 |  |
| web/test/binding-names.spec.tsx | 0 | 1 | SyntaxError: Export named 'effect' not found |
| web/test/capturing-event-listener.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client.js' |
| web/test/class-binding.spec.tsx | 4 | 1 |  |
| web/test/class-object-undefined.spec.tsx | 1 | 0 |  |
| web/test/class.spec.tsx | 1 | 1 |  |
| web/test/client-error-hook.spec.tsx | 0 | 2 |  |
| web/test/client-only.spec.tsx | 0 | 1 | SyntaxError: Export named 'clientOnly' not found |
| web/test/client-records.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/conditional-jsx-held-branch-3438.spec.tsx | 0 | 2 |  |
| web/test/consistency/adopted-swap-post-done.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/boundary-arrival.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c01-claim-once.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c01-claim-window-roots.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c02-revealed-occurrence-mounts.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c03-hydration-done-counts-holds.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c04-record-applies-once.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c05-data-response-scoped.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c06-stale-wait-never-lands.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c07-store-is-truth.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-client.js' |
| web/test/consistency/c08-fanout-equal.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c09-no-phantom.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c10-ids-timing-independent.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c11-trace-equals-oracle.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c12-boundary-parity.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/c13-sweep-atomic.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c14-dispose-clean.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c15-staging-atomic.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c16-reference-identity.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c17-gate-bound-address.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/c19-claim-reads-snapshot.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-client.js' |
| web/test/consistency/generic/campaign.spec.tsx | 0 | 1 |  |
| web/test/consistency/generic/preload-hold.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/generic/replay.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/harness/campaign.spec.tsx | 0 | 1 |  |
| web/test/consistency/harness/replay.spec.tsx | 0 | 1 | not ours: Cannot find module '../../../frames/src/client.js' |
| web/test/consistency/sref-table-pending-read.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/tier-assets-ready.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/tier-bind-hold.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/consistency/tier-prepare.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-client.js' |
| web/test/consistency/tier-regions-hold.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/tier-trace-hold.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/consistency/tier-wire-preload.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/context.spec.tsx | 7 | 0 |  |
| web/test/delegated-event-cross-runtime.spec.tsx | 0 | 1 | not ours: Cannot find module '../src/client.js' |
| web/test/delegated-event-listener-object.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client.js' |
| web/test/derived-presence-async-3726.spec.tsx | 1 | 1 |  |
| web/test/dev-warning.spec.tsx | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| web/test/diagnostic-element-ref.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/dist-frames-server-instance.spec.ts | 0 | 9 | Cannot find module '@solidjs/web' |
| web/test/dist-nested-manifests.spec.ts | 0 | 1 |  |
| web/test/dynamic-namespace.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/dynamic-static.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/dynamic.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/element.spec.tsx | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
| web/test/errored-async-nesting.spec.tsx | 2 | 1 |  |
| web/test/errored.spec.tsx | 10 | 2 |  |
| web/test/event-handler.spec.tsx | 0 | 1 | SyntaxError: Export named 'addEvent' not found |
| web/test/for.nonkeyed.spec.tsx | 50 | 0 |  |
| web/test/for.nonkeyed.store.spec.tsx | 0 | 1 |  |
| web/test/for.spec.tsx | 50 | 0 |  |
| web/test/frames-adopted-region-fragments.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-assets-client.spec.ts | 0 | 1 | not ours: Cannot find module '../frames/src/frame-client.js' |
| web/test/frames-binding-slots.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-client.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-container-lazy-codec.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-container-lazy-document.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-dynamic-contract.spec.tsx | 1 | 0 |  |
| web/test/frames-errored-reset-refetch.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-flight-delivery.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-get.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-hn-client.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-late-boundary-client.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-live-resume.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-live-showing.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-live.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-marker-corruption.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-morph-in-transition.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-occlusion-client.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-optimistic-hold.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-plain-bound.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/frames-slot-arg-flights-3852.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/frames-used-region-client.spec.tsx | 0 | 1 | not ours: Cannot find module '../frames/src/client.js' |
| web/test/halt-error-logging.spec.tsx | 0 | 1 |  |
| web/test/held-action-memo-mount-3802.spec.tsx | 1 | 0 |  |
| web/test/hydration/adopted-claim-args-address.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/adopted-fallback-residue.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/adopted-slot-late-record.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/adopted-slot-live.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/binding-slot-adoption.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/buffered-projection-repeat.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/class.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/client-only.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/container-trace-hold-hydration-end.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/hydration/container-trace-hold-id-determinism.spec.tsx | 0 | 1 |  |
| web/test/hydration/container-trace-hold-interruption.spec.tsx | 0 | 1 |  |
| web/test/hydration/container-trace-hold-record-retention.spec.tsx | 0 | 1 |  |
| web/test/hydration/container-trace-hold-snapshot.spec.tsx | 0 | 1 | Cannot find module 'solid-js/internal/container-trace' |
| web/test/hydration/diagnostics.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/document-live-channel.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/document-shell.spec.tsx | 0 | 1 | SyntaxError: Export named 'NoHydration' not found |
| web/test/hydration/dynamic-async-loading-3666.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/dynamic-component-parity-inline-via-dynamic.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/dynamic-component-parity-inline.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/dynamic-component-parity-streamed-via-dynamic.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/dynamic-component-parity-streamed.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/dynamic-hydration-events.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/hydration/eager-jsx-falsy-show.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/frame-live-document-switched.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frame-live-document.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frame-nonlive-document-3666-async-arrow.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frame-nonlive-document-3666-inline.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frame-nonlive-document-3666-streamed.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frame-nonlive-document-3666-wrapped.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/hydration/frames-adopted-error-outward.spec.tsx | 0 | 1 | not ours: Cannot find module '../../server-functions/src/client.js' |
| web/test/hydration/hybrid-memo-handoff.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/hybrid-store-handoff-3574.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/hydrate-falsy-sole-child-issue-3571.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/insert-refresh-drift.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/late-fragment-after-done.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/live-shell-source-3764.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/loading-fallback-reactive-text.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/loading-late-fragment.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/loading-lazy-resume-3749.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/multi-root-registry.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/nav-before-resume.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/hydration/null-owner-3609.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/onsettled-hydrate.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/parity-harness.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/preload-failure-document-root.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/refresh-hmr-stream.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/refresh' |
| web/test/hydration/show-fallback.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/slot-hydration-3567.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/hydration/spread-innerhtml.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/stateful-input-adoption.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/style-adoption.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/text-node-adoption.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/truncated-registry.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/truncated-stream-late-boundary.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/truncated-stream-template.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/truncated-stream.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/hydration/wait-asset-hydration.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/hydration/welcome-status-lazy.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/hydration/welcome-status-loaded.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/hydration/welcome-status-streamed.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/hydration/write-before-resume.spec.tsx | 0 | 1 | SyntaxError: Export named 'hydrate' not found |
| web/test/inherited-dom-properties.spec.ts | 0 | 1 | not ours: Cannot find module '../src/client.js' |
| web/test/insert-falsy-sole-child-issue-3571.spec.tsx | 8 | 0 |  |
| web/test/insert-flatten-needs-unwrap.spec.tsx | 1 | 0 |  |
| web/test/insert-text-reuse.spec.tsx | 3 | 1 |  |
| web/test/interaction-frame-per-event-3754.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/interaction-provenance.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/ispending-combined-atomic-3442.spec.tsx | 3 | 0 |  |
| web/test/ispending-gated-landing.spec.tsx | 1 | 0 |  |
| web/test/ispending-memo-gate-3766.spec.tsx | 2 | 0 |  |
| web/test/ispending-memo-unstamped-hold-3457.spec.tsx | 1 | 0 |  |
| web/test/latest-async.spec.tsx | 0 | 1 |  |
| web/test/latest-banner-landing-gap.spec.tsx | 1 | 0 |  |
| web/test/latest-conditional-async-issue-3276.spec.tsx | 0 | 1 |  |
| web/test/latest-ispending-issue-3041.spec.tsx | 2 | 0 |  |
| web/test/latest-shadow-owned-write-issue-3378.spec.tsx | 1 | 0 |  |
| web/test/lifecycle-matrix/call-driven-args.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/call-driven-lifecycle.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/call-driven-slots.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/container-args.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/document-adoption.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/document-live-holes.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/placeholder-mount.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/lifecycle-matrix/remount.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/client.js' |
| web/test/loading-fallback-in-flush-3540.spec.tsx | 0 | 3 |  |
| web/test/loading-on-keyed-boundary-3540.spec.tsx | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| web/test/loading-on-outside-reader-3412.spec.tsx | 4 | 0 |  |
| web/test/loading-reset-collects-forwarded-3459.spec.tsx | 0 | 1 |  |
| web/test/loading.spec.tsx | 11 | 10 |  |
| web/test/lowercase-on-attribute.spec.tsx | 4 | 6 |  |
| web/test/nested-render-effect-cleanup-issue-3404.spec.tsx | 0 | 1 |  |
| web/test/optimistic-confirm-holds-signal-3706.spec.tsx | 4 | 0 |  |
| web/test/optimistic-for-index-frame-f1.spec.tsx | 43 | 0 |  |
| web/test/optimistic-lazy-show-preview-3706.spec.tsx | 0 | 0 |  |
| web/test/optimistic-list-holes-f3-f5.spec.tsx | 10 | 0 |  |
| web/test/optimistic-mount-style-3835.spec.tsx | 0 | 3 |  |
| web/test/optimistic-move-keyed-show-3662.spec.tsx | 7 | 0 |  |
| web/test/optimistic-nested-show-drag-3706.spec.tsx | 2 | 0 |  |
| web/test/optimistic-playground-port.spec.tsx | 0 | 1 |  |
| web/test/performance-tracks.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/polymorphic-chain.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/portal.spec.tsx | 0 | 1 | not ours: SyntaxError: Export named 'OBSERVE' not found |
| web/test/preload-links-adopt-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'useHead' not found |
| web/test/preload-links-frame-client.spec.ts | 0 | 1 | not ours: Cannot find module '../frames/src/frame-client.js' |
| web/test/projection-async-stream.spec.tsx | 1 | 1 |  |
| web/test/refresh-hmr-flow.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/refresh' |
| web/test/refresh-render.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/refresh' |
| web/test/render-halt-recovery.spec.tsx | 0 | 1 |  |
| web/test/repeat.spec.tsx | 50 | 1 |  |
| web/test/runtime/chunk-reader-hardening.spec.ts | 0 | 1 | not ours: Cannot find module '../../server-functions/src/shared.js' |
| web/test/runtime/chunk-reader.spec.ts | 0 | 1 | not ours: Cannot find module '../../server-functions/src/shared.js' |
| web/test/select-multiple.spec.tsx | 4 | 0 |  |
| web/test/server-functions-live-loop.spec.tsx | 0 | 1 | not ours: Cannot find module '../server-functions/src/client.js' |
| web/test/server-mock.spec.tsx | 0 | 1 | Cannot find module '../src/server-mock.js' |
| web/test/server/client-hole-derived-async-3659.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/client-only-preload.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/concurrent-render-error-policy.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/concurrent-render-lazy-assets.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/concurrent-render-serialize.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/concurrent-render-trace.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/container-traces.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/diagnostics-server-scenario.spec.tsx | 0 | 1 | Cannot find module '@solidjs/diagnostics' |
| web/test/server/dist-server-artifact.spec.tsx | 0 | 1 | not ours: Cannot find module '../../dist/server.js' |
| web/test/server/dist-server-dev-artifact.spec.tsx | 0 | 1 | not ours: Cannot find module '../../dist/server.dev.js' |
| web/test/server/dist-server-treeshake.spec.tsx | 0 | 1 |  |
| web/test/server/document-face-arg-tiers.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/document-live-channel-artifact.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/document-live-holes.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/document-shell.spec.tsx | 0 | 1 | SyntaxError: Export named 'NoHydration' not found |
| web/test/server/dynamic-async-component-diagnostic.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/dynamic-async-loading-3666.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/dynamic-component-parity.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/dynamic-hydration.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/server/dynamic-shell-gating.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/dynamic-static.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/server/dynamic-xmlns.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/errored-loading-superseded-pass-3750.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/errored-sync-suspend-retry.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/escape-late-values.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/exports-server-conditions.spec.tsx | 0 | 9 | Cannot find module '@solidjs/web/frames' |
| web/test/server/frame-binding-slots.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/frame-fragment-error-outcome.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-get.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-hn.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-document-artifact.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-document.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-framing.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-holes-chat.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/server.js' |
| web/test/server/frame-live-holes-projection.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-holes.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-live-resume.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-nonlive-document-3666.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-plain-bound.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-server-component.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-ssr-seam.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-sweep-ops.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/frame-teardown.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/generic-hydration.gen.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/hole-retry-shared-slot-3815.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/http-components.spec.tsx | 0 | 1 | SyntaxError: Export named 'httpHeader' not found |
| web/test/server/hybrid-memo-handoff.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/hybrid-store-handoff-3574.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/hydration-harness.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/server/hydration-payload-handled-rejection-3769.spec.tsx | 0 | 1 | SyntaxError: Export named 'HydrationScript' not found |
| web/test/server/hydration-transfer.spec.tsx | 0 | 1 | not ours: Cannot find module '../../src/client.js' |
| web/test/server/lazy-assets-livelock.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/lazy-nested-late-assets.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/lazy-shell-gating.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/live-shell-source-3764.gen.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/loading-dynamic-fragments.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/loading-recreated-async-source-3734.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/lowercase-on-attribute.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/nav-before-resume.gen.spec.tsx | 0 | 1 | SyntaxError: Export named 'getHydrationWriter' not found |
| web/test/server/polymorphic-chain.spec.tsx | 0 | 1 | SyntaxError: Export named 'isStatic' not found |
| web/test/server/projection-body-read.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/render-to-string-dispose.spec.tsx | 0 | 1 | SyntaxError: Export named 'createRequestEvent' not found |
| web/test/server/request-event-concurrent.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/response-invariants.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/retry-robustness.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/select-value.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/server-boundary-records.spec.tsx | 0 | 1 | SyntaxError: Export named 'Reveal' not found |
| web/test/server/server-component-context.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/server-diagnostics.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/server-error-hook.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-frame-records.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/server-functions-abort-conforming-length.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-adapter-request.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-addressing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-body-buffering.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-body-cap-declaration-trust.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-body-formats.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-content-length.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-cors-origin.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-csrf.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-decoder-rejection-ownership.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-derived-locals.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-dev-rebind-grant.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-direct-provide-event-once.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-encode-hygiene.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-error-carrier-guard.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-event-hook.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-extensions.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-failure-sanitization.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-failure-signal.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-bound-form.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-bounds.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-encryption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-falsy-outcomes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-key-derivation.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flash-url-bound.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flight-markup.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flight-result-ownership.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-flight-source-dedupe.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-format-version-skew.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-get-grant-binding.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-http-hygiene.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-invocation-wrap.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-invoke.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-live-framing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-live-lifetime.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-live-retry.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-negative-zero.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-nested-deferred-scope.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-nojs-destination.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-open-gaps.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-outcome-digest.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-proto-keys.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-redirect-scheme.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-redirect-status.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-registry-reload.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-request-bounds.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-request-event-scope.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-response-aliasing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-result-descriptors.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-single-flight.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-transform-result-thrown.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-transport-failure.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-undefined-arguments.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-version-skew.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-wrap-invocation-validation.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-functions-wrap-nested-direct.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-observe-invocations.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/test/server/server-owner-walks.spec.tsx | 0 | 5 |  |
| web/test/server/server-render-route.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/server-trace.spec.tsx | 0 | 1 | Cannot find module '../../src/server.js' |
| web/test/server/shared-async-sources.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/shell-suspend-loading-inline.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/slot-hydration-3567.spec.tsx | 0 | 1 | SyntaxError: Export named 'Dynamic' not found |
| web/test/server/spread-function-source.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/spread-hydration.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/spread-omit.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/spread-static-tail.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/spread-static-text.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-async-rejection-3569.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/ssr-async-rejection-3570.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-class-style-separators.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-class.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-element-names.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/ssr-element-nullish-attrs.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-element-sources.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/ssr-error-sanitization.spec.tsx | 0 | 22 |  |
| web/test/server/ssr-fragment-rejection-stub-batch.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/ssr-response-teardown-3768.spec.tsx | 0 | 1 | SyntaxError: Export named 'createRequestEvent' not found |
| web/test/server/ssr-serialized-rejection-stub-batch.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/internal' |
| web/test/server/ssr-stream.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/ssr-style-properties.spec.tsx | 0 | 1 | Cannot find module '../../src/server.js' |
| web/test/server/ssr-text-separators.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToString' not found |
| web/test/server/stream-cancel-iterators-3626.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/serialization' |
| web/test/server/stream-hang-nested-loading-3478.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/then-shell-suspend.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/tier-announce.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/tree-rewrite.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/tree-rewrite.js' |
| web/test/server/use-head-loading.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/server/welcome-status-parity.spec.tsx | 0 | 1 | not ours: Cannot find module '../../frames/src/frame-sink.js' |
| web/test/server/write-before-resume.gen.spec.tsx | 0 | 1 | SyntaxError: Export named 'renderToStream' not found |
| web/test/show-in-for.spec.tsx | 1 | 0 |  |
| web/test/show-optimistic-sync-write-3698.spec.tsx | 2 | 0 |  |
| web/test/show.spec.tsx | 30 | 0 |  |
| web/test/spread-enumerate.spec.tsx | 1 | 3 |  |
| web/test/spread-nodes.spec.tsx | 11 | 15 |  |
| web/test/spread-nullish.spec.tsx | 1 | 3 |  |
| web/test/spread-omit.spec.tsx | 1 | 0 |  |
| web/test/spread-sources.spec.tsx | 10 | 3 |  |
| web/test/spread-static-text.spec.tsx | 3 | 0 |  |
| web/test/style-class-tracked.spec.tsx | 0 | 1 | SyntaxError: Export named 'readShallow' not found |
| web/test/superseded-source-blocks-3462.spec.tsx | 0 | 2 |  |
| web/test/switch.spec.tsx | 28 | 2 |  |
| web/test/take-hydration-value.spec.ts | 0 | 1 | SyntaxError: Export named 'getHydrationWriter' not found |
| web/test/template-document-shell.spec.tsx | 0 | 1 | not ours: Cannot find module '../src/client.js' |
| web/test/trace-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'getTraceContext' not found |
| web/test/use-head-css-gating-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'useHead' not found |
| web/test/use-head-loading-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'useHead' not found |
| web/test/wait-asset.spec.tsx | 0 | 1 | Cannot find module '../src/render.js' |
| web/test/wide-scope-insert-3739.spec.tsx | 0 | 1 | not ours: Cannot find module 'solid-js/attribution' |
| web/test/zombie-show-leak-3543.spec.tsx | 0 | 1 | not ours: SyntaxError: Export named 'DEV' not found |
