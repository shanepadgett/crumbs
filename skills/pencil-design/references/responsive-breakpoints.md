# Responsive Breakpoints

## Why

Multiple artboards at different widths must map to correct CSS breakpoints. Wrong mapping -> layouts break at wrong sizes, mobile designs at tablet widths, desktop layouts that don't scale.

## Artboard -> Breakpoint Mapping

| Device | Artboard Width | Breakpoint |
|--------|---------------|------------|
| Mobile (small) | 320px | Default (no breakpoint) |
| Mobile (standard) | 375px | Default |
| Mobile (large) | 393-430px | Default |
| Tablet (portrait) | 768px | ~768px |
| Tablet (landscape) | 1024px | ~1024px |
| Desktop | 1280px | ~1280px |
| Desktop (wide) | 1440px | ~1536px |

## Multi-Artboard Code Gen

### Read All Artboards

```javascript
pencil_batch_get({ filePath: "...", patterns: [{ type: "frame", name: "Mobile|Tablet|Desktop" }], readDepth: 4 })
```

### Strategy: Mobile-First

Base styles = mobile artboard. Add breakpoint overrides for larger screens.

### Common Responsive Patterns

| Design Pattern | Implementation |
|---------------|----------------|
| 1 col -> 2 -> 3 | Grid with breakpoint column changes |
| Stacked -> side-by-side | Flex column -> row at breakpoint |
| Hidden mobile, visible desktop | Display none -> block at breakpoint |
| Full-width -> constrained | 100% width with max-width |
| Smaller text -> larger | Font size increases at breakpoints |
| Less padding -> more | Padding increases at breakpoints |

### Layout Differences Between Artboards

| What Changes | Mobile | Desktop |
|-------------|--------|---------|
| Direction | vertical | horizontal |
| Columns | 1 | 2-4 |
| Visibility | element missing | element present |
| Font size | smaller | larger |
| Padding | 16px | 24-32px |
| Gap | 16px | 24px |
| Sidebar | hidden/stacked | side-by-side |

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Hardcoding pixel widths from artboard | Responsive breakpoints + fluid layouts |
| Separate components for mobile/desktop | One component with responsive overrides |
| `max-width` media queries | Mobile-first `min-width` |
| Ignoring mobile artboard | Start from mobile, add breakpoint overrides |
| Fixed width from mobile artboard (e.g. 375px) | `width: 100%` with responsive max-width |
| Fixed width from desktop artboard (e.g. 1440px) | `max-width` with auto margins |

## See Also

- [design-to-code-workflow.md](design-to-code-workflow.md) — Full code gen workflow
