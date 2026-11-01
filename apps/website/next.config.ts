import type { NextConfig } from 'next';

const config: NextConfig = {
  // The domain package ships TypeScript source rather than a build artifact,
  // so Next compiles it as part of the app. One fewer build step, and the
  // engine stays directly debuggable from the site.
  transpilePackages: ['@rep/domain', '@rep/persistence'],
  reactStrictMode: true,
};

export default config;
