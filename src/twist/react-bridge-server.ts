// React and Solid-style components in one tree, on the server: the bridge installed with the app's React.
import * as React from "react";
import { renderToString } from "react-dom/server";
import { installServerBridge } from "./bridge-server.ts";

installServerBridge(React as any, renderToString);
