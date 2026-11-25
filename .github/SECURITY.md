# Security Policy

## Reporting a Vulnerability in Sovereign

If you discover a security vulnerability in **Sovereign** (including governance bypasses, webhook signature verification bugs, SSRF escapes, secret exposure, or authentication flaws), please report it privately through this repository's private security advisory channel rather than opening a public issue.

Please include:

- The affected component and file path(s)
- The precondition and actor model (see [SECURITY.md](../SECURITY.md))
- Minimal reproduction steps or a deterministic test case

Do not test exploits against live user data directories or third-party systems without explicit written authorisation.

## Upstream T3 Code Vulnerabilities

Sovereign is an independent project derived from the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) source code (`Copyright (c) 2026 T3 Tools Inc.`) and is not affiliated with T3 Tools, Inc. If you discover a vulnerability that affects upstream T3 Code itself, please report it directly to the upstream T3 Code maintainers via their published security policy.
