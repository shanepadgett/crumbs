# Variables and Design Tokens

## Why

Hardcoding `fill: "#3b82f6"` or `cornerRadius: 8` instead of variables -> broken theming, no dark mode, manual find-replace for updates.

## Reading and Using Variables

### 1. Read All Variables

At start of every design task:

```javascript
pencil_get_variables({ filePath: "path/to/file.pen" })
```

### 2. Map Values to Variables

| Want | Don't use | Use instead |
|------|-----------|-------------|
| Blue brand color | `fill: "#3b82f6"` | `primary` variable |
| White text on primary | `textColor: "#ffffff"` | `primary-foreground` variable |
| Border color | `strokeColor: "#e2e8f0"` | `border` variable |
| Medium rounding | `cornerRadius: [6,6,6,6]` | `radius-md` variable |
| Page background | `fill: "#ffffff"` | `background` variable |
| Body text color | `textColor: "#0a0a0a"` | `foreground` variable |

### 3. Apply Variables

Bind properties to variables per schema from `pencil_get_editor_state`.

### 4. Create Missing Variables

```javascript
pencil_set_variables({
  filePath: "path/to/file.pen",
  variables: { "accent": { "value": "#f59e0b" }, "accent-foreground": { "value": "#ffffff" } }
})
```

## Theme Support

Variables can differ per theme (light/dark). Hardcoded values break theme switching entirely.

## Common Variable Categories

| Category | Names |
|----------|-------|
| Brand colors | `primary`, `secondary`, `accent` |
| Semantic colors | `destructive`, `success`, `warning`, `info` |
| Surface colors | `background`, `foreground`, `card`, `card-foreground` |
| UI colors | `border`, `ring`, `muted`, `muted-foreground` |
| Border radius | `radius-sm/md/lg/xl` |
| Typography | `font-sans`, `font-mono`, `font-heading` |
| Spacing | `spacing-xs/sm/md/lg` |

## See Also

- [design-to-code-workflow.md](design-to-code-workflow.md) — Code gen workflow
- [responsive-breakpoints.md](responsive-breakpoints.md) — Breakpoint tokens
