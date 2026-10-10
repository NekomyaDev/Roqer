# MODERN STUDS selected body: centered-dialog

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games' Rebirth dialogs (before/after value chips, warning line, progress bar, Rebirth + Skip buttons) and one game's small confirmation dialogs. Button placement keeps the STUDS dialog's proven symmetric pair.

# SELECTED LAYOUT GUIDE (loaded via layout="centered-dialog")

For: rebirth, confirmations, offline earnings, prestige, prompts, "you got X" dialogs: any screen that presents a small amount of important information with one or two actions. NOT for shops, inventories, HUDs, transient toasts that dismiss themselves (notification-alert), or quest/reward boards (progression-hub).

The defining trait: **a loose, centered composition with one or two actions.** Content is a centered vertical stack with generous space; nothing stretches to fill the panel width.

## Measurements (1080p)

- Panel, by content:
  - full dialog (rebirth, offline earnings, reward summary): `Size = UDim2.fromScale(0.44, 0.54)`, centered;
  - yes/no confirmation with one line of text: `Size = UDim2.fromScale(0.3, 0.34)`, centered.
  `makePanelDark` (default) or `makePanelLight`; the confirmation uses the same variant as the screen it belongs to.
- Content: the variant's `Content` area, with ONE vertical `UIListLayout` (`HorizontalAlignment = Center`, `SortOrder = LayoutOrder`, `Padding = UDim.new(0.04, 0)`) stacking fixed-height block Frames. The action row is NOT in the list (see below). Set `ScrollingFrame.ScrollingEnabled = false`; a dialog never scrolls.
- Before/after block (rebirth, upgrade): a row 0.22 of panel height. Two caption labels ("Rebirth 0", "Rebirth 1") over two value chips (`chip` blocks, green, ~0.34 panel width x ~0.11 panel height each, one centred label like "x1.5 Money"). Between the chips, a bare stroked ">" label at ~0.08 panel width. The row is centred as a group with equal space on both sides.
- Reward/info items: centered `tile` blocks (~0.2 panel width each, icon above amount), side by side with ~2% gaps, centered as a group.
- Progress/requirement bar: the theme's progress bar, ~0.8 panel width x ~0.1 panel height, centered, its count label ("131/1K Strength") centred on the face. A requirement icon goes left of the count inside the bar, never hanging off the bar's end.
- Warning line: one red label (`Color3.fromRGB(255, 92, 92)`, stroke 3) centered between the last block and the action row, ~0.07 panel height. Never outside the panel.
- Action buttons: small, uniform, and centered, NOT full width. With two actions, copy these exact properties:
  - ConfirmButton: `AnchorPoint = Vector2.new(1, 0.5)`, `Position = UDim2.new(0.485, 0, 0.84, 0)`, `Size = UDim2.new(0.28, 0, 0.13, 0)`, green.
  - SecondButton: `AnchorPoint = Vector2.new(0, 0.5)`, `Position = UDim2.new(0.515, 0, 0.84, 0)`, `Size = UDim2.new(0.28, 0, 0.13, 0)`: grey for Cancel, purple for a Robux skip (label "Skip", second line "KEEP STATS!" at half size inside the same button).
  The two Size values are IDENTICAL; the affirmative action sits LEFT. Both are `button` blocks parented to the panel (not the scroll content). With one action, centre it at `Position = UDim2.new(0.5, 0, 0.84, 0)` with `AnchorPoint = Vector2.new(0.5, 0.5)`.
- Optional gift square: a purple `tile` right of the second button, same height, only when the skip is a Robux purchase.
- Bottom breathing room: at least 6% of panel height below the buttons.

## Rules

- Never apply grid-fill or full-width list habits here. If an element could shrink and still read, shrink it.
- Padding is symmetric: every centered element leaves equal space left and right.
- At most 2 action buttons (plus the optional gift square). Centered column composition throughout.
- The before/after chips are display only: they never act as buttons.
- Vertical rhythm over density: when unsure, add space, not size.
