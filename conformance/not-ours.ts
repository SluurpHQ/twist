// React tests set aside: they check React's internals we do not share, or what the test DOM (happy-dom) cannot do.
// Each is skipped by name in its file (setup.ts) and counted apart in the report. Keep the reason with each.

const RETRY = "React renders the whole tree once more after an error before committing; we render once";
const OUTSIDE = "React's behaviour when the DOM it owns was changed by hand, outside React";
const HAPPY_DOM = "happy-dom cannot do this (React's suite runs in jsdom)";
const V8_FORMAT = "checks a V8 stack-frame format or a call count of React's own";
const ONE_PACKAGE = "checks that separately installed react and react-dom packages agree on a version; ours are one package";
const SHIM_FALLBACK = "checks use-sync-external-store's fallback for a React without useSyncExternalStore; ours always has it";

export const NOT_OURS: Record<string, Record<string, string>> = {
  "react-dom/ReactErrorBoundaries-test.internal.js": {
    "does not call componentWillUnmount when aborting initial mount": RETRY,
    "catches if child throws in constructor during update": RETRY,
    "catches if child throws in componentWillMount during update": RETRY,
    "catches if child throws in componentWillReceiveProps during update": RETRY,
    "catches if child throws in componentWillUpdate during update": RETRY,
    "catches if child throws in render during update": RETRY,
    "keeps refs up-to-date during updates": RETRY,
    "calls static getDerivedStateFromError for each error that is captured": RETRY,
    "renders empty output if error boundary does not handle the error": RETRY,
  },
  "react-dom/ReactDOMForm-test.js": {
    "sync errors in form actions can be captured by an error boundary": RETRY,
    "async errors in form actions can be captured by an error boundary": RETRY,
    "useActionState: error handling (sync action)": RETRY,
    "useActionState: error handling (async action)": RETRY,
    "useActionState: when an action errors, subsequent actions are canceled": RETRY,
  },
  "react-dom/ReactDOMFiber-test.js": {
    "should warn when replacing a container which was manually updated outside of React": OUTSIDE,
    "should not warn when doing an update to a container manually updated outside of React": OUTSIDE,
    "should not warn when doing an update to a container manually cleared outside of React": OUTSIDE,
    "should render a text component with a text DOM node on the same document as the container": HAPPY_DOM + " (iframe documents)",
    "should restore selection in the correct window": HAPPY_DOM + " (iframe windows)",
  },
  "react-dom/ReactDOMInput-test.js": {
    "should control radio buttons": HAPPY_DOM + " (radio groups across forms)",
    "should hydrate controlled radio buttons": HAPPY_DOM + " (radio groups across forms)",
    "should hydrate uncontrolled radio buttons": HAPPY_DOM + " (radio groups across forms)",
  },
  "react-dom/ReactDOMServerIntegrationElements-test.js": {
    "renders a math element with server string render": HAPPY_DOM + " (MathML parsing)",
    "renders a math element with server stream render": HAPPY_DOM + " (MathML parsing)",
    "renders a math element with client render on top of good server markup": HAPPY_DOM + " (MathML parsing)",
    "renders a noscript with children with server string render": HAPPY_DOM + " (noscript parsing)",
    "renders a noscript with children with server stream render": HAPPY_DOM + " (noscript parsing)",
    "renders a noscript with children with client render on top of good server markup": HAPPY_DOM + " (noscript parsing)",
  },
  "react-dom/ReactServerRenderingHydration-test.js": {
    "should ignore noscript content on the client and not warn about mismatches": HAPPY_DOM + " (noscript parsing)",
  },
  "react-dom/ReactDOMServerIntegrationAttributes-test.js": {
    "renders badly cased SVG attribute with a warning with server string render": HAPPY_DOM + " (SVG attribute case on parsing)",
    "renders badly cased SVG attribute with a warning with server stream render": HAPPY_DOM + " (SVG attribute case on parsing)",
    "renders badly cased SVG attribute with a warning with client render on top of good server markup": HAPPY_DOM + " (SVG attribute case on parsing)",
  },
  "react-dom/ReactDOMServerIntegrationUntrustedURL-test.js": {
    "renders a javascript protocol frame src with server string render": HAPPY_DOM + " (frameset parsing)",
    "renders a javascript protocol frame src with server stream render": HAPPY_DOM + " (frameset parsing)",
    "renders a javascript protocol frame src with client render on top of bad server markup": HAPPY_DOM + " (frameset parsing)",
    "renders only the first invocation of toString with clean client render": V8_FORMAT,
  },
  "react-dom/ReactDOMSingletonComponents-test.js": {
    "renders into html, head, and body persistently so the node identities never change and extraneous styles are retained": V8_FORMAT,
  },
  "use-sync-external-store/useSyncExternalStoreShimServer-test.js": {
    "basic server render": SHIM_FALLBACK,
  },
  "use-sync-external-store/useSyncExternalStoreNative-test.js": {
    "native version": SHIM_FALLBACK + " (React Native's)",
    "Using isEqual to bailout": SHIM_FALLBACK + " (React Native's)",
  },
  "react/ReactMismatchedVersions-test.js": {
    'importing "react-dom/client" throws if version does not match React version': ONE_PACKAGE,
    'importing "react-dom/static.browser" throws if version does not match React version': ONE_PACKAGE,
    'importing "react-dom/static.edge" throws if version does not match React version': ONE_PACKAGE,
  },
  "react/ReactClassEquivalence-test.js": {
    "tests the same thing for es6 classes and CoffeeScript": "runs React's own Jest on its CoffeeScript test copy",
    "tests the same thing for es6 classes and TypeScript": "runs React's own Jest on its TypeScript test copy",
  },
  "react/ReactJSXTransformIntegration-test.js": {
    "sanity check: test environment is configured to compile JSX to the jsx() runtime": "reads compiled source: Bun names the import jsxDEV_<hash>, Babel jsxDEV",
  },
  "react-dom/ReactDOMFizzServer-test.js": {
    "supports iterable": "needs the 'immutable' package, not installed",
    'the "S" in "</?[Ss]cript" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters':
      HAPPY_DOM + " (script parsing after <!--)",
  },
};
