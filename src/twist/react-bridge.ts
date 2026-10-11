// React and Solid-style components in one tree, in the browser: the bridge installed with Twist's React. The Vite
// plugin imports this where a file of one kind imports a component of the other.
import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { installBridge } from "./bridge.ts";

installBridge(React as any, createRoot as any, hydrateRoot as any);
