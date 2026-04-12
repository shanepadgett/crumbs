# Design System Components

## Why

Reusable components (`reusable: true`) = Figma components / React components. Recreating from scratch -> inconsistency, no propagation, duplicated code, file bloat.

## Discovery and Usage

### 1. List All Reusable Components

Do this at start of every design task:

```javascript
pencil_batch_get({
  filePath: "path/to/file.pen",
  patterns: [{ reusable: true }],
  readDepth: 2,
  searchDepth: 3
})
```

### 2. Identify Match

- **Name**: "Button", "Card", "Input", "NavBar", "Avatar", etc.
- **Structure**: card with image + title + description
- **Variant**: "Button Primary", "Button Secondary"

### 3. Insert as Ref

```javascript
btn=I("parentFrameId", { type: "ref", ref: "btn-primary", width: "fill_container" })
```

Creates connected instance. Main component edits propagate.

### 4. Customize Instance

```javascript
U(btn+"/btn-label", { content: "Submit" })
U(btn+"/icon-container/icon", { content: "arrow_forward" })
```

### 5. Replace Slots

```javascript
newContent=R(btn+"/content-slot", { type: "text", content: "Custom Content" })
```

## When to Create New

Only when:

1. No similar component exists after checking `reusable: true`
2. Existing component is fundamentally different (not just color/text change)
3. Building new design system from empty file

Set `reusable: true` on new components for future use.

## Components to Search For

| Need | Search names |
|------|-------------|
| Button | button, btn, cta |
| Text input | input, field, text-field |
| Card | card, tile, panel |
| Navigation | nav, navbar, sidebar, menu |
| Header | header, topbar, appbar |
| Footer | footer, bottom-bar |
| Modal/Dialog | modal, dialog, sheet |
| Badge/Tag | badge, tag, chip, label |
| Avatar | avatar, profile-pic |
| Table row | row, table-row, list-item |
| Icon | icon, symbol |
| Checkbox/Radio | checkbox, radio, toggle, switch |
| Select/Dropdown | select, dropdown, picker |
| Tab | tab, tab-bar, segment |

## See Also

- [variables-and-tokens.md](variables-and-tokens.md) — Variables for styling instances
- [design-to-code-workflow.md](design-to-code-workflow.md) — Map reusable components to UI library
