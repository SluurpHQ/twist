// Ported from Solid's frames/src/regions-tier.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
/** `@solidjs/web/frames/regions` — the frames client's REGIONS tier (frames */
// The eager frames client — the SHARED instance the app runs (external in the
import { createFrame } from "./client.ts";
// Pure DOM helpers, bundled into this chunk as their own copy (no module
import { eachInRange, isFrameElement, makeFrameElement, FRAME_ID_ATTR } from "./frame-client.ts";

/** One region of an occurrence: its wire id, its element, the frame bound */
interface RegionEntry {
  childId: string;
  element: Element;
  frame: any;
  adopt?: boolean;
}
type Regions = Map<string, RegionEntry>;

// Per frame: occurrence -> (arg name -> entry).
const byFrame = new WeakMap<object, Map<string, Regions>>();

const regionsFor = (frame: any, occurrence: string): Regions => {
  let slots = byFrame.get(frame);
  if (!slots) byFrame.set(frame, (slots = new Map()));
  let regions = slots.get(occurrence);
  if (!regions) slots.set(occurrence, (regions = new Map()));
  return regions;
};

/** Collect the OUTERMOST frame region elements in `node`'s subtree into */
function collectRegionElements(node: Node, regions: Regions): void {
  if (node.nodeType !== 1) return;
  if (isFrameElement(node)) {
    const childId = (node as Element).getAttribute(FRAME_ID_ATTR);
    // Region ids are dotted (`<producer frame>.<occurrence>.<arg>`); bare ids
    if (childId && childId.includes(".")) {
      const argKey = childId.slice(childId.lastIndexOf(".") + 1);
      if (!regions.has(argKey))
        regions.set(argKey, { childId, element: node as Element, frame: undefined, adopt: true });
    }
    return;
  }
  for (let c = node.firstChild; c; c = c.nextSibling) collectRegionElements(c, regions);
}

/** Element discovery for the adopt path — claim wiring only (A5): the t=0 */
function discover(frame: any, occurrence: string, start: unknown): void {
  if (!start || Array.isArray(start)) return;
  const regions = regionsFor(frame, occurrence);
  eachInRange(start, occurrence, (n: Node) => collectRegionElements(n, regions));
}

/** Point a cached region entry at a new wire name: the identity (occurrence, */
function rename(entry: RegionEntry, childId: string): void {
  entry.childId = childId;
  if (entry.frame) entry.frame.rebind(childId);
  else entry.element.setAttribute(FRAME_ID_ATTR, childId);
}

/** The `{$frame}` arm of a frame's arg resolution: for each region arg of */
export function resolve(
  frame: any,
  occurrence: string,
  regions: Record<string, string>,
  props: Record<string, unknown>,
  start?: unknown
): void {
  if (start) discover(frame, occurrence, start);
  const cache = regionsFor(frame, occurrence);
  for (const key in regions) {
    const childId = regions[key];
    let entry = cache.get(key);
    if (!entry)
      cache.set(key, (entry = { childId, element: makeFrameElement(childId), frame: undefined }));
    else if (entry.childId !== childId) rename(entry, childId);
    props[key] = entry.element;
  }
}

/** Bind a frame over each of the occurrence's region elements that has none */
export function bind(frame: any, occurrence: string): void {
  const regions = byFrame.get(frame)?.get(occurrence);
  if (!regions) return;
  const o = frame.options;
  for (const entry of regions.values()) {
    if (!entry.frame) {
      entry.frame = createFrame(entry.element, {
        id: entry.childId,
        host: o.host,
        // Regions discovered from adopted document elements already hold
        adopt: entry.adopt,
        claimScope: o.claimScope ?? o.id,
        // Element-claim sweeps in the region bind cleanup to the same
        ownerScope: o.ownerScope,
        parent: frame
      } as any);
    }
  }
}

/** Dispose the frames bound over an occurrence's regions and forget them; */
export function unmount(frame: any, occurrence?: string): void {
  const slots = byFrame.get(frame);
  if (!slots) return;
  const dispose = (regions: Regions) => {
    for (const { frame: bound } of regions.values()) bound?.dispose();
  };
  if (occurrence === undefined) {
    for (const regions of slots.values()) dispose(regions);
    byFrame.delete(frame);
  } else {
    const regions = slots.get(occurrence);
    if (regions) {
      dispose(regions);
      slots.delete(occurrence);
    }
  }
}

/** For the staged preview (`Frame.preview`): whether the record adds a */
export function changed(
  frame: any,
  occurrence: string,
  record: { regions?: Record<string, string> }
): boolean {
  const regions = byFrame.get(frame)?.get(occurrence);
  for (const key in record.regions) {
    const entry = regions && regions.get(key);
    if (!(entry && entry.childId === record.regions[key])) return true;
  }
  return false;
}

/** The frames bound over the frame's regions (the staged preview recurses */
export function frames(frame: any): any[] {
  const out: any[] = [];
  const slots = byFrame.get(frame);
  if (slots)
    for (const regions of slots.values())
      for (const { frame: bound } of regions.values()) if (bound) out.push(bound);
  return out;
}
