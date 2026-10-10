# MODERN STUDS selected body: progression-hub

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: partial. Both reference games have daily/playtime reward screens; row geometry and claim states are carried from the STUDS progression body.

# SELECTED LAYOUT GUIDE (loaded via layout="progression-hub")

For: quest logs, daily/weekly quest boards, battle pass and season screens, achievement lists, daily reward tracks: any screen where the player reviews goals and claims earned rewards. NOT for shops (those sell), inventories (grid-inventory), rebirth/prestige confirms (centered-dialog), or leaderboards (stat-leaderboard).

The defining trait: **full-width goal rows, each with a progress bar and a claim state.**

## Measurements (1080p)

- Panel: `Size = UDim2.fromScale(0.52, 0.62)`, centered, `makePanelDark` (purple header) or `makePanelLight`.
- Scope tabs (Daily / Weekly / Season), when asked for: the theme's tab rail on the panel's RIGHT edge, the active scope in colour and the others grey; the active tab matches the rows on screen.
- Rows: the content's vertical `UIListLayout`, ~2% panel-height gaps. Each row is a `card` block, full content width, explicit pixel height 96 (`Size = UDim2.new(1, 0, 0, 96)`), left to right on its face:
  - icon on a small sunburst: square, ~70% of row height, left margin ~1.5%;
  - middle block (~52% of row width): quest name on top (left-aligned, stroke 2.5, ~36% of row height), the theme's progress bar under it (~90% of block width x ~30% of row height) with "3/10" on the bar;
  - right block: a reward chip (icon left of the amount, as one group) and the claim `button` (~16% of row width x ~60% of row height) at the right, ~1.5% margin.
- Claim states on the claim button: completed and unclaimed = green "CLAIM"; claimed = grey "CLAIMED" with the Checkmark icon `rbxassetid://128850290702187` left of the label; incomplete = grey "CLAIM" with its bar part-filled.
- Daily-reward track variant (a day-by-day calendar): 7 `tile` blocks in one row (day 7 twice as wide, gold), each "Day N" over a reward icon and amount; claimed days grey with the Checkmark, today green, future days slate.
- SEED demo content when the game has none: 5-7 quests with varied progress, at least one claimable, one claimed, and one barely started (1-2 of N, never 0).
- Set every bar through the theme's `setProgress`; never build a separate fill frame.

## Rules

- Rows are uniform and span the full content width.
- Every row carries a progress bar with its count on the bar, and the fill matches the count.
- Green appears ONLY on claimable buttons and today's daily tile.
- No prices, purchase buttons, or Robux glyphs: rewards here are earned.
- Rows scroll; the header and tab rail never scroll.
- 5+ rows visible; one or two giant rows filling the panel is a defect.
