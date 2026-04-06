# Minimal System Prompt Mode

Offer a mode that strips the system prompt down to the smallest useful instruction set for users who care more about speed, determinism, or model headroom than handholding. This could be valuable for trusted local workflows, benchmarking, or users who want Pi to behave more like a thin shell around their chosen model.

The tricky part is deciding what is truly minimal without breaking core product expectations. Some guidance likely still has to remain, especially around tool use, safety boundaries, and session behavior, but a lot of stylistic or convenience instruction could probably be removed.

This idea would benefit from being measurable. If minimal mode exists, it should have a clear definition of what gets removed, what behavior differences are expected, and whether the latency or output quality changes are actually meaningful in practice.
