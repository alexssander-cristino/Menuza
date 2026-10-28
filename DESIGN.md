# Menuza — UI Design System

## Direction
Premium, food-first digital menu. Editorial whitespace, warm light surfaces, deep plum ink and violet accents. Motion should clarify interaction, never compete with food imagery or ordering.

## Framework constraints
The current storefront is vanilla JavaScript + CSS with a Node.js server. Use framework-free equivalents of React Bits, shadcn/ui and Magic UI patterns unless a deliberate migration is approved. Do not add React/Tailwind as a partial dependency to the existing app.

## Tokens
- Background: #f6f5f9
- Surface: #fcfcfd
- Ink: #1b1530
- Secondary ink: #3b2f5c
- Primary: #5b3be0
- Primary hover: #4a2fc4
- Primary soft: #ece8fd
- Muted: #736f82
- Border: #e3e0ea
- Radius: 8px controls, 14px cards, 22px large panels, pill for chips
- Focus ring: 3px violet with offset
- Motion: 180–320ms for controls; slower ambient motion only in decorative areas
- Content width: 1190px; mobile gutters: 16px

## Component rules
- Buttons: clear primary/secondary hierarchy, visible focus, tactile pressed state.
- Cards: food artwork first, consistent image ratio, subtle elevation and hover spotlight on pointer devices.
- Inputs: visible label, clear focus ring, no layout shift on focus.
- Filters: pill-shaped, active state must be conveyed with text and aria-pressed.
- Dialogs and sheets: preserve keyboard close/focus behavior and touch-scrollable mobile content.
- Legal/help pages: same typography, spacing, surfaces and focus behavior as storefront.
- Motion: always respect prefers-reduced-motion; avoid continuous high-cost canvas/WebGL effects on mobile.
- Accessibility: preserve semantic HTML, keyboard navigation, contrast, reduced-motion support and accessible names.
- Responsive: test at 360px width first; never introduce horizontal page scrolling.

## Reference inspirations
- React Bits: split/reveal text and interaction patterns, selectively adapted to CSS/vanilla JS.
- shadcn/ui: composable controls, consistent focus states and accessible interaction behavior.
- Magic UI: subtle shimmer, spotlight cards and ambient gradients.
- GetDesign.md: shared design contract to keep new and existing screens visually consistent.
