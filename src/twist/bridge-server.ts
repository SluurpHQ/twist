// The bridge on the server.
// - A Solid-style component in a React page is drawn by Twist's server renderer, its HTML put in <sluurp-twist> for the
//   browser's TwistHost to hydrate (with the same id, React's useId).
// - A React component in a Solid-style tree is drawn by React's server renderer, its HTML put in <sluurp-react> for the
//   browser's Twist to claim and hydrate; Twist children given to it are drawn by Twist, in <sluurp-twist>.
import { createComponent, isTwist, setForeignComponent, setReactHost } from "./server/control.ts";
import { html, renderToString } from "./server.ts";
import { untrack } from "./server/signals.ts";

type ReactApi = { createElement: (...a: any[]) => any; useId: () => string };

/** Both ways drawn on this server from now on, with the app's React and its server renderer's renderToString. */
export function installServerBridge(react: ReactApi, reactToString: (element: any) => string) {
  const { createElement, useId } = react;
  function TwistServerHost({ component, props }: { component: (p: any) => any; props: Record<string, any> }) {
    const id = useId();
    const out = renderToString(() => createComponent(component, props), { renderId: id });
    return createElement("sluurp-twist", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: out } });
  }
  setReactHost((component, props) => createElement(TwistServerHost, { component, props }));

  setForeignComponent((type, props) => {
    if (isTwist(type)) return createComponent(type, props);
    const given: Record<string, any> = {};
    for (const k of Object.keys(props)) {
      const v = untrack(() => props[k]);
      // Twist content as a child: drawn here, given to React as the HTML it is.
      given[k] = k === "children" && v != null && typeof v === "object" && !("$$typeof" in v)
        ? createElement("sluurp-twist", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: html(v, false) } })
        : v;
    }
    return { t: `<sluurp-react style="display:contents">${reactToString(createElement(type, given))}</sluurp-react>` };
  });
}
