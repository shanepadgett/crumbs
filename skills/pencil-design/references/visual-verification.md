# Visual Verification

## Why

Layout/spacing issues are invisible in node tree. Only screenshots reveal: misalignment, visual imbalance, wrong font rendering, bad color combos, missing content, broken instances.

## Workflow

### Section-by-Section (NOT whole screen at end)

```text
Build header   -> Screenshot -> Fix
Build hero     -> Screenshot -> Fix
Build features -> Screenshot -> Fix
Build footer   -> Screenshot -> Fix
Final          -> Screenshot full page -> Final review
```

### 1. Screenshot

```javascript
pencil_get_screenshot({ filePath: "...", nodeId: "sectionNodeId" })
```

### 2. Analyze

- **Alignment**: centered/aligned correctly? Equal column widths? Consistent grid spacing?
- **Spacing**: adequate padding? Consistent gaps? 8px grid?
- **Typography**: readable? Headings distinct? Cut off/overlapping?
- **Color/Contrast**: matches variables? Sufficient contrast? Cohesive?
- **Completeness**: all elements present? Icons/images placed? No empty/broken areas?

### 3. Layout Check (parallel with screenshot)

```javascript
pencil_snapshot_layout({ filePath: "...", parentId: "sectionNodeId", maxDepth: 3, problemsOnly: true })
```

Catches: clipped elements, overlapping siblings, out-of-bounds positioning.

### 4. Fix and Re-verify

Fix via `U()` operations -> new screenshot -> new layout check.

## When to Screenshot

| Moment | Target |
|--------|--------|
| After building section | Section root frame |
| After fixing issue | Affected area |
| Design complete | Full screen/artboard |
| After modifying existing | Changed section |
| After bulk property updates | Affected area |
| Comparing variants | Both side by side |

## Common Screenshot-Only Issues

| Issue | Symptom |
|-------|---------|
| Wrong font weight | Text too thin/bold |
| Inconsistent padding | Cards have different internal space |
| Color too similar to background | Element "disappears" |
| Alignment drift | Elements slightly off |
| Missing gap | Sections run together |
| Broken auto-layout | Children stack wrong direction |
| Icon disproportionate | Too small/large vs adjacent text |
| Image aspect ratio | Stretched/squished |

## See Also

- [layout-and-text-overflow.md](layout-and-text-overflow.md) — Fix patterns for overflow
- [asset-reuse.md](asset-reuse.md) — Verify copied assets after placement
