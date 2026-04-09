# Unified Status Line Framework

- Build a single, structured status line layout (table-like slots) instead of ad-hoc extension status strings.
- Provide a small extension API so each extension can register/update named status cells without UI collisions.
- Support priority/order rules so core signals stay visible when space is tight.
- Include clear truncation/fallback behavior for narrow terminals.
- Success: multiple extensions render consistent status data in one predictable layout.
