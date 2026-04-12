# Layout and Text Overflow

## Why

Overflow = unreadable clipped text, broken mobile layouts, code needing manual fixes. Critical on mobile (375-393px wide).

## Prevention

### Text Elements

- Always `width: "fill_container"` inside auto-layout frames
- Set `maxLines` for truncatable text (card titles, list items)
- Never use fixed pixel widths wider than parent

### Container Frames

- Use auto-layout (`layout: "vertical"` or `"horizontal"`)
- Children: `width: "fill_container"`
- Set `padding` on parents, `gap` for spacing between children

### Mobile (375-393px)

- Screen frame: exact target width (375px)
- Direct children: `width: "fill_container"` + horizontal padding (16-20px)
- Text: always `fill_container`, never fixed width > ~335px
- Images: constrain to container width

### Nested Components

Set ref instance width to `"fill_container"` when it should fill parent:

```javascript
card=I(container, { type: "ref", ref: "CardComponent", width: "fill_container" })
```

## Detection

After inserting content:

```javascript
pencil_snapshot_layout({ filePath: "...", parentId: "screenId", maxDepth: 3, problemsOnly: true })
```

### Fixes

| Problem | Fix |
|---------|-----|
| Text clipped horizontally | `width: "fill_container"` or reduce font size |
| Text clipped vertically | Increase parent height, auto-height, or `maxLines` |
| Child wider than parent | `width: "fill_container"` |
| Children overlapping | Add `layout: "vertical"` or `"horizontal"` to parent |
| Content outside artboard | Reduce widths/padding |

### Fix Patterns

```javascript
// Text overflow
U("textNodeId", { width: "fill_container" })

// Children overflow
U("parentFrameId", { layout: "vertical", gap: 8 })
U("child1Id", { width: "fill_container" })

// Content touching edges
U("contentContainerId", { paddingLeft: 16, paddingRight: 16 })

// Long title truncation
U("titleTextId", { maxLines: 1, width: "fill_container" })
```

## See Also

- [visual-verification.md](visual-verification.md) — Screenshot verification
- [responsive-breakpoints.md](responsive-breakpoints.md) — Mobile layout constraints
