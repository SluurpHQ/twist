// Twist reads its tiers from NODE_ENV (Solid's build defines __DEV__ / __OBSERVE__ / __TEST__).
declare const process: { env: Record<string, string | undefined> };
