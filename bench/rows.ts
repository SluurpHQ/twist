// The benchmark's rows: the same labels every run (a fixed seed), for the browser apps and the server ones.
const A = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const C = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const N = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];
let seed = 1;
const rnd = (max: number) => ((seed = (seed * 16807) % 2147483647), seed % max);
let nextId = 1;
export const build = (count: number) =>
  Array.from({ length: count }, () => ({ id: nextId++, label: `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}` }));
