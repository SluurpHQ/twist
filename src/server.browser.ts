// react-dom/server.browser (and .edge): the server renderer, its string renders naming the web streams API.
import { renderToStaticMarkup as staticMarkup, renderToString as toString } from "./server.ts";

export * from "./server.ts";
export const renderToString = (node: any, options?: any) => toString(node, options, "renderToReadableStream");
export const renderToStaticMarkup = (node: any, options?: any) => staticMarkup(node, options, "renderToReadableStream");
