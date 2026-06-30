const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function buildOne(entry, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
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
