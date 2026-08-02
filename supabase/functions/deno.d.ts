// Minimal ambient Deno declarations so plain `tsc` can typecheck these files.
// The real runtime provides far more; this is only what our functions touch.
// Without it every function reads as untyped and genuine mistakes hide in the noise.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
