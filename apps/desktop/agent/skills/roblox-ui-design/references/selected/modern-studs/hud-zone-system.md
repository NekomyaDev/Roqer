# MODERN STUDS selected body: hud-zone-system

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games' HUDs: a left column of labelled square tiles with corner badges, a right column of tiles or offers, plate-less gradient currency readouts, and (one game) a top-centre row of coloured nav chips. Zones, keep-outs, and bars keep the CLASSIC STUDS HUD rules.

# SELECTED LAYOUT GUIDE (loaded via layout="hud-zone-system")

For: the always-on gameplay HUD: currency and stat readouts, round timers and objectives, side button stacks that open menus, health/stamina bars, buff chips, action buttons. NOT for menus, shops, dialogs, any screen that blocks play, a labelled sidebar nav asked for on its own (vertical-navigation-sidebar), or toast stacks (notification-alert).

The defining trait: **edge-anchored zones of chunky studded tiles around an empty, sharp play area.** No blur, no backdrop, no panel.

## Zones

Treat the screen as a 3x3 grid; the centre cell stays empty. Use only the zones the task needs, usually three or four:

- left: menu tiles (Shop, Index, Rebirth, Pets...) in 1 or 2 columns, vertically centred.
- right: secondary tiles (Eggs, Animals, Trade) or ONE featured offer tile.
- bottom-left: currency/stat readouts, stacked.
- top-centre: one round timer, objective, or ONE row of up to 3 nav chips (Guns / Home / Sell).
- bottom-centre: action buttons or a hotbar.

## Measurements (1080p)

- Every zone is a transparent Frame anchored to its edge or corner, holding children with a `UIListLayout` (or `UIGridLayout` for a 2-column tile zone). Elements are never positioned individually against the screen.
- Safe inset: every zone sits at least 2% of screen width/height inside the viewport edge.
- Core UI keep-out: nothing inside the top-left 350×70 px. The left tile zone is vertically centred, so it clears it; anything in the top-left anchors y at a 70 px offset.
- Centre keep-out: the middle 50% x 50% of the screen holds no HUD element. Zones keep at least 2% of screen width between each other; no zone is wider than 22% of the screen except top-centre and bottom-centre (40%).
- Menu tile: the theme's HUD tile, `Size = UDim2.new(0.065, 0, 0.115, 0)` with a height-dominant `UIAspectRatioConstraint` (`AspectRatio = 0.97`): ~124 px at 1080p. Icon from `resolve_icon` (the Shop tile uses `rbxassetid://110972987269284`), label under it. At most 6 tiles per side; a 2-column zone uses a `UIGridLayout` with `CellPadding` ~1% of screen height. Badges ("!" or "NEW!") on at most 2 tiles.
- Each tile has its own colour and keeps it: Shop gold/orange, Index purple/blue, Rebirth cyan, Pets green, Trade pink.
- Nav chips (top-centre, optional): up to 3 `chip` blocks in one centred row, each ~13% screen width x ~6% screen height, ~1% gaps, one colour each (green, cyan, red), white label stroke 2.5. The row's top sits at least 70 px below the screen top (`UDim2.new(0.5, 0, 0, 70)`, `AnchorPoint = Vector2.new(0.5, 0)`).
- Currency readouts (bottom-left): the theme's plate-less readout, each row ~5% of screen height, up to 4 rows, ~1% gaps; icon left, gradient value right. Each currency has its own icon (coin `rbxassetid://84697600263846`, cash `rbxassetid://70565105539676`, gem `rbxassetid://75581768563141`) and its own gradient. A bare number with no icon is a defect.
- Optional big total (top-centre, instead of nav chips): one extruded cash-gradient display number, ~22% x ~7% of the screen, top at 70 px.
- Bars (health/stamina): the theme's progress bar, ~22% screen width x ~3.5% screen height, stacked with ~1% gaps, count label on the face.
- Bottom-centre action buttons: at most 4 `button` blocks in a row, each ~11% x ~8% of the screen, ~2% apart.
- Size and position in Scale, never offset (except the 70 px keep-out anchor): the HUD must hold on phone aspect ratios.

## Rules

- No backdrop, no scrim, no blur: the world stays fully visible and sharp.
- No panel, no header, no close button.
- Every element lives inside a zone container; zones never overlap; no two elements overlap.
- The centre stays empty.
- Tiles are uniform in size within a zone; a "featured" larger tile appears only as the ONE right-side offer tile.
- Compact over large: if an element could shrink and still read, shrink it.
