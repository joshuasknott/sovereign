import type { APIRoute } from "astro";

import { GITHUB_REPOSITORY_URL } from "../lib/site";
import { absoluteUrl, SITE_NAME, SITE_TAGLINE } from "../lib/seo";

// https://llmstxt.org: a plain index describing Sovereign and its open-source lineage.
export const GET: APIRoute = () => {
  const body = `# ${SITE_NAME}

> ${SITE_TAGLINE}. ${SITE_NAME} is free, MIT-licensed, and runs Claude Code, Codex, Cursor, OpenCode, Grok, Antigravity, and other coding agents from one desktop, web, and mobile app.

${SITE_NAME} is an independent open-source project built upon T3 Code under the MIT License (Copyright (c) 2026 T3 Tools Inc.) and is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

## Links

- [Download ${SITE_NAME}](${absoluteUrl("/download")}): macOS, Windows, and Linux builds
- [Source code](${GITHUB_REPOSITORY_URL}): the MIT-licensed repository
- [Releases](${GITHUB_REPOSITORY_URL}/releases): release builds and changelogs

## Policies

- [Security policy](${absoluteUrl("/security-policy")})
- [Privacy policy](${absoluteUrl("/privacy-policy")})
- [Terms of service](${absoluteUrl("/terms-of-service")})
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
