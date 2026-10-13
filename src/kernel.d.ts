// Types for kernel.js: Twist's reactive graph, shared by its React and Solid APIs.
export declare const NO_READERS: readonly any[];
export declare const NOTHING_YET: readonly any[];
export declare function addReader(n: { observers: any }, o: any): void;
export declare function dropReader(n: { observers: any }, o: any): void;
export declare function readersOf(n: { observers: any }): number;
export declare function noteRead(c: { sources: any; seen: any }, source: { version: number }): boolean;
export declare function seenAt(c: { seen: any }, i: number): number;
