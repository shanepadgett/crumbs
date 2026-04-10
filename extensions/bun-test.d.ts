declare module "bun:test" {
  export const describe: (label: string, fn: () => void) => void;
  export const test: (label: string, fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toHaveLength: (expected: number) => void;
  };
}
