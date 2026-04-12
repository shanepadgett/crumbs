# Asset Reuse

## Why

AI image gen is non-deterministic. Regenerating a logo produces different result -> visual inconsistency, appears like two brands. Same for product images, illustrations, brand elements, avatars.

## Finding and Reusing Assets

### 1. Search Existing

Before generating any image:

```javascript
pencil_batch_get({
  filePath: "path/to/file.pen",
  patterns: [{ name: "logo" }, { name: "brand" }, { name: "icon" }, { name: "image" }],
  searchDepth: 5
})
```

### 2. Copy Existing Asset

```javascript
logoCopy=C("existingLogoNodeId", "targetParentId", { width: 120, height: 40 })
```

For components containing logos (header with built-in logo), insert as ref:

```javascript
header=I("screenId", { type: "ref", ref: "HeaderComponent", width: "fill_container" })
```

### 3. Adjust Size

```javascript
U("copiedLogoId", { width: 100, height: 32 })
```

## When to Generate New

Only when:

1. No similar asset exists anywhere in document
2. Image is genuinely unique to this screen
3. Building first screen, no assets exist yet

## Logo Rules (Strictest)

1. ALWAYS search first
2. ALWAYS copy if exists — generated logos never match
3. Maintain aspect ratio when resizing
4. Check both artboards and components

## Decision Tree

```text
Need image/logo?
├── Logo/brand element?
│   ├── Exists elsewhere? -> COPY
│   └── First screen? -> Generate or ask user
├── Product photo / hero?
│   ├── Same image on another screen? -> COPY
│   └── Unique? -> Generate with G()
└── Icon?
    ├── In design system? -> Use component ref
    └── New? -> icon_font type or generate
```

## See Also

- [design-system-components.md](design-system-components.md) — Components containing logos/icons
- [visual-verification.md](visual-verification.md) — Verify copied assets
