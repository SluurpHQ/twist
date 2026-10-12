// Ported from Solid's signals attribution engine (MIT, Ryan Carniato and contributors): same behaviour, Twist's nodes.
// `solid-js/attribution` on Twist: the "why did this run" engine (development tooling). Its folds and point queries
// are their own modules: a consumer that only listens to records never loads them.
export { attribution, formatOrigin, formatRerun, graphSize } from "./attribution.ts";
export { costs } from "./attribution-costs.ts";
export { feedback } from "./attribution-feedback.ts";
export { subscriptions, why } from "./attribution-queries.ts";
export type {
  Acknowledgement,
  Attribution,
  AttributionOptions,
  AttributionValues,
  ChangeKind,
  ChangeOrigin,
  ChangeRecord,
  CreateEvent,
  EffectRunEvent,
  FallbackEvent,
  FlightEvent,
  FlightLink,
  FlushEvent,
  GraphEvent,
  GraphSize,
  HeldWrite,
  HistoryRecords,
  HistoryType,
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  NavigationHop,
  RerunEvent,
  WaterfallRecord,
} from "./attribution.ts";
export type { AttributionCostTables, ScopeCost, WriteCost } from "./attribution-costs.ts";
export type { AttributionFeedbackTables, FallbackStats, FeedbackInteraction, FeedbackNavigation, FeedbackSource, FlightStats } from "./attribution-feedback.ts";
