---
name: Institutional Assurance
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#44474d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#75777e'
  outline-variant: '#c5c6ce'
  surface-tint: '#515f7a'
  primary: '#000412'
  on-primary: '#ffffff'
  primary-container: '#0f1e36'
  on-primary-container: '#7886a3'
  inverse-primary: '#b8c7e6'
  secondary: '#515f74'
  on-secondary: '#ffffff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#57657b'
  tertiary: '#000315'
  on-tertiary: '#ffffff'
  tertiary-container: '#001950'
  on-tertiary-container: '#4c7eff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e3ff'
  primary-fixed-dim: '#b8c7e6'
  on-primary-fixed: '#0c1b33'
  on-primary-fixed-variant: '#394761'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#dbe1ff'
  tertiary-fixed-dim: '#b4c5ff'
  on-tertiary-fixed: '#00174b'
  on-tertiary-fixed-variant: '#003ea8'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.375rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.125rem
  label-md:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.05em
  tabular-data:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system establishes an institutional, regulatory-grade visual environment for high-volume enterprise compliance operations. Tailored for corporate KYC analysts, audit leads, and risk officers, the aesthetic eliminates decorative artifice in favor of rigorous precision, unyielding predictability, and dense information architecture.

The core philosophy combines Corporate Modernism with High-Density Functionalism:
- **Authority & Restraint:** Grounded in deep maritime navy, slate structuring, and neutral cool grey fields.
- **Audit Readiness:** Every screen state prioritizes absolute data legibility, clear ownership markers, and explicit workflow lineages.
- **Cognitive Hygiene:** Color is deployed strictly as semantic instrumentation—never as aesthetic filler. Status states (Overdue, Escalated, Pending Review, Complete) demand instant visual parsing under zero-ambiguity thresholds.
- **Institutional Weight:** High-contrast structural line work, disciplined 4px grid increments, and tight neo-grotesque type scales evoke the permanence and security of tier-one global banking infrastructure.

## Colors

The palette establishes an unambiguous hierarchy between primary surfaces, interactive anchors, and operational alerts. All foreground/background pairings exceed WCAG 2.1 AA requirements (4.5:1 for standard text, 3:1 for graphical UI elements and tabular numerals).

### Core Palette
- **Primary Navy (`#0F1E36` / `#1E2D4A`):** Anchors global navigation, primary command triggers, high-emphasis entity titles, and active audit identifiers.
- **Secondary Slate (`#334155` / `#475569`):** Governs table headers, subheadings, supporting metadata keys, and secondary action framing.
- **Tertiary Action Blue (`#2563EB` / `#EFF6FF`):** Reserved for interactive linkages, active draft selection, and workflow routing actions.
- **Neutral Canvas & Structural Grid:**
  - Base Canvas: `#F8FAFC`
  - Elevated Container / Table Row Alt: `#F1F5F9`
  - Subtle Dividing Line: `#E2E8F0`
  - Input & Card Perimeter Border: `#CBD5E1`

### Semantic Alert Tiers
Alert tokens employ a mandatory tri-layer pattern (dark text, tint wash background, precise bounding border) to eliminate false positives during high-speed triage:
- **Due Imminent / Warning:** Text `#B45309`, Icon/Dot `#D97706`, Background `#FEF3C7`, Border `#FCD34D`.
- **Critical / Overdue / Blocked:** Text `#B91C1C`, Icon/Dot `#DC2626`, Background `#FEE2E2`, Border `#FCA5A5`. Used strictly for SLA breaches and KYC blockades.
- **Verified / Satisfied / Complete:** Text `#047857`, Icon/Dot `#059669`, Background `#D1FAE5`, Border `#6EE7B7`.
- **Draft / In Review / Request Sent:** Text `#1D4ED8`, Icon/Dot `#2563EB`, Background `#EFF6FF`, Border `#BFDBFE`.

## Typography

The typographic system utilizes a singular, highly legible neo-grotesque family across all roles to maintain zero visual friction across complex nested layouts.

- **Tabular Figures:** All financial balances, registration numbers, case IDs, and timestamps must render with `font-feature-settings: "tnum" 1, "cv05" 1, "cv08" 1` enabled, ensuring perfect vertical column alignment.
- **Hierarchy & Case Usage:** Labels and column headers employ uppercase tracking (`0.04em` to `0.05em`) at `0.75rem` or `0.6875rem` to immediately differentiate descriptors from mutable case data.
- **Headline Discipline:** Display sizes are deliberately constrained (capping at `1.75rem`) to maximize screen utility and prevent headline wrapping inside dense multi-pane interfaces.

## Layout & Spacing

The layout operates on a disciplined 4px/8px coordinate system optimized for dense operational surfaces:

- **Desktop Workspace:** 12-column grid utilizing fixed side navigation panels (240px default, collapsable to 64px icon-only), with fluid data staging areas spanning remaining canvas dimensions.
- **Data Worksurfaces:** Workspaces feature a standard split-pane ratio (60% case overview and document tracking, 40% verification inspector and audit trail).
- **Margins & Gutters:** Global margins maintain a rigid `1.5rem` offset. Gutters between cards and grid cells are set to `1rem` on standard views and compress to `0.5rem` (`space-sm`) inside nested case dossiers.
- **Reflow & Density:** On displays below 1280px, secondary panes collapse to right-hand drawer overlays. Desktop tabular views maintain a minimum horizontal cell clearance of `0.75rem` (`space-md`) to ensure dense scanning without overlapping data fields.

## Elevation & Depth

This system avoids expressive drop shadows, relying instead on structural borders, micro-elevation shifts, and crisp tonal layering to establish physical depth.

- **Level 0 (Base Canvas):** `#F8FAFC` flat surface.
- **Level 1 (Card & Row Surfaces):** Pure white (`#FFFFFF`) bound by a 1px solid border (`#CBD5E1`). No box shadow is applied in neutral states.
- **Level 2 (Active Focus & Flyouts):** Used for contextual filter menus and timeline tooltips. Bounded by a 1px border (`#94A3B8`) and an ambient, un-diffused shadow: `0 1px 3px rgba(15, 30, 54, 0.08), 0 1px 2px rgba(15, 30, 54, 0.04)`.
- **Level 3 (Modals & Approval Drawers):** Used strictly for high-impact sign-offs and review-before-send modals. Backed by a structural overlay (`#0F1E36` at 40% opacity) and defined by `0 8px 16px -4px rgba(15, 30, 54, 0.12), 0 4px 6px -2px rgba(15, 30, 54, 0.06)`.

## Shapes

Shapes reflect precision and structural discipline. Every geometric entity is tuned to roundedness level `1` (Soft):

- **Standard Elements (0.25rem / 4px):** Applied to inputs, buttons, checklist rows, audit event cards, and status chips.
- **Containers & Surfaces (0.5rem / 8px):** Applied to top-level cards, data table wrappers, and review modals (`rounded-lg`).
- **Pill Exception (Full Round / 9999px):** Applied strictly to the circular status indicators and numerical counter pills embedded inside badge components.

## Components

### Status Chips
- Built with a 4px corner radius, containing an uppercase label (`label-sm`, `0.6875rem`) preceded by a 6px solid circular status dot.
- Height is fixed at 22px; padding is `2px 8px`.
- Four strict variants:
  - *Imminent:* Background `#FEF3C7`, Border `#FCD34D`, Text `#B45309`, Dot `#D97706`.
  - *Overdue:* Background `#FEE2E2`, Border `#FCA5A5`, Text `#B91C1C`, Dot `#DC2626`.
  - *Verified:* Background `#D1FAE5`, Border `#6EE7B7`, Text `#047857`, Dot `#059669`.
  - *Draft / Review:* Background `#EFF6FF`, Border `#BFDBFE`, Text `#1D4ED8`, Dot `#2563EB`.

### Data Density Tables
- Table header: `#F1F5F9` background, 32px height, 1px bottom border (`#CBD5E1`), text set in `label-md` (`#475569`, tracking `0.04em`).
- Rows: `#FFFFFF` base, 40px compact row height, 1px border-bottom (`#E2E8F0`), alternate row striping using `#F8FAFC`.
- Interactive hover: Solid `#F1F5F9` with a 2px vertical indicator bar (`#0F1E36`) fixed to the leading cell edge.
- Numeric columns: Right-aligned with tabular figures enabled.

### Structured Document Checklist Cards
- Enclosed white container with a 1px border (`#CBD5E1`).
- Card header contains document title, requirement class badge (Mandatory vs. Optional), and verified completion status indicator.
- Internal line items display document preview icons, submission timestamps, checksum markers, and reviewer notes in `body-sm` (`#334155`).

### Vertical Audit Timelines
- Connected vertical line (1.5px solid `#CBD5E1`) linking discrete log events.
- Nodes utilize an 8px circular marker: hollow with a white core for standard events, solid `#0F1E36` for legal sign-offs, and semantic red for escalations.
- Content metadata: ISO 8601 timestamps set in `tabular-data` (`#64748B`), actor identity in bold (`#1E2D4A`), and action description in `body-sm`.

### Review-Before-Send Draft Approval Cards & Modals
- High-visibility staging container framed in `#CBD5E1` with an interior header stripe in `#EFF6FF`.
- Side-by-side delta visualization showing original values struck through in `#DC2626` and modified draft states in `#047857`.
- Dual authorization signature trigger: Primary button (`#0F1E36` background, `#FFFFFF` text, 36px height, `space-lg` horizontal padding) paired with a secondary cancel button (1px `#CBD5E1` border, `#334155` text).

### Horizontal KPI Bar Metrics
- Segmented ribbon running across the top work canvas.
- 4 to 6 metric tiles separated by 1px solid vertical dividers (`#E2E8F0`).
- Each tile displays an uppercase label (`label-sm`, `#64748B`), a large metric numeral (`headline-lg`, `#0F1E36`), and a micro delta tag indicating daily case-load velocity.