# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-16
- Primary product surfaces: Next.js admin dashboard, tenant admin, job queue, post preview, social video workflow.
- Evidence reviewed: `apps/admin-next/components/DashboardClient.tsx`, `apps/admin-next/components/TenantClient.tsx`, `apps/admin-next/components/JobsClient.tsx`, `apps/admin-next/components/PostDetailClient.tsx`, `apps/admin-next/app/globals.css`, `apps/admin-next/README.md`, `docs/SOCIAL_VIDEO_PIPELINE.md`.

## Brand
- Personality: calm, operational, checklist-first, non-technical.
- Trust signals: clear progress, visible completion states, reversible actions, generated output previews.
- Avoid: exposing internal table names, developer-oriented payloads in primary flows, long tab rows, unexplained provider/model settings.

## Product goals
- Goals: help a non-developer create and manage SEO articles, turn articles into shorts packages, and track work completion from one screen.
- Non-goals: full external publishing automation in the primary UI before channel credentials are connected.
- Success signals: a new user can identify the next action in under 10 seconds, create one test article without reading documentation, and see whether each stage is complete.

## Personas and jobs
- Primary personas: solo operator, blogger, small business owner, technical owner configuring advanced settings.
- User jobs: set up a content domain, create article ideas, run one safe test article, review finished posts, create social packages, monitor failed work.
- Key contexts of use: desktop admin during setup, repeated daily content operations, occasional mobile status checks.

## Information architecture
- Primary navigation: dashboard -> tenant -> easy progress workflow.
- Core routes/screens: dashboard, tenant easy progress, posts, shorts, jobs, advanced settings tabs.
- Content hierarchy: next action first, completion checklist second, generated assets third, advanced controls last.

## Design principles
- Principle 1: Default to a guided checklist, not a configuration console.
- Principle 2: Separate daily operations from setup/advanced settings.
- Tradeoffs: advanced controls remain available but are placed behind an "advanced" area so the primary flow stays approachable.

## Visual language
- Color: use the existing neutral admin palette with green for complete and primary purple for the next action.
- Typography: system sans, compact operational headings, no hero-scale type inside admin panels.
- Spacing/layout rhythm: dense but scannable cards, consistent 16px gaps, full-width workflow bands.
- Shape/radius/elevation: existing cards and buttons, no new decorative layers.
- Motion: no required motion; status changes should be visible without animation.
- Imagery/iconography: use check symbols and badges for task status; no decorative imagery in admin.

## Components
- Existing components to reuse: `card`, `btn`, `badge`, `tabs`, `workflow`, `writer-hint`, tables.
- New/changed components: easy progress strip, checklist task cards, advanced settings drawer, simplified dashboard create form.
- Variants and states: complete, current, locked/empty, failed, queued/running.
- Token/component ownership: `apps/admin-next/app/globals.css` owns global admin component styles.

## Accessibility
- Target standard: practical WCAG AA for contrast, keyboard focus, and semantic controls.
- Keyboard/focus behavior: buttons and details/summary must remain keyboard operable.
- Contrast/readability: muted text only for support copy; primary action labels must be high contrast.
- Screen-reader semantics: use buttons for actions and native `details` for advanced disclosure.
- Reduced motion and sensory considerations: avoid relying on animation to communicate progress.

## Responsive behavior
- Supported breakpoints/devices: desktop-first, usable on tablet/mobile.
- Layout adaptations: multi-column checklist collapses to one column below 980px.
- Touch/hover differences: task cards and buttons must have stable size and not rely on hover-only information.

## Interaction states
- Loading: show existing loading card.
- Empty: explain the next concrete action, not just "empty".
- Error: use existing `toast-error`.
- Success: show green badges/check marks and advance the next recommended action.
- Disabled: disabled buttons must have nearby reason text or be paired with a prerequisite checklist item.
- Offline/slow network, if applicable: job queue remains the status surface after async actions.

## Content voice
- Tone: direct Korean operational language.
- Terminology: use "글", "글 후보", "완성 글", "숏츠", "작업 상태"; avoid "slot", "payload", "manifest" in primary UI.
- Microcopy rules: every primary action should answer "what happens when I click this?"

## Implementation constraints
- Framework/styling system: Next.js app router, React client components, plain CSS in `globals.css`.
- Design-token constraints: reuse existing CSS variables and classes.
- Performance constraints: avoid adding new dependencies; keep tenant detail page client-side data flow unchanged.
- Compatibility constraints: keep existing advanced tabs routable through local tab state.
- Test/screenshot expectations: run typecheck/build and browser-smoke the tenant page after UI changes.

## Open questions
- [ ] Should the app eventually support a true one-click "make my first article" preset for a new tenant? Owner: product. Impact: could remove even more setup steps.
