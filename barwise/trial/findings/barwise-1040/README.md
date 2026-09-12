# barwise-1040: the release CLI bundle cannot find the gym catalog

```sh
node packages/cli/dist/bundle/index.cjs gym list
node packages/cli/dist/index.js gym list
```

Expected: the packaged exercises listed, from either entry point.

Observed (1.7.0): the bundle exits 1 with `Error: The "path" argument
must be of type string or an instance of URL. Received undefined`; the
unbundled dist lists one exercise. `learn/src/exercise/catalog.ts`
resolves the catalog from `import.meta.url`, which esbuild leaves empty
in the cjs bundle (the build prints the warning). `--catalog <dir>`
works. Every trial customer's sprint-6 release-bundle step records this.
