const esbuild = require("esbuild");

const production = process.argv.includes("production");

const config = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
  // Drop prop-types and dev-only code in production
  drop: production ? ["debugger"] : [],
  // Minify in production for even smaller output
  minify: production,
};

if (production) {
  console.log("Building for PRODUCTION...");
}

esbuild.build(config).catch(() => process.exit(1));
