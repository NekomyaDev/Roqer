# MODERN STUDS theme - part 2/2: panels, components, presentation, rules

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Uses the surface kit from part 1 (`makeSurface`, `paint`, `makeText`, `PALETTE`, `ROBUX`, `SUNBURST`).

## Panels

Pick ONE variant per screen and use it for every panel on that screen. **Dark** is the default. Use **Light** when the user asks for a light, white, or clean look, or the project's existing panels are white.

Both variants:
- Panel size comes from the selected layout body. Lock its 1080p shape with `AspectRatio = (widthScale × 16) / (heightScale × 9)` (core generation, Responsive geometry); derive pixel measurements inside it from the panel's `AbsoluteSize`.
- A `UIScale` child on the panel, for the open pop.
- Outline: black `UIStroke` 5 with `ApplyStrokeMode.Border`, `UICorner` 14 px.
- The light inner rim is a child Frame with its own stroke: one object renders one stroke.
- Panels have no lip.

### Dark variant (default): translucent body, coloured header band

```lua
local HEADER_H = 0.15 -- band height, share of panel height
local PAD = 14        -- content inset, px

local function makePanelDark(gui, name, widthScale, heightScale, headerColor, title, iconId)
	local panel = Instance.new("Frame")
	panel.Name = name
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromScale(widthScale, heightScale)
	panel.BackgroundColor3 = Color3.fromRGB(13, 17, 23)
	panel.BackgroundTransparency = 0.4
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local aspect = Instance.new("UIAspectRatioConstraint")
	aspect.AspectRatio = (widthScale * 16) / (heightScale * 9)
	aspect.Parent = panel
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = 5
	stroke.Parent = panel
	Instance.new("UIScale").Parent = panel

	local rim = Instance.new("Frame")
	rim.Name = "Rim"
	rim.BackgroundTransparency = 1
	rim.Position = UDim2.fromOffset(4, 4)
	rim.Size = UDim2.new(1, -8, 1, -8)
	rim.Parent = panel
	local rimCorner = Instance.new("UICorner")
	rimCorner.CornerRadius = UDim.new(0, 11)
	rimCorner.Parent = rim
	local rimStroke = Instance.new("UIStroke")
	rimStroke.Color = Color3.fromRGB(70, 72, 84)
	rimStroke.Thickness = 1.5
	rimStroke.Parent = rim

	local band, bandFace = makeSurface(panel, "band", headerColor)
	band.Name = "Header"
	band.Position = UDim2.fromOffset(8, 8)
	band.Size = UDim2.new(1, -16, HEADER_H, 0)

	local row = Instance.new("Frame") -- icon + title, one left-aligned group
	row.BackgroundTransparency = 1
	row.AnchorPoint = Vector2.new(0, 0.5)
	row.Position = UDim2.new(0, 10, 0.5, 0)
	row.Size = UDim2.new(0.62, 0, 0.84, 0)
	row.ZIndex = 3
	row.Parent = bandFace
	local list = Instance.new("UIListLayout")
	list.FillDirection = Enum.FillDirection.Horizontal
	list.VerticalAlignment = Enum.VerticalAlignment.Center
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Padding = UDim.new(0, 8)
	list.Parent = row
	local icon = Instance.new("ImageLabel")
	icon.BackgroundTransparency = 1
	icon.Image = iconId
	icon.ScaleType = Enum.ScaleType.Fit
	icon.Size = UDim2.fromScale(1, 1)
	icon.LayoutOrder = 1
	icon.Parent = row
	local square = Instance.new("UIAspectRatioConstraint")
	square.DominantAxis = Enum.DominantAxis.Height
	square.Parent = icon
	local titleLabel = makeText(row, title, { size = UDim2.fromScale(0.8, 0.78), align = Enum.TextXAlignment.Left, stroke = 3.5, extrude = true })
	titleLabel.LayoutOrder = 2

	local close, closeFace = makeSurface(bandFace, "tile", "red", true)
	close.Name = "Close"
	close.AnchorPoint = Vector2.new(1, 0.5)
	close.Position = UDim2.new(1, -8, 0.5, 0)
	close.Size = UDim2.new(0.1, 0, 0.8, 0)
	close.ZIndex = 3
	local closeSquare = Instance.new("UIAspectRatioConstraint")
	closeSquare.DominantAxis = Enum.DominantAxis.Height
	closeSquare.Parent = close
	makeText(closeFace, "X", { size = UDim2.fromScale(0.72, 0.72), stroke = 3 })

	local content = Instance.new("ScrollingFrame")
	content.Name = "Content"
	content.BackgroundTransparency = 1
	content.BorderSizePixel = 0
	content.Position = UDim2.new(0, PAD, HEADER_H, 16)
	content.Size = UDim2.new(1, -2 * PAD, 1 - HEADER_H, -16 - PAD)
	content.AutomaticCanvasSize = Enum.AutomaticSize.Y
	content.CanvasSize = UDim2.new()
	content.ScrollBarThickness = 6
	content.ScrollBarImageColor3 = Color3.fromRGB(230, 230, 235)
	content.Parent = panel
	return panel, content, close, bandFace
end
```

Each panel has its own stable header colour, for example Shop green, Index cyan, Rebirth yellow, Rewards purple, Trade blue, Settings grey. Only the icon, the title, the close button, and at most ONE secondary header action (a `button` surface such as a purple Gift, left of close, same height as close) live in the band. Timers and counters go on the first content row.

### Light variant: white studded body, straddling title and close

```lua
local function makePanelLight(gui, name, widthScale, heightScale, title, iconId)
	local panel = Instance.new("ImageLabel") -- the body is the stud image, so straddling children sit on one painted element
	panel.Name = name
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromScale(widthScale, heightScale)
	panel.BackgroundColor3 = Color3.new(1, 1, 1)
	panel.BorderSizePixel = 0
	panel.Image = STUDS
	panel.ScaleType = Enum.ScaleType.Tile
	panel.TileSize = UDim2.fromOffset(56, 56)
	panel.ImageTransparency = 0.82
	panel.Parent = gui
	local aspect = Instance.new("UIAspectRatioConstraint")
	aspect.AspectRatio = (widthScale * 16) / (heightScale * 9)
	aspect.Parent = panel
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = 5
	stroke.Parent = panel
	Instance.new("UIScale").Parent = panel

	local rim = Instance.new("Frame")
	rim.Name = "Rim"
	rim.BackgroundTransparency = 1
	rim.Position = UDim2.fromOffset(4, 4)
	rim.Size = UDim2.new(1, -8, 1, -8)
	rim.Parent = panel
	local rimCorner = Instance.new("UICorner")
	rimCorner.CornerRadius = UDim.new(0, 11)
	rimCorner.Parent = rim
	local rimStroke = Instance.new("UIStroke")
	rimStroke.Color = Color3.fromRGB(175, 175, 185)
	rimStroke.Thickness = 2
	rimStroke.Parent = rim

	local icon = Instance.new("ImageLabel") -- overflows the top-left corner on purpose
	icon.BackgroundTransparency = 1
	icon.Image = iconId
	icon.ScaleType = Enum.ScaleType.Fit
	icon.AnchorPoint = Vector2.new(0.5, 0.5)
	icon.Position = UDim2.fromScale(0.035, 0.02)
	icon.Size = UDim2.fromScale(0.1, 0.15)
	icon.ZIndex = 3
	icon.Parent = panel
	local square = Instance.new("UIAspectRatioConstraint")
	square.DominantAxis = Enum.DominantAxis.Height
	square.Parent = icon
	makeText(panel, title, {
		anchor = Vector2.new(0, 0.5), position = UDim2.fromScale(0.095, 0.015), size = UDim2.fromScale(0.55, 0.1),
		align = Enum.TextXAlignment.Left, stroke = 3.5, extrude = true,
	})

	local close, closeFace = makeSurface(panel, "tile", "red", true) -- straddles the top-right corner
	close.Name = "Close"
	close.AnchorPoint = Vector2.new(0.5, 0.5)
	close.Position = UDim2.fromScale(0.975, 0.03)
	close.Size = UDim2.fromScale(0.1, 0.14)
	close.ZIndex = 3
	local closeSquare = Instance.new("UIAspectRatioConstraint")
	closeSquare.DominantAxis = Enum.DominantAxis.Height
	closeSquare.Parent = close
	makeText(closeFace, "X", { size = UDim2.fromScale(0.72, 0.72), stroke = 3 })

	local content = Instance.new("ScrollingFrame")
	content.Name = "Content"
	content.BackgroundTransparency = 1
	content.BorderSizePixel = 0
	content.Position = UDim2.new(0, PAD, 0.11, 0)
	content.Size = UDim2.new(1, -2 * PAD, 0.89, -PAD)
	content.AutomaticCanvasSize = Enum.AutomaticSize.Y
	content.CanvasSize = UDim2.new()
	content.ScrollBarThickness = 6
	content.ScrollBarImageColor3 = Color3.fromRGB(120, 120, 130)
	content.Parent = panel
	return panel, content, close
end
```

The title, icon, and close are CHILDREN of the panel body: the UI audit treats a child crossing its parent's edge as placed, while a sibling crossing a painted edge is a collision.

## Components

All of these are `makeSurface` blocks. Text, art, and buttons are children of a block's `Face`, so they render above it and the audit reads them as on it.

- **Close**: always the `tile` red block with a white "X" (`makeText`, stroke 3), square through a height-dominant `UIAspectRatioConstraint`. Inside the band (Dark) or straddling the top-right corner (Light). Never a bare "X" label, never a different colour.
- **Price button**: `button` green block, ONE label `ROBUX .. " " .. price` (or the coin icon beside an amount for coin prices: icon left, amount right, one centred `UIListLayout` row). At most ~30% of its card's height, at least 44 px tall.
- **Gift button**: `tile` purple square beside a price button, the same height, with the Gift icon at 70% of its size. Optional; when present it sits to the right of the price button with a 6 px gap.
- **Action button**: `button` block, green for the affirmative action, purple for skip/boost, red for destructive, grey for cancel. Label only, or icon left of the label as one centred group.
- **Card** (product, reward, collection entry): `card` block. Bands top to bottom, as shares of card height:
  - name 0.04-0.17, centred (left-aligned at 0.6 width when the card has a tag);
  - art 0.19-0.69: an `ImageLabel` (Fit, square constraint, `ZIndex` 2) on a sunburst (Fit, square, ImageTransparency 0.5, `ZIndex` 1) of the same centre and ~1.25x its size, kept inside the art band;
  - price/action row 0.73-0.94: price button ~0.72 card width, or price + gift.
  Bands never overlap; with no art, the card shrinks rather than leaving an empty band.
- **Tag** ("NEW!", "BEST", "-50%", "LIMITED"): a `chip` block, red or gold, inside the card's top-right corner in the name band (x 0.64-0.96, y 0.03-0.17), white text stroke 2. At most one per card.
- **Wide offer row / featured banner**: a `card` block spanning the content width, aspect 3.2-3.6. Art on a sunburst at the left (square, ~0.85 of row height), name + one description line in the middle, price button bottom-right, optional tag top-right. A featured banner may use the sparse stud texture `102751665779866` on its face and an extruded gold display number. A banner always sells a real product.
- **Section title**: a full-width Frame 40-48 px tall in the section's colour, faded at both ends, with an extruded title centred on it:

  ```lua
  local function makeSectionTitle(parent, text, colorName, order)
  	local band = Instance.new("Frame")
  	band.Name = "Section_" .. text
  	band.BackgroundColor3 = PALETTE[colorName].bottom
  	band.BorderSizePixel = 0
  	band.Size = UDim2.new(1, 0, 0, 44)
  	band.LayoutOrder = order
  	local fade = Instance.new("UIGradient")
  	fade.Transparency = NumberSequence.new({
  		NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.3, 0.55),
  		NumberSequenceKeypoint.new(0.7, 0.55), NumberSequenceKeypoint.new(1, 1),
  	})
  	fade.Parent = band
  	makeText(band, text, { size = UDim2.fromScale(0.6, 0.8), stroke = 3, extrude = true })
  	band.Parent = parent
  	return band
  end
  ```
- **Tab rail** (categories, rarities, scopes): a vertical stack of `chip` blocks OUTSIDE the panel edge, parented to the panel so it moves with it:
  - placement: rail `AnchorPoint` (1, 0), `Position` (0, -10, 0.14, 0) on the left; or (0, 0) and (1, 10, 0.14, 0) on the right;
  - size: rail width 0.2 of panel width; tabs 0.11 of rail height, ~2% gaps;
  - state: EXACTLY ONE tab in its category colour (the active one, matching the visible content), every other tab `grey`.
  Use the rail only when the panel is at most 0.55 screen width, so it stays on screen.
- **HUD tile**: a `tile` block, roughly square (aspect 0.97). Icon (Fit, square) centred at y 0.38 at 0.62 of the tile's height; label at y 0.84, 0.24 tall, stroke 2.5; the bands never overlap. Optional badge: a red `chip` parented to the tile base (not the face), straddling its top-right corner at (0.86, 0.06), 0.62 x 0.24 of the tile, with "!" or "NEW!".
- **Currency readout**: no plate. A transparent row: icon (Fit, square, the row's full height) then the value as a left-aligned label with stroke 3 and a display-number gradient (cash, gold, gem). Each currency has its own icon and gradient.
- **Value chip** (multipliers, "x1.5 Money"): a `chip` block with one centred label. A before/after pair is two chips with a bare stroked ">" between them, never an arrow drawn from Frames.
- **Progress bar**: ONE `chip` block whose face gradient carries the fill as a hard colour stop, with its count label on the face. A label centred over a separate fill frame is half on and half off it, which the UI audit reports.

  ```lua
  local TRACK = Color3.fromRGB(75, 78, 92)
  local function setProgress(bar, progress, goal, colorName)
  	local f = math.clamp(progress / goal, 0.001, 0.998)
  	local fill = PALETTE[colorName].bottom
  	local shade = bar.Face.UIGradient
  	shade.Rotation = 0
  	shade.Color = ColorSequence.new({
  		ColorSequenceKeypoint.new(0, fill), ColorSequenceKeypoint.new(f, fill),
  		ColorSequenceKeypoint.new(f + 0.001, TRACK), ColorSequenceKeypoint.new(1, TRACK),
  	})
  	bar.BackgroundColor3 = Color3.fromRGB(40, 42, 52)
  end
  -- local bar, barFace = makeSurface(parent, "chip", "green"); setProgress(bar, 3, 10, "green")
  -- makeText(barFace, "3/10", { size = UDim2.fromScale(0.9, 0.72) })
  ```
- **Text input** (codes, player name): a `chip` block in `slate`, with the `TextBox` as a child of its face, white text, stroke 2, placeholder `Color3.fromRGB(190, 190, 200)`.

## Presentation

Every panel opens with a world blur and a quick pop. This adds to the polish layer's open animation, which it matches. The blur is a client-side `BlurEffect` the builder owns: reuse it by name, and destroy it with the screen.

```lua
local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")
local POP = TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

local oldBlur = Lighting:FindFirstChild("ModernStudsBlur")
if oldBlur then oldBlur:Destroy() end
local blur = Instance.new("BlurEffect")
blur.Name = "ModernStudsBlur"
blur.Size = 0
blur.Parent = Lighting
gui.Destroying:Connect(function() blur:Destroy() end)

local function openPanel(panel)
	panel.Visible = true
	local scale = panel:FindFirstChildOfClass("UIScale")
	scale.Scale = 0.85
	TweenService:Create(scale, POP, { Scale = 1 }):Play()
	TweenService:Create(blur, TweenInfo.new(0.2), { Size = 16 }):Play()
end

local function closePanel(panel)
	panel.Visible = false
	TweenService:Create(blur, TweenInfo.new(0.15), { Size = 0 }):Play()
end
```

- A screen that starts open calls `openPanel` once after building, so the first render shows the blur and the resting panel.
- Close buttons call `closePanel`.
- HUD, sidebar, clicker, and toast layouts never blur: the world stays sharp behind them.
- Hiding the HUD while a panel is open is allowed only when the user asks for it.
- Hover and press follow the polish layer through a `UIScale` on the block's base (hover 1.06, press 0.94). Nothing tweens `Size` or `Position` of anything a layout places.

## Engine facts

- `ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling`. Children always draw above their parent; `ZIndex` orders siblings only.
- Never give an element a Scale width of 0. Squares (icons, close, tiles, badges) use a non-zero width scale with a height-dominant `UIAspectRatioConstraint`, or an explicit `UDim2.fromOffset(H, H)`.
- Never put a scale fraction in an offset slot: `UDim2.new(1, -2 * PAD, 1 - HEADER_H, -16 - PAD)` keeps scale and pixels in their own slots.
- `TextScaled` caps near 100 px; for bigger display text keep `TextScaled` and set `RichText` with `<font size="N">`.
- Interactive blocks are at least 44 px tall.
- Nothing inside a `ScrollingFrame` is rotated. Gloss or streaks, when wanted, are a white Frame child of a face with a transparency `UIGradient`, never a rotated Frame.
- `UICorner` rounds an `ImageLabel`'s image, so the stud tile stays inside the rounded face. If a screenshot ever shows stud pixels past a corner, raise the face's `ImageTransparency` by 0.1 and report it.
- No visible element inside the top-left 350×70 Core UI keep-out; elements near the top-left anchor their y at a 70 px offset.
- Panel height stays within [0.40, 0.66] of the screen unless the selected body says otherwise, and content ends within ~12% of the panel bottom.

## Final check

- Every block is a `makeSurface` block: outline, rounded corners, lip, gradient face with tinted studs. Nothing flat, square-cornered, or lipless.
- One panel variant on the screen; the close is the red tile with a white X, inside the band (Dark) or straddling the corner (Light).
- Green only on actions and positive values; exactly one active tab, in colour; inactive tabs, owned, and claimed states grey.
- Every item art has its sunburst; every price button uses the Robux glyph or a coin icon group.
- Text: white, stroked, never boxed; display numbers gradient-filled; extrusion only on titles and display numbers.
- The panel opened with blur and pop; the screenshot shows the resting state.
- Asset IDs are only the ones in part 1, `resolve_icon` results, or verified project art.
- No overlap, no text crossing a sibling's edge, no zero-size element, all content hardcoded.

## Layout bodies

Load exactly one with this theme: `references/selected/modern-studs/<layout>.md`. Slugs: `shop-grid`, `centered-dialog`, `fullscreen-landing`, `admin-control-panel`, `hud-zone-system`, `select-screen`, `grid-inventory`, `vertical-navigation-sidebar`, `progression-hub`, `stat-leaderboard`, `incremental-clicker`, `notification-alert`, `wheel-spin`, `vertical-reel-roll`. MODERN STUDS has no wheel or reel template of its own: those two bodies route to the STUDS templates.
