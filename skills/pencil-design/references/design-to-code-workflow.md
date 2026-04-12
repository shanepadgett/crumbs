# Design-to-Code Workflow

## Step 1: Load `frontend-design` Skill

**MANDATORY.** Provides aesthetic direction: bold design choices, distinctive typography, cohesive palettes, purposeful motion, intentional spatial composition. Apply when designing AND when translating to code.

## Step 2: Read Design Guidelines

```javascript
pencil_get_guidelines({ topic: "code" })
```

## Step 3: Read Design Tokens

```javascript
pencil_get_variables({ filePath: "path/to/file.pen" })
```

Map Pencil variables to your project's design token system (CSS custom properties, theme config, etc.).

## Step 4: Read Design Tree

```javascript
pencil_batch_get({ filePath: "...", nodeIds: ["screenId"], readDepth: 5 })
```

## Step 5: Map Components

```javascript
pencil_batch_get({ filePath: "...", patterns: [{ reusable: true }], readDepth: 3 })
```

Identify reusable Pencil components and map them to your project's UI library components. `ref` instances become component usages with overridden props.

## Step 6: Generate Code

- Use design token references (CSS custom properties), not hardcoded values
- Match Pencil node tree structure (vertical/horizontal -> flex-col/flex-row)
- Map Pencil layout properties to CSS equivalents
- Apply `frontend-design` guidelines: distinctive typography, intentional color, motion, spatial composition
- Use Lucide for icons (map from Pencil's Material Icons)

### Layout Mapping

| Pencil | CSS |
|--------|-----|
| `layout: "vertical"` | `flex-direction: column` |
| `layout: "horizontal"` | `flex-direction: row` |
| `gap: N` | `gap: Npx` |
| `padding: N` | `padding: Npx` |
| `width: "fill_container"` | `width: 100%` or `flex: 1` |
| `height: "fill_container"` | `height: 100%` or `flex: 1` |
| `alignItems: "center/start/end"` | `align-items: center/start/end` |
| `justifyContent: "center/space-between/end"` | `justify-content: center/space-between/end` |

### Typography Mapping

| Pencil | CSS |
|--------|-----|
| `fontSize: 12/14/16/18/20/24/30/36/48` | `font-size` in px or rem |
| `fontWeight: "400/500/600/700"` | `font-weight` |

### Always Do

- Load `frontend-design` skill, apply its guidelines
- Use design token references, not hardcoded values
- Map reusable components to project UI library
- Use Lucide icons (not Material)
- TypeScript, React 19 (ref as prop, no `forwardRef`)

### Never Do

- Hardcode hex colors or pixel values that have token equivalents
- Inline styles when a component library equivalent exists
- Single monolithic file for multi-component screen
- `forwardRef` (React 19)
- Skip `frontend-design` skill
- Generic AI aesthetics

## Step 7: Sync Variables Back (Optional)

```javascript
pencil_set_variables({ filePath: "...", variables: { ... } })
```

## Responsive Code

Multi-artboard designs (375px mobile, 768px tablet, 1280px desktop):

1. Read all artboards, compare structures
2. Mobile-first code (base = smallest artboard)
3. Add breakpoint overrides for larger layouts
4. Never hardcode artboard pixel widths

See [responsive-breakpoints.md](responsive-breakpoints.md).

## Icon Mapping (Material -> Lucide)

| Material | Lucide |
|----------|--------|
| `search` | `<Search />` |
| `close` | `<X />` |
| `menu` | `<Menu />` |
| `arrow_forward/back` | `<ArrowRight />` / `<ArrowLeft />` |
| `person` | `<User />` |
| `settings` | `<Settings />` |
| `home` | `<Home />` |
| `notifications` | `<Bell />` |
| `edit` | `<Pencil />` |
| `delete` | `<Trash2 />` |
| `add` | `<Plus />` |
| `check` | `<Check />` |
| `visibility/off` | `<Eye />` / `<EyeOff />` |
| `chevron_right/down` | `<ChevronRight />` / `<ChevronDown />` |
| `more_vert/horiz` | `<MoreVertical />` / `<MoreHorizontal />` |
| `mail` | `<Mail />` |
| `calendar_today` | `<Calendar />` |
| `favorite` | `<Heart />` |
| `star` | `<Star />` |
| `download/upload` | `<Download />` / `<Upload />` |
| `filter_list` | `<Filter />` |
| `sort` | `<ArrowUpDown />` |
| `logout` | `<LogOut />` |

All accept `className` for sizing: `<Search className="size-4" />`.
