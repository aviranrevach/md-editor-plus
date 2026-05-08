const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/webview/index.ts'],
    bundle: true,
    outfile: 'dist/webview.js',
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching webview...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Webview built.');
  }
}

main().catch(console.error);
