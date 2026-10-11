// React and Solid-style components in one tree, in the browser: the bridge installed with the app's React (Twist's,
// or React's own). The Vite plugin imports this in every Solid-style file of an app that has React too.
import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { installBridge } from "./bridge.ts";

installBridge(React as any, createRoot as any, hydrateRoot as any);
