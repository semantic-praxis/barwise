import * as esbuild from "esbuild";

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  minify: false,
  external: ["vscode", "web-worker"],
  loader: { ".json": "json" },
  // Suppress import.meta.url warnings -- esbuild bundles the JSON
  // files directly, so the createRequire calls in core are dead code
  // in the bundled output.
  logLevel: "warning",
};

const serverBuild = esbuild.build({
  ...sharedOptions,
  entryPoints: ["src/server/OrmLanguageServer.ts"],
  outfile: "dist/server/OrmLanguageServer.js",
});

const clientBuild = esbuild.build({
  ...sharedOptions,
  entryPoints: ["src/client/extension.ts"],
  outfile: "dist/client/extension.js",
});

// MCP server -- standalone stdio process spawned by VS Code via
// McpStdioServerDefinition. Also used by external MCP clients that
// discover the server through VS Code. Note: the primary integration
// with Copilot Chat is through vscode.lm.registerTool() (see
// ToolRegistration.ts), which runs in-process. This stdio bundle
// exists for MCP protocol compatibility with external tools.
const mcpBuild = esbuild.build({
  ...sharedOptions,
  entryPoints: ["src/mcp/stdio-entry.ts"],
  outfile: "dist/mcp/index.js",
  banner: { js: "#!/usr/bin/env node" },
});

// Diagram webview -- a browser-targeted React bundle loaded by
// DiagramPanel. Unlike the other entry points this runs in the webview
// sandbox, so it is bundled for the browser with JSX support. React and
// react-dom are bundled into the artifact. A `.css` import is emitted
// as a sibling stylesheet (dist/webview/main.css).
const webviewBuild = esbuild.build({
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "esm",
  sourcemap: true,
  minify: false,
  jsx: "automatic",
  loader: { ".css": "css" },
  logLevel: "warning",
  // React reads process.env.NODE_ENV; the webview sandbox has no
  // `process`, so define it (and run React in production mode).
  define: { "process.env.NODE_ENV": '"production"' },
  entryPoints: ["webview/src/main.tsx"],
  outfile: "dist/webview/main.js",
});

await Promise.all([serverBuild, clientBuild, mcpBuild, webviewBuild]);
console.log("Build complete.");
