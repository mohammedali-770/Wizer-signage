# @wizer/dashboard

The web management console for **Wizer Signage**, a multi-tenant digital
signage SaaS platform. Built with **Next.js 15 (App Router)**, React 18 and
TypeScript.

> **Complete.** This note used to say the package was "the application shell
> only", with authentication and feature pages arriving in later phases. It
> ships login and invitation acceptance, the full company console (locations,
> screens, groups, tags, content, playlists, schedules, monitoring, reports,
> alerts, imports, exports) and the Super Admin console under `/admin`.

## Foundations

- **i18n** via `next-intl` v4 with the App Router `[locale]` segment.
  - Locales: `en` (default, LTR) and `ar` (RTL).
  - Message catalogues live in [`messages/`](./messages).
  - Locale negotiation handled by [`src/middleware.ts`](./src/middleware.ts).
- **RTL** — the `<html dir>` attribute is derived from the active locale in
  the locale layout, so Arabic renders right-to-left automatically.
- **Latin digits everywhere** — [`src/lib/format.ts`](./src/lib/format.ts)
  pins `numberingSystem: 'latn'` so numbers and dates always use Western
  digits (0-9), even in Arabic.
- **Theming** via `next-themes` (`class` strategy, `system` default) with
  CSS-variable design tokens defined in
  [`src/app/globals.css`](./src/app/globals.css) and surfaced through
  [`tailwind.config.ts`](./tailwind.config.ts).

## Scripts

| Script           | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Start the dev server on port `3000`.       |
| `pnpm build`     | Production build (standalone output).      |
| `pnpm start`     | Serve the production build on port `3000`. |
| `pnpm lint`      | Lint with `next lint`.                     |
| `pnpm typecheck` | Type-check with `tsc --noEmit`.            |

## Environment

Copy [`.env.example`](./.env.example) to `.env.local` and adjust as needed.
Only `NEXT_PUBLIC_*` variables are exposed to the browser. See
[`docs/environment-variables.md`](../../docs/environment-variables.md) for the
full reference.

## Project structure

```text
src/
  app/
    [locale]/
      layout.tsx     # html lang/dir, ThemeProvider, NextIntlClientProvider
      page.tsx       # Phase 0 placeholder landing
    globals.css      # Tailwind layers + design tokens
  components/
    locale-switcher.tsx
    theme-toggle.tsx
  i18n/
    routing.ts       # defineRouting (single source of truth)
    request.ts       # getRequestConfig + message loading
    navigation.ts    # locale-aware Link/redirect/router
  lib/
    cn.ts            # clsx + tailwind-merge
    format.ts        # Latin-digit number/date formatters
  middleware.ts      # next-intl locale middleware
messages/
  en.json
  ar.json
```

This package consumes the internal workspace packages
`@wizer/types`, `@wizer/shared` and `@wizer/ui`
directly as TypeScript source (no build step) via `transpilePackages`.
