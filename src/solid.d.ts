// Solid's module names, typed as Twist answers them (modules.js, SOLID): an editor knows `solid-js` without Solid
// installed. Named in a tsconfig's "types" as "@sluurp/twist/solid-types". An app with solid-js installed gets its types.
declare module "solid-js" {
  export * from "@sluurp/twist";
}
declare module "solid-js/store" {
  export * from "@sluurp/twist/store";
}
declare module "@solidjs/web" {
  export * from "@sluurp/twist/web";
}
declare module "@solidjs/web/jsx-runtime" {
  export * from "@sluurp/twist/jsx-runtime";
}
declare module "@solidjs/web/jsx-dev-runtime" {
  export * from "@sluurp/twist/jsx-dev-runtime";
}
