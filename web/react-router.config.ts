import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // On the servers the storefront runs behind Caddy over plain http, so React Router sees
  // `http://…` while the browser's Origin is `https://…` and would refuse every form post.
  // These hosts may post; sameOriginMiddleware (app/lib/request.server.ts) still requires
  // the Origin to be exactly this environment's PUBLIC_WEB_URL.
  allowedActionOrigins: ["forgea-lab.com", "staging.forgea-lab.com"],
} satisfies Config;
