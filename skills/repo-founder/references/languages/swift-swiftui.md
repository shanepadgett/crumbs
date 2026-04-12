# Swift / SwiftUI

## AGENTS.md guidance

- Match nearby Swift and SwiftUI patterns first
- Prefer `@Observable` and `@Bindable` for app-owned state
- Prefer `async/await` over new Combine pipelines
- Prefer `some View` and `@ViewBuilder` over `AnyView`
- Prefer modern layout APIs over casual `GeometryReader`
- Be careful with `Task`, actor isolation, persistence, file I/O, backup/restore

## .gitignore hints

- Ignore build products, derived data, xcuserdata, SwiftPM build output

## mise/tooling hints

- Runtime may need Xcode tools, `swift`, `swiftformat`, `swiftlint`, optional dead-code tool if user wants one
- `lint` can call `swiftlint`
- `check` can depend on lint plus any formatter/dead-code check tasks user requested
