# Phase 0 license and notice obligations

## Comp and internal workspace packages

`@crm/auth`, `@crm/db`, `@crm/env`, `@crm/telemetry`, and `@crm/ui` are private, version `0.0.0` workspace packages contained in the pinned Comp repository. They are first-party components, not independently sourced third-party packages. Their source is covered by the repository-level MIT license.

Copies or substantial portions must retain:

> Copyright (c) 2026 Comp AI

They must also include the complete MIT permission and warranty notice from the root `LICENSE`. No separate package-level NOTICE file exists. Independent publication of any internal package should add explicit `license: MIT` metadata and include the root license text, but the absent manifest fields do not create a Phase 0 legal blocker.

## Eve

Eve `0.29.4` is Apache-2.0. A redistribution must include the Apache-2.0 license, retain applicable copyright, patent, trademark, and attribution notices, identify modified distributed files, and reproduce Eve's installed NOTICE attribution:

> eve  
> Copyright 2026 Vercel, Inc. and contributors  
> This product includes software developed at Vercel, Inc. (https://vercel.com/).

## PostHog browser package

`posthog-js` declares `(Apache-2.0 AND MIT)` because its distribution includes Apache-2.0 PostHog code and specifically identified MIT-derived portions from Sentry, Meta Metro, Expo, and AgentCat. Distributions must preserve the package's complete installed `LICENSE` file and applicable source headers. No incompatible or copyleft term was identified.

## Legal review boundary

No external legal confirmation is required to resolve the five internal workspace-package entries. Legal review is required if IBL changes the intended redistribution model, publishes the internal packages separately without the MIT text, removes third-party notice material, or plans branding that depends on upstream trademarks.
