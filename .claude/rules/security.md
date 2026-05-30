# Security

## No-Touch Zones

These files require **explicit approval** before any modification:

<!-- Customize per project. Examples: -->
<!-- - `src/crypto/Cryptographer.ts` — Encryption logic -->
<!-- - `src/billing/Calculator.ts` — Financial math -->
<!-- - `prisma/schema.prisma` — Database schema -->

- Any `.env*` files, deployment configs, or CI/CD workflows
- Database migration files
- Authentication/authorization configuration
- Cryptography or encryption modules
- Financial calculation modules

## Security Rules

- **NEVER hardcode secrets in source code**
- **NEVER run destructive DB operations** (DROP, TRUNCATE, DELETE without WHERE)
- **Validate all API input** — NEVER TRUST CLIENT INPUT (use Joi, Zod, or equivalent)
- **Flag security concerns proactively** — exposed secrets, SQL injection, missing auth, XSS, CSRF, etc.
- **ALL MONETARY VALUES ARE IN CENTS** (integers), never floating-point dollars — prevents rounding vulnerabilities
