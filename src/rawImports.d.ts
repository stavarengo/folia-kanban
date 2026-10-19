// A `?raw` import is a file's text. Vite (the tests) reads it natively; esbuild.config.mjs adds the
// same for the build.
declare module "*?raw" {
  const text: string;
  export default text;
}
