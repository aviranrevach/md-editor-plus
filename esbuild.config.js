const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

// KaTeX ships its fonts beside katex.min.css. A VS Code webview and a
// standalone HTML export cannot resolve those package-relative URLs, so keep
// the stylesheet as text and embed the local WOFF2 files as data URIs.
const katexCssTextPlugin = {
  name: 'katex-css-text',
  setup(build) {
    build.onLoad({ filter: /[\\/]katex[\\/]dist[\\/]katex\.min\.css$/ }, (args) => {
      let css = fs.readFileSync(args.path, 'utf8');
      css = css.replace(/src:url\(fonts\/([^)]+\.woff2)\)[^}]*/g, (_source, filename) => {
        const font = fs.readFileSync(path.join(path.dirname(args.path), 'fonts', filename));
        return `src:url(data:font/woff2;base64,${font.toString('base64')}) format("woff2")`;
      });
      return { contents: `export default ${JSON.stringify(css)};`, loader: 'js' };
    });
  },
};

async function buildOne(entry, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
    plugins: [katexCssTextPlugin],
  });
  if (watch) { await ctx.watch(); }
  else { await ctx.rebuild(); await ctx.dispose(); }
  return ctx;
}

async function main() {
  await buildOne('src/webview/index.ts', 'dist/webview.js');
  await buildOne('src/webview/diffPane.ts', 'dist/diffPane.js');
  console.log(watch ? 'Watching webview + diff pane...' : 'Webview + diff pane built.');
}

main().catch(console.error);
