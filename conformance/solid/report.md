# Solid's tests on Twist

2152 pass, 2276 fail, 703 files (479 did not load)

## Why files did not load

- 284 × Cannot find module '@solidjs/web
/jsx-dev-runtime'
- 36 × Cannot find module '@solidjs/web/server-functions/server'
- 32 × Cannot find module '@solidjs/web'
- 25 × Cannot find module '../src/attribution.js'
- 14 × Cannot find module '../../src/server/index.js'
- 12 × Cannot find module '../src/client/hydration.js'
- 6 × SyntaxError: Export named 'DEV' not found
- 6 × SyntaxError: Export named 'OBSERVE' not found
- 4 × Cannot find module '../src/core/index.js'
- 4 × Cannot find module '../../src/store/store.js'
- 4 × Cannot find module '../src/client.js'
- 3 × Cannot find module '../src/core/dev.js'
- 2 × SyntaxError: Export named 'clearSnapshots' not found
- 2 × SyntaxError: Export named 'createRevealOrder' not found
- 2 × Cannot find module '../src/core/constants.js'
- 2 × Cannot find module '../src/store/store.js'
- 2 × SyntaxError: Export named 'storePath' not found
- 2 × Cannot find module '../../src/store/target.js'
- 2 × SyntaxError: Export named 'createComponent' not found
- 2 × Cannot find module '../../dist/server.js'
- 2 × Cannot find module '../frames/src/frame-client.js'
- 2 × Cannot find module '../../server-functions/src/shared.js'
- 1 × Cannot find module '../src/core/attribution.js'
- 1 × SyntaxError: Export named 'ROOT_ERROR_HOOK' not found
- 1 × SyntaxError: Export named 'createReaction' not found
- 1 × SyntaxError: Export named 'enforceLoadingBoundary' not found
- 1 × Cannot find module '../src/map.js'
- 1 × SyntaxError: Export named '$REFRESH' not found
- 1 × Cannot find module '../src/core/async.js'
- 1 × SyntaxError: Export named 'hasStaticKeys' not found
- 1 × SyntaxError: Export named '$RECORD' not found
- 1 × Cannot find module '../src/core/error.js'
- 1 × Cannot find module '../src/core/core.js'
- 1 × Cannot find module '../src/client/container-trace.js'
- 1 × Cannot find module '../dist/solid.js'
- 1 × Cannot find module '../src/client/core.js'
- 1 × SyntaxError: Export named 'enableHydration' not found
- 1 × Cannot find module '../src/refresh/index.js'
- 1 × Cannot find module 'solid-js/attribution'
- 1 × Cannot find module '../../frames/src/frame-client.js'
- 1 × Cannot find module '../frames/src/client.js'
- 1 × SyntaxError: Export named 'render' not found
- 1 × Cannot find module '../server-functions/src/client.js'
- 1 × Cannot find module '../src/server-mock.js'
- 1 × Cannot find module '../../dist/server.dev.js'
- 1 × Cannot find module '../../src/server.js'
- 1 × Cannot find module '../../frames/src/tree-rewrite.js'
- 1 × SyntaxError: Export named 'spread' not found
- 1 × SyntaxError: Export named 'getHydrationWriter' not found
- 1 × SyntaxError: Export named 'getTraceContext' not found
- 1 × Cannot find module '../src/render.js'

## Files

| file | pass | fail | note |
|---|---|---|---|
| signals/a34-writes-then-derivations.test.ts | 2 | 6 |  |
| signals/action-await-contract.test.ts | 0 | 4 |  |
| signals/action-completion-race.test.ts | 1 | 0 |  |
| signals/action-done-window.test.ts | 2 | 1 |  |
| signals/action-loading-rail.test.ts | 4 | 1 |  |
| signals/action-thenable-assimilation.test.ts | 1 | 3 |  |
| signals/action.test.ts | 49 | 18 |  |
| signals/adoption-unchanged-key-read-3706.test.ts | 0 | 0 |  |
| signals/affects-audit-2893.test.ts | 1 | 7 |  |
| signals/affects-propagation.test.ts | 0 | 9 |  |
| signals/async-chain-supersession.test.ts | 5 | 3 |  |
| signals/async-landing-deps-3461.test.ts | 0 | 2 |  |
| signals/async-lane-landing-equals-order.test.ts | 1 | 0 |  |
| signals/attribution-benchmark-eval.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-current-origin.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-effect-cycle.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-engine-cost.test.ts | 0 | 0 |  |
| signals/attribution-fan-out.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-feedback-findings.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-feedback.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-graph-growth.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-holds.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-immutable-update.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-interactions.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-lean-gate.test.ts | 0 | 1 | Cannot find module '../src/core/attribution.js' |
| signals/attribution-list-identity.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-navigation.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-optimistic-revert.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-provenance.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-relay-tear.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-timeline.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-unstable-memo.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-values.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-wasted-recompute.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-waterfall-eval.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution-wide-scope.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/attribution.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/autodispose-contract.test.ts | 2 | 2 |  |
| signals/autodispose-pending-release.test.ts | 4 | 2 |  |
| signals/body-end-supersession-visibility.test.ts | 0 | 1 |  |
| signals/born-held.test.ts | 1 | 3 |  |
| signals/boundary-not-born-held-3540.test.ts | 1 | 11 |  |
| signals/boundary-output-frame-reader.test.ts | 4 | 0 |  |
| signals/client-error-hook.test.ts | 0 | 1 | SyntaxError: Export named 'ROOT_ERROR_HOOK' not found |
| signals/compute-write-joins-transition.test.ts | 1 | 1 |  |
| signals/contested-effect.test.ts | 0 | 3 |  |
| signals/context.test.ts | 3 | 3 |  |
| signals/createEffect.test.ts | 19 | 5 |  |
| signals/createErrorBoundary.test.ts | 0 | 1 | SyntaxError: Export named 'clearSnapshots' not found |
| signals/createLoadingBoundary.on.test.ts | 2 | 5 |  |
| signals/createLoadingBoundary.test.ts | 9 | 17 |  |
| signals/createMemo.test.ts | 0 | 0 |  |
| signals/createOptimistic.test.ts | 13 | 55 |  |
| signals/createProjection.draft-lifetime-3585.test.ts | 9 | 8 |  |
| signals/createReaction.test.ts | 0 | 1 | SyntaxError: Export named 'createReaction' not found |
| signals/createRevealOrder.test.ts | 0 | 1 | SyntaxError: Export named 'createRevealOrder' not found |
| signals/createRoot.test.ts | 0 | 1 | Cannot find module '../src/core/index.js' |
| signals/createSignal.test.ts | 10 | 0 |  |
| signals/createTrackedEffect.test.ts | 7 | 12 |  |
| signals/derived-write-then-derivation-3733.test.ts | 14 | 23 |  |
| signals/dev.test.ts | 0 | 1 | Cannot find module '../src/core/index.js' |
| signals/diagnostics.test.ts | 0 | 1 | Cannot find module '../src/core/dev.js' |
| signals/direct-commit-readers-posture.test.ts | 0 | 3 |  |
| signals/direction-rule-probe.test.ts | 0 | 1 |  |
| signals/disposed-read-lifecycle.test.ts | 5 | 0 |  |
| signals/dist-artifacts.test.ts | 1 | 21 |  |
| signals/dormant-memo-chain-3554.test.ts | 2 | 4 |  |
| signals/effect-error-phases.test.ts | 5 | 6 |  |
| signals/effect-mainline-ownership-3412.test.ts | 0 | 4 |  |
| signals/effect-phase-writes.test.ts | 0 | 10 |  |
| signals/enableExternalSource.test.ts | 0 | 1 | Cannot find module '../src/core/index.js' |
| signals/enforceLoadingBoundary.test.ts | 0 | 1 | SyntaxError: Export named 'enforceLoadingBoundary' not found |
| signals/equals-comparator-errors.test.ts | 1 | 5 |  |
| signals/error-silent-recovery.test.ts | 0 | 7 |  |
| signals/errorHalt.test.ts | 2 | 7 |  |
| signals/falsy-error-identity.test.ts | 18 | 2 |  |
| signals/finalize-reentry.test.ts | 0 | 4 |  |
| signals/first-observer-stale-reader.test.ts | 1 | 0 |  |
| signals/flatten-async-iterable.test.ts | 3 | 8 |  |
| signals/flatten-needs-unwrap.test.ts | 1 | 2 |  |
| signals/flush-in-action.test.ts | 1 | 5 |  |
| signals/flush.test.ts | 6 | 0 |  |
| signals/fuzz-findings-l2.test.ts | 7 | 1 |  |
| signals/gc.test.ts | 1 | 0 |  |
| signals/getOwner.test.ts | 2 | 0 |  |
| signals/graph-size-diagnostics.test.ts | 0 | 1 | Cannot find module '../src/core/dev.js' |
| signals/graph.test.ts | 21 | 0 |  |
| signals/heap-mark-incremental.test.ts | 1 | 1 |  |
| signals/held-conditional-effect.test.ts | 0 | 1 |  |
| signals/held-conditional-memo.test.ts | 1 | 1 |  |
| signals/held-derivation-not-a-proposal-3612.test.ts | 8 | 11 |  |
| signals/held-effect-restage-run-3802.test.ts | 0 | 2 |  |
| signals/held-frame-dependencies.test.ts | 0 | 2 |  |
| signals/held-restore.test.ts | 3 | 1 |  |
| signals/held-truth-lane-only.test.ts | 0 | 1 | Cannot find module '../src/core/constants.js' |
| signals/inv4-projection-dispose-shadow.test.ts | 1 | 0 |  |
| signals/ispending-combined-atomic-3442.test.ts | 0 | 3 |  |
| signals/isPending-held-sync-memo.test.ts | 1 | 0 |  |
| signals/ispending-in-boundary-on-3528.test.ts | 1 | 5 |  |
| signals/isPending-memo-consistency.test.ts | 2 | 3 |  |
| signals/ispending-memo-gate-3766.test.ts | 6 | 0 |  |
| signals/ispending-memo-unstamped-hold-3457.test.ts | 0 | 1 |  |
| signals/issue-3800-repro.test.ts | 5 | 3 |  |
| signals/iterator-supersede-close.test.ts | 0 | 2 |  |
| signals/l2-contract.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| signals/l2-fuzz-existing-rules.test.ts | 0 | 5 |  |
| signals/lane-ambient-write-replay.test.ts | 3 | 0 |  |
| signals/lane-contract.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| signals/lane-frame-deferred-run-3662.test.ts | 0 | 3 |  |
| signals/lane-frame-held-lane-3662.test.ts | 0 | 5 |  |
| signals/lane-hold-on-observation.test.ts | 4 | 5 |  |
| signals/lane-outside-view.test.ts | 1 | 7 |  |
| signals/lane-pass-stamped-effect-3662.test.ts | 0 | 1 |  |
| signals/lane-uninitialized-landing-3648.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/late-pending-equality.test.ts | 4 | 4 |  |
| signals/latest-async.test.ts | 1 | 0 |  |
| signals/latest-created-inside-window.test.ts | 2 | 0 |  |
| signals/latest-held-till-flush.test.ts | 13 | 9 |  |
| signals/latest-isPending-consistency.test.ts | 5 | 3 |  |
| signals/latest-lazy-companion-backfill.test.ts | 2 | 0 |  |
| signals/latest-pending-probe-mid-flight.test.ts | 1 | 0 |  |
| signals/latest-plain-write-purity.test.ts | 4 | 0 |  |
| signals/latest-probe-order-independence.test.ts | 1 | 1 |  |
| signals/latest-repeated-writes.test.ts | 4 | 0 |  |
| signals/latest-shadow-owned-write.test.ts | 0 | 2 |  |
| signals/latest-unobserved-memo.test.ts | 3 | 0 |  |
| signals/loading-fallback-in-flush-3540.test.ts | 8 | 1 |  |
| signals/loading-fallback-release-3540.test.ts | 0 | 2 |  |
| signals/loading-on-frame-following-3540.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/loading-on-rearm-3540.test.ts | 0 | 7 |  |
| signals/loading-on-rearm-reveal-3540.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/loading-reset-collects-forwarded-3459.test.ts | 0 | 1 |  |
| signals/loading-value.test.ts | 0 | 0 |  |
| signals/mapArray-notready-safety.test.ts | 2 | 10 |  |
| signals/mapArray-smallmove.test.ts | 0 | 1 | Cannot find module '../src/map.js' |
| signals/maparray-store-nonkeyed.test.ts | 0 | 2 |  |
| signals/mapArray.test.ts | 7 | 0 |  |
| signals/mount-over-foreign-hold-3761.test.ts | 3 | 2 |  |
| signals/nested-render-effect-async-cleanup.test.ts | 0 | 5 |  |
| signals/observe-exclude.test.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| signals/observe-idle-cost.test.ts | 0 | 0 |  |
| signals/observe-records.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/oncleanup-reentrant-dispose-3601.test.ts | 5 | 0 |  |
| signals/onCleanup.test.ts | 5 | 0 |  |
| signals/onSettled.test.ts | 0 | 13 |  |
| signals/optimistic-lane-release.test.ts | 1 | 3 |  |
| signals/optimistic-lane-transaction-ownership.test.ts | 0 | 2 |  |
| signals/optimistic-mount-binding-3835.test.ts | 0 | 2 |  |
| signals/optimistic-mount-nested-memo-3835.test.ts | 0 | 4 |  |
| signals/optimistic-move-duplicate-3548.test.ts | 0 | 1 |  |
| signals/optimistic-move-keyed-show-3662.test.ts | 2 | 0 |  |
| signals/optimistic-outside-refetch-619.test.ts | 0 | 5 |  |
| signals/optimistic-over-held-row-3796.test.ts | 0 | 2 |  |
| signals/optimistic-read-lane-not-transaction-3698.test.ts | 1 | 5 |  |
| signals/optimistic-refetch-longer-3568.test.ts | 0 | 4 |  |
| signals/optimistic-settle-verdicts.test.ts | 0 | 3 |  |
| signals/optimistic-signal-refetch-hold.test.ts | 1 | 1 |  |
| signals/optimistic-store-layer-scope.test.ts | 0 | 5 |  |
| signals/optimistic-store-refetch-hold.test.ts | 0 | 5 |  |
| signals/optimistic-undefined-override.test.ts | 0 | 6 |  |
| signals/overlapping-flights.test.ts | 2 | 1 |  |
| signals/owned-scope-write-guard.test.ts | 12 | 2 |  |
| signals/pending-companion-lane-parent.test.ts | 0 | 1 |  |
| signals/pending-gated-landing-replay.test.ts | 1 | 0 |  |
| signals/pending-source-repark.test.ts | 1 | 1 |  |
| signals/posture-born-held-and-observation.test.ts | 1 | 4 |  |
| signals/posture-store-parity.test.ts | 0 | 1 | Cannot find module '../src/store/store.js' |
| signals/propagation-isolation.test.ts | 2 | 0 |  |
| signals/question-scoped-pending.test.ts | 4 | 34 |  |
| signals/recompute-missed-wake.test.ts | 2 | 0 |  |
| signals/recompute-preserves-disposed-3621.test.ts | 0 | 1 | SyntaxError: Export named '$REFRESH' not found |
| signals/refresh-await.test.ts | 0 | 0 |  |
| signals/repeat.test.ts | 11 | 0 |  |
| signals/resolve-in-action.test.ts | 3 | 2 |  |
| signals/resolve.test.ts | 0 | 0 |  |
| signals/reveal-carve-out.test.ts | 1 | 3 |  |
| signals/reveal-gating-contract.test.ts | 1 | 1 |  |
| signals/root-dispose-pending-action-3561.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| signals/router-transition-error-commit.test.ts | 1 | 0 |  |
| signals/rules-index.test.ts | 0 | 3 |  |
| signals/runWithOwner.test.ts | 3 | 0 |  |
| signals/scheduler-livelock.test.ts | 0 | 1 | Cannot find module '../src/core/constants.js' |
| signals/settle-folds-queued-writes.test.ts | 0 | 2 |  |
| signals/settle-walk-invariant.test.ts | 0 | 1 | Cannot find module '../src/core/async.js' |
| signals/shallow-store-proxy-children.test.ts | 0 | 1 | Cannot find module '../src/store/store.js' |
| signals/shared-effect-no-entangle.test.ts | 4 | 0 |  |
| signals/snapshot-derived-store-rows.test.ts | 3 | 2 |  |
| signals/snapshot.test.ts | 0 | 1 | SyntaxError: Export named 'clearSnapshots' not found |
| signals/spec-async-semantics.test.ts | 11 | 41 |  |
| signals/stale-read-uninitialized-cross-transition.test.ts | 1 | 1 |  |
| signals/store-unchanged-read-independent-write-3688.test.ts | 2 | 2 |  |
| signals/store/adoption-lane-rollback.test.ts | 0 | 2 |  |
| signals/store/async-setter.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/store/child-companion-walk.test.ts | 1 | 1 |  |
| signals/store/createOptimisticStore.test.ts | 5 | 75 |  |
| signals/store/createProjection.async.test.ts | 0 | 1 |  |
| signals/store/createProjection.jsdom.test.ts | 1 | 0 |  |
| signals/store/createProjection.test.ts | 3 | 17 |  |
| signals/store/createStore.test.ts | 0 | 1 | SyntaxError: Export named 'storePath' not found |
| signals/store/deep-chained-view.test.ts | 0 | 1 | Cannot find module '../../src/store/store.js' |
| signals/store/deep-held-visibility.test.ts | 0 | 1 |  |
| signals/store/deep-overlay-rewalk.test.ts | 3 | 0 |  |
| signals/store/derived-optimistic-retained-row-3859.test.ts | 0 | 2 |  |
| signals/store/derived-optimistic-shadow.test.ts | 2 | 2 |  |
| signals/store/derived-presence-async-3726.test.ts | 3 | 5 |  |
| signals/store/derived-retained-draft-row-3767.test.ts | 2 | 1 |  |
| signals/store/enumerator-presence-nodes.test.ts | 2 | 16 |  |
| signals/store/flight-owned-transaction.test.ts | 1 | 3 |  |
| signals/store/fold-3164.test.ts | 0 | 2 |  |
| signals/store/fold-privatization-order.test.ts | 9 | 1 |  |
| signals/store/fold-scheduling.test.ts | 0 | 1 | Cannot find module '../../src/store/store.js' |
| signals/store/fold-slot-identity.test.ts | 0 | 6 |  |
| signals/store/kanban-a17-fixture.test.ts | 1 | 2 |  |
| signals/store/lane-authority-twins.test.ts | 1 | 6 |  |
| signals/store/latest-read-after-write-3576.test.ts | 0 | 1 |  |
| signals/store/native-collections.test.ts | 8 | 2 |  |
| signals/store/next-smoke.test.ts | 0 | 1 | Cannot find module '../../src/store/target.js' |
| signals/store/optimistic-ambient-capture.test.ts | 0 | 1 |  |
| signals/store/optimistic-chained-revert-3672-memo.test.ts | 1 | 5 |  |
| signals/store/optimistic-chained-revert-3672.test.ts | 0 | 4 |  |
| signals/store/optimistic-draft-visibility-3665.test.ts | 1 | 7 |  |
| signals/store/optimistic-list-mutation-matrix.test.ts | 232 | 668 |  |
| signals/store/optimistic-maparray-index-frame-f1.test.ts | 0 | 43 |  |
| signals/store/optimistic-observer-invariance.test.ts | 0 | 2 |  |
| signals/store/optimistic-removed-prop-3883.test.ts | 4 | 2 |  |
| signals/store/optimistic-untracked-reads-f3-f5.test.ts | 2 | 9 |  |
| signals/store/overlay-rebuild-3689.test.ts | 0 | 1 | Cannot find module '../../src/store/store.js' |
| signals/store/overlay.test.ts | 7 | 4 |  |
| signals/store/owner-stamp.test.ts | 0 | 1 | Cannot find module '../../src/store/target.js' |
| signals/store/pr3017-function-leaves.test.ts | 4 | 0 |  |
| signals/store/privatization-observer-identity.test.ts | 0 | 2 |  |
| signals/store/projection-absent-key-tracking.test.ts | 3 | 1 |  |
| signals/store/projection-root-overlay.test.ts | 3 | 3 |  |
| signals/store/projection-slot-release.test.ts | 0 | 6 |  |
| signals/store/projection-transition-isolation.test.ts | 1 | 3 |  |
| signals/store/reconcile-captured-proxies.test.ts | 7 | 2 |  |
| signals/store/reconcile-resend-identity.test.ts | 2 | 2 |  |
| signals/store/reconcile.test.ts | 26 | 21 |  |
| signals/store/recursive-effects.test.ts | 3 | 1 |  |
| signals/store/retained-draft-row-3767.test.ts | 0 | 1 |  |
| signals/store/shallow-loading.test.ts | 0 | 8 |  |
| signals/store/shallow.test.ts | 0 | 1 | Cannot find module '../../src/store/store.js' |
| signals/store/shared-child-multiparent.test.ts | 1 | 2 |  |
| signals/store/sidecar-composition.test.ts | 0 | 1 |  |
| signals/store/signal-store-twins-qd.test.ts | 0 | 4 |  |
| signals/store/store-in-store-tracking.test.ts | 0 | 7 |  |
| signals/store/storePath.test.ts | 0 | 1 | SyntaxError: Export named 'storePath' not found |
| signals/store/unchanged-presence-no-hold-3743.test.ts | 0 | 0 |  |
| signals/store/utilities-no-proxy.test.ts | 0 | 1 | SyntaxError: Export named 'hasStaticKeys' not found |
| signals/store/utilities.test.ts | 0 | 1 | SyntaxError: Export named '$RECORD' not found |
| signals/store/woken-transaction-adopts-staged-bump.test.ts | 0 | 1 |  |
| signals/store/write-floor.test.ts | 6 | 3 |  |
| signals/strict-read-pending-store.test.ts | 0 | 1 | Cannot find module '../src/core/error.js' |
| signals/strict-read-snapshot-scope-3675.test.ts | 0 | 1 | Cannot find module '../src/core/core.js' |
| signals/strictRead.test.ts | 5 | 7 |  |
| signals/superseded-before-first-commit.test.ts | 0 | 1 |  |
| signals/superseded-flight-pending-source.test.ts | 0 | 1 | SyntaxError: Export named 'OBSERVE' not found |
| signals/superseded-source-blocks-3462.test.ts | 0 | 2 |  |
| signals/syncThenable.test.ts | 4 | 23 |  |
| signals/tick-scoped-pass-transaction.test.ts | 0 | 2 |  |
| signals/transition-corpse-revival.test.ts | 0 | 1 | Cannot find module '../src/core/index.js' |
| signals/transition-orphan-recompute.test.ts | 0 | 2 |  |
| signals/transitionEntanglement.test.ts | 0 | 2 |  |
| signals/transitionMerge.test.ts | 0 | 1 |  |
| signals/treeshake.test.ts | 0 | 1 |  |
| signals/uninitialized-visibility.test.ts | 1 | 6 |  |
| signals/until-entanglement.test.ts | 0 | 6 |  |
| signals/until.test.ts | 7 | 10 |  |
| signals/untrack.test.ts | 3 | 0 |  |
| signals/untracked-async-read.test.ts | 1 | 2 |  |
| signals/untracked-read-after-await.test.ts | 0 | 1 | Cannot find module '../src/core/dev.js' |
| signals/verdict-contract.test.ts | 1 | 4 |  |
| signals/verdict-mount-first-pass-3851.test.ts | 0 | 3 |  |
| signals/verdict-mount-loading-flush-loop.test.ts | 0 | 0 |  |
| signals/visibility-oracle-posture.test.ts | 1147 | 37 |  |
| signals/visibility-oracle-store.test.ts | 101 | 52 |  |
| signals/visibility-oracle.test.ts | 75 | 51 |  |
| signals/write-proposals-3494.test.ts | 9 | 3 |  |
| signals/zombie-create-path-keeps-flag.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| signals/zombie-recompute-keeps-flag.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| signals/zombie-rerun-after-commit-3546.test.ts | 0 | 1 | SyntaxError: Export named 'DEV' not found |
| solid/client-hydration.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/client-recovery-record.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/component.spec.ts | 0 | 1 | SyntaxError: Export named 'createComponent' not found |
| solid/container-trace.spec.ts | 0 | 1 | Cannot find module '../src/client/container-trace.js' |
| solid/cross-package-fields.spec.ts | 0 | 0 |  |
| solid/dev.spec.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| solid/dist-client-artifact.spec.ts | 0 | 1 | Cannot find module '../dist/solid.js' |
| solid/hybrid-memo-handoff.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hybrid-store-handoff.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hydrate-window.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hydration-latch.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hydration-null-owner-3609.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hydration-root-snapshot-scope-3504.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/hydration-state-api.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/id-parity.spec.ts | 0 | 1 | Cannot find module '../src/client/core.js' |
| solid/internal-surface.spec.ts | 0 | 4 |  |
| solid/lazy-strict-read-3675.spec.ts | 0 | 1 | SyntaxError: Export named 'createComponent' not found |
| solid/multi-root-hydration.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/package-exports.spec.ts | 0 | 1 |  |
| solid/public-boundary-exports.spec.ts | 0 | 1 | SyntaxError: Export named 'enableHydration' not found |
| solid/published-declarations.spec.ts | 0 | 1 |  |
| solid/refresh-hydration.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/refresh-prod.spec.ts | 0 | 1 | Cannot find module '../src/refresh/index.js' |
| solid/refresh.spec.ts | 0 | 1 | Cannot find module '../src/attribution.js' |
| solid/reveal.spec.ts | 0 | 1 | SyntaxError: Export named 'createRevealOrder' not found |
| solid/server/async-retry-child-reset.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/console-footer.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/dist-server-artifact.spec.ts | 0 | 1 | Cannot find module '../../dist/server.js' |
| solid/server/export-parity.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/flow.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/nohydration.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/observe-server.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/reveal-ssr.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/server-diagnostics.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/server-write-deprecation.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/shallow-projection.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/signals.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/ssr-async.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/ssr-scope-lazy-id.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/server/ssr-scope.spec.ts | 0 | 1 | Cannot find module '../../src/server/index.js' |
| solid/shallow-hydration.spec.ts | 0 | 1 | Cannot find module '../src/client/hydration.js' |
| solid/signals.spec.ts | 33 | 3 |  |
| web/async-landing-deps-3461.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/binding-names.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/capturing-event-listener.spec.ts | 0 | 1 | Cannot find module '../src/client.js' |
| web/class-binding.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/class-object-undefined.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/class.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/client-error-hook.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/client-only.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/client-records.spec.tsx | 0 | 1 | Cannot find module 'solid-js/attribution' |
| web/conditional-jsx-held-branch-3438.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/adopted-swap-post-done.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/boundary-arrival.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c01-claim-once.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c01-claim-window-roots.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c02-revealed-occurrence-mounts.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c03-hydration-done-counts-holds.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c04-record-applies-once.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c05-data-response-scoped.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c06-stale-wait-never-lands.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c07-store-is-truth.spec.tsx | 0 | 1 | Cannot find module '../../frames/src/frame-client.js' |
| web/consistency/c08-fanout-equal.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c09-no-phantom.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c10-ids-timing-independent.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c11-trace-equals-oracle.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c12-boundary-parity.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c13-sweep-atomic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c14-dispose-clean.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c15-staging-atomic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c16-reference-identity.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c17-gate-bound-address.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/c19-claim-reads-snapshot.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/generic/campaign.spec.tsx | 0 | 1 |  |
| web/consistency/generic/preload-hold.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/generic/replay.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/harness/campaign.spec.tsx | 0 | 1 |  |
| web/consistency/harness/replay.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/sref-table-pending-read.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-assets-ready.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-bind-hold.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-prepare.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-regions-hold.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-trace-hold.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/consistency/tier-wire-preload.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/context.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/delegated-event-cross-runtime.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/delegated-event-listener-object.spec.ts | 0 | 1 | Cannot find module '../src/client.js' |
| web/derived-presence-async-3726.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/dev-warning.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/diagnostic-element-ref.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/dist-frames-server-instance.spec.ts | 0 | 9 | Cannot find module '@solidjs/web' |
| web/dist-nested-manifests.spec.ts | 0 | 1 |  |
| web/dynamic-namespace.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/dynamic-static.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/dynamic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/element.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/errored-async-nesting.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/errored.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/event-handler.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/for.nonkeyed.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/for.nonkeyed.store.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/for.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-adopted-region-fragments.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-assets-client.spec.ts | 0 | 1 | Cannot find module '../frames/src/frame-client.js' |
| web/frames-binding-slots.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-container-lazy-codec.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-container-lazy-document.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-dynamic-contract.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-errored-reset-refetch.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-flight-delivery.spec.tsx | 0 | 1 | Cannot find module '../frames/src/client.js' |
| web/frames-get.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-hn-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-late-boundary-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-live-resume.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-live-showing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-live.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-marker-corruption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-morph-in-transition.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-occlusion-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-optimistic-hold.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-plain-bound.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-slot-arg-flights-3852.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/frames-used-region-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/halt-error-logging.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/held-action-memo-mount-3802.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/adopted-claim-args-address.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/adopted-fallback-residue.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/adopted-slot-late-record.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/adopted-slot-live.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/binding-slot-adoption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/buffered-projection-repeat.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/class.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/client-only.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/hydration/container-trace-hold-hydration-end.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/container-trace-hold-id-determinism.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/container-trace-hold-interruption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/container-trace-hold-record-retention.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/container-trace-hold-snapshot.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/diagnostics.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/document-live-channel.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/document-shell.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-async-loading-3666.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-component-parity-inline-via-dynamic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-component-parity-inline.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-component-parity-streamed-via-dynamic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-component-parity-streamed.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/dynamic-hydration-events.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/eager-jsx-falsy-show.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-live-document-switched.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-live-document.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-nonlive-document-3666-async-arrow.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-nonlive-document-3666-inline.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-nonlive-document-3666-streamed.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frame-nonlive-document-3666-wrapped.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/frames-adopted-error-outward.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/hybrid-memo-handoff.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/hybrid-store-handoff-3574.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/hydrate-falsy-sole-child-issue-3571.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/insert-refresh-drift.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/late-fragment-after-done.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/live-shell-source-3764.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/loading-fallback-reactive-text.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/loading-late-fragment.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/loading-lazy-resume-3749.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/multi-root-registry.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/nav-before-resume.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/null-owner-3609.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/hydration/onsettled-hydrate.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/parity-harness.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/preload-failure-document-root.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/refresh-hmr-stream.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/show-fallback.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/slot-hydration-3567.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/spread-innerhtml.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/stateful-input-adoption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/style-adoption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/text-node-adoption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/truncated-registry.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/truncated-stream-late-boundary.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/truncated-stream-template.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/truncated-stream.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/wait-asset-hydration.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/hydration/welcome-status-lazy.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/welcome-status-loaded.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/welcome-status-streamed.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/hydration/write-before-resume.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/inherited-dom-properties.spec.ts | 0 | 1 | Cannot find module '../src/client.js' |
| web/insert-falsy-sole-child-issue-3571.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/insert-flatten-needs-unwrap.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/insert-text-reuse.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/interaction-frame-per-event-3754.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/interaction-provenance.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/ispending-combined-atomic-3442.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/ispending-gated-landing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/ispending-memo-gate-3766.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/ispending-memo-unstamped-hold-3457.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/latest-async.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/latest-banner-landing-gap.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/latest-conditional-async-issue-3276.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/latest-ispending-issue-3041.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/latest-shadow-owned-write-issue-3378.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/call-driven-args.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/call-driven-lifecycle.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/call-driven-slots.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/container-args.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/document-adoption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/document-live-holes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/placeholder-mount.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lifecycle-matrix/remount.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/loading-fallback-in-flush-3540.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/loading-on-keyed-boundary-3540.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/loading-on-outside-reader-3412.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/loading-reset-collects-forwarded-3459.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/loading.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/lowercase-on-attribute.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/nested-render-effect-cleanup-issue-3404.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-confirm-holds-signal-3706.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-for-index-frame-f1.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-lazy-show-preview-3706.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-list-holes-f3-f5.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-mount-style-3835.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-move-keyed-show-3662.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-nested-show-drag-3706.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/optimistic-playground-port.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/performance-tracks.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/polymorphic-chain.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/portal.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/preload-links-adopt-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'render' not found |
| web/preload-links-frame-client.spec.ts | 0 | 1 | Cannot find module '../frames/src/frame-client.js' |
| web/projection-async-stream.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/refresh-hmr-flow.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/refresh-render.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/render-halt-recovery.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/repeat.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/runtime/chunk-reader-hardening.spec.ts | 0 | 1 | Cannot find module '../../server-functions/src/shared.js' |
| web/runtime/chunk-reader.spec.ts | 0 | 1 | Cannot find module '../../server-functions/src/shared.js' |
| web/select-multiple.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server-functions-live-loop.spec.tsx | 0 | 1 | Cannot find module '../server-functions/src/client.js' |
| web/server-mock.spec.tsx | 0 | 1 | Cannot find module '../src/server-mock.js' |
| web/server/client-hole-derived-async-3659.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/client-only-preload.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/concurrent-render-error-policy.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/concurrent-render-lazy-assets.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/concurrent-render-serialize.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/concurrent-render-trace.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/container-traces.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/diagnostics-server-scenario.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dist-server-artifact.spec.tsx | 0 | 1 | Cannot find module '../../dist/server.js' |
| web/server/dist-server-dev-artifact.spec.tsx | 0 | 1 | Cannot find module '../../dist/server.dev.js' |
| web/server/dist-server-treeshake.spec.tsx | 0 | 1 |  |
| web/server/document-face-arg-tiers.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/document-live-channel-artifact.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/document-live-holes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/document-shell.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-async-component-diagnostic.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-async-loading-3666.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-component-parity.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-hydration.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/dynamic-shell-gating.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-static.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/dynamic-xmlns.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/errored-loading-superseded-pass-3750.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/errored-sync-suspend-retry.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/escape-late-values.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/exports-server-conditions.spec.tsx | 0 | 9 | Cannot find module '@solidjs/web' |
| web/server/frame-binding-slots.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-fragment-error-outcome.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-get.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-hn.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-document-artifact.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-document.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-framing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-holes-chat.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-holes-projection.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-holes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-live-resume.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-nonlive-document-3666.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-plain-bound.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-server-component.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-ssr-seam.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-sweep-ops.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/frame-teardown.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/generic-hydration.gen.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hole-retry-shared-slot-3815.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/http-components.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hybrid-memo-handoff.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hybrid-store-handoff-3574.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hydration-harness.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hydration-payload-handled-rejection-3769.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/hydration-transfer.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/lazy-assets-livelock.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/lazy-nested-late-assets.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/lazy-shell-gating.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/live-shell-source-3764.gen.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/loading-dynamic-fragments.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/loading-recreated-async-source-3734.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/lowercase-on-attribute.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/nav-before-resume.gen.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/polymorphic-chain.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/projection-body-read.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/render-to-string-dispose.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/request-event-concurrent.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/response-invariants.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/retry-robustness.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/select-value.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-boundary-records.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-component-context.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-diagnostics.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-error-hook.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-frame-records.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-functions-abort-conforming-length.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-adapter-request.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-addressing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-body-buffering.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-body-cap-declaration-trust.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-body-formats.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-content-length.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-cors-origin.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-csrf.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-decoder-rejection-ownership.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-derived-locals.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-dev-rebind-grant.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-direct-provide-event-once.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-encode-hygiene.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-error-carrier-guard.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-event-hook.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-extensions.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-failure-sanitization.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-failure-signal.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-flash-bound-form.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flash-bounds.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flash-encryption.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flash-falsy-outcomes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-flash-key-derivation.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flash-url-bound.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flight-markup.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flight-result-ownership.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-flight-source-dedupe.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-format-version-skew.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-get-grant-binding.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-http-hygiene.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-invocation-wrap.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-invoke.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-live-framing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-live-lifetime.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-live-retry.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-negative-zero.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-nested-deferred-scope.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-nojs-destination.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-open-gaps.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-outcome-digest.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-proto-keys.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-redirect-scheme.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-redirect-status.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-registry-reload.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-request-bounds.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-request-event-scope.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-response-aliasing.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-result-descriptors.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-single-flight.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-transform-result-thrown.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-transport-failure.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-undefined-arguments.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-version-skew.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web/server-functions/server' |
| web/server/server-functions-wrap-invocation-validation.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-functions-wrap-nested-direct.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-observe-invocations.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/server-owner-walks.spec.tsx | 0 | 5 |  |
| web/server/server-render-route.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/server-trace.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/shared-async-sources.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/shell-suspend-loading-inline.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/slot-hydration-3567.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/spread-function-source.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/spread-hydration.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/spread-omit.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/spread-static-tail.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/spread-static-text.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-async-rejection-3569.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-async-rejection-3570.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-class-style-separators.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-class.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-element-names.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-element-nullish-attrs.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-element-sources.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/ssr-error-sanitization.spec.tsx | 0 | 22 |  |
| web/server/ssr-fragment-rejection-stub-batch.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-response-teardown-3768.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-serialized-rejection-stub-batch.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-stream.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/ssr-style-properties.spec.tsx | 0 | 1 | Cannot find module '../../src/server.js' |
| web/server/ssr-text-separators.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/stream-cancel-iterators-3626.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/stream-hang-nested-loading-3478.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/then-shell-suspend.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/tier-announce.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/tree-rewrite.spec.tsx | 0 | 1 | Cannot find module '../../frames/src/tree-rewrite.js' |
| web/server/use-head-loading.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/server/welcome-status-parity.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web' |
| web/server/write-before-resume.gen.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/show-in-for.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/show-optimistic-sync-write-3698.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/show.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/spread-enumerate.spec.tsx | 0 | 1 | SyntaxError: Export named 'spread' not found |
| web/spread-nodes.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/spread-nullish.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/spread-omit.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/spread-sources.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/spread-static-text.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/style-class-tracked.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/superseded-source-blocks-3462.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/switch.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/take-hydration-value.spec.ts | 0 | 1 | SyntaxError: Export named 'getHydrationWriter' not found |
| web/template-document-shell.spec.tsx | 0 | 1 | Cannot find module '../src/client.js' |
| web/trace-client.spec.tsx | 0 | 1 | SyntaxError: Export named 'getTraceContext' not found |
| web/use-head-css-gating-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/use-head-loading-client.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/wait-asset.spec.tsx | 0 | 1 | Cannot find module '../src/render.js' |
| web/wide-scope-insert-3739.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
| web/zombie-show-leak-3543.spec.tsx | 0 | 1 | Cannot find module '@solidjs/web
/jsx-dev-runtime' |
