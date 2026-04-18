# Codex Compat Extension

Minimal Codex compatibility mode for Pi.

This package exposes three extensions:

- `apply-patch` activates Codex-style `apply_patch` behavior and toolset switching
- `view-image` provides `view_image` for image-capable compat models
- `fast` toggles OpenAI priority tier dispatch with `/fast`

## How to use it

Install or enable extension package, then select supported Codex-family model.

Compatibility mode activates automatically on supported model select and updates agent prompt with apply-patch focused guidance.

## Fast mode limitation

Fast mode mutates outgoing provider payload with `service_tier: "priority"` for eligible OpenAI providers.

Billing is correct. Session footer cost display does not reflect 2× priority multiplier because UI pricing path reads `options.serviceTier`, not mutated payload.
