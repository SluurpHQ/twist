import twist from "@sluurp/twist/vite";

// React components and Solid-style ones in one tree: on Twist's React (one runtime), or with MIXED_REACT=react on
// React's own (Twist for the Solid-style parts only).
export default { plugins: [twist({ react: process.env.MIXED_REACT === "react" ? true : "twist" })] };
