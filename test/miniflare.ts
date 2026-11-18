import { createRequire } from 'node:module';

import type { D1LikeDatabase } from '../src/db/d1.js';

export interface MiniflareHandle {
  database: D1LikeDatabase;
  dispose: () => Promise<void>;
}

interface PlatformProxyHandle {
  env: { DB: D1LikeDatabase };
  dispose: () => Promise<void>;
}

/** Local D1 from Wrangler's Miniflare proxy. No Cloudflare account and no network. */
export async function startMiniflare(): Promise<MiniflareHandle> {
  const require = createRequire(import.meta.url);
  const wrangler = require('wrangler') as {
    getPlatformProxy: (options: {
      configPath: string;
      persist: false;
      remoteBindings: false;
    }) => Promise<PlatformProxyHandle>;
  };
  const proxy = await wrangler.getPlatformProxy({
    configPath: new URL('../wrangler.jsonc', import.meta.url).pathname,
    persist: false,
    remoteBindings: false,
  });
  return {
    database: proxy.env.DB,
    dispose: () => proxy.dispose(),
  };
}
