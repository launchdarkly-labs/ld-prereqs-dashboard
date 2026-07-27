/**
 * Static assets need the basePath prepended by hand when the app is served
 * from a sub-path (GitHub Pages project sites). NEXT_PUBLIC_BASE_PATH is
 * inlined at build time and matches `basePath` in next.config.ts.
 */
export function assetPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}
