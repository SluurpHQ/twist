/** This platform as Twist's compiler addons are named: os, cpu, and the C library where it matters. */
export function platformName() {
  const { platform, arch } = process;
  if (platform === "win32") return `win32-${arch}-msvc`;
  if (platform !== "linux") return `${platform}-${arch}`;
  // (No glibc version in Node's report: musl.)
  const glibc = process.report?.getReport?.()?.header?.glibcVersionRuntime;
  return `linux-${arch}-${glibc ? "gnu" : "musl"}`;
}
