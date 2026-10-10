// The bridge's tests: a DOM (React is given to the bridge by the test).
import { GlobalRegistrator } from "../../conformance/node_modules/@happy-dom/global-registrator/lib/index.js";

GlobalRegistrator.register({ url: "http://localhost/" });
