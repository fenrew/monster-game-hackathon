// Builds the client bundle and the server with esbuild.
//   node build.mjs          one-off production build
//   node build.mjs --watch  rebuild on change and restart the server
//   node build.mjs --test   build the test runner only
import { spawn } from 'child_process';
import esbuild from 'esbuild';
import fs from 'fs';

const watch = process.argv.includes('--watch');
const testOnly = process.argv.includes('--test');

fs.mkdirSync('dist/public', { recursive: true });

const copyStatic = () => {
  for (const f of ['index.html', 'style.css']) fs.copyFileSync(`client/${f}`, `dist/public/${f}`);
};

const serverOpts = {
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node16',
  sourcemap: true,
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
};

const clientOpts = {
  entryPoints: ['client/src/main.ts'],
  outfile: 'dist/public/bundle.js',
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

if (testOnly) {
  await esbuild.build({ ...serverOpts, entryPoints: ['server/test.ts'], outfile: 'dist/test.js' });
} else if (!watch) {
  copyStatic();
  await Promise.all([esbuild.build(serverOpts), esbuild.build(clientOpts)]);
} else {
  copyStatic();
  let child = null;
  const restart = () => {
    if (child) child.kill();
    child = spawn(process.execPath, ['--enable-source-maps', 'dist/server.js'], { stdio: 'inherit' });
  };
  const restartPlugin = { name: 'restart', setup(b) { b.onEnd((r) => { if (!r.errors.length) restart(); }); } };
  const staticPlugin = { name: 'static', setup(b) { b.onEnd(copyStatic); } };
  const s = await esbuild.context({ ...serverOpts, plugins: [restartPlugin] });
  const c = await esbuild.context({ ...clientOpts, plugins: [staticPlugin] });
  await Promise.all([s.watch(), c.watch()]);
  // Restart when data files change too, since the server reads them at startup.
  fs.watch('data', { persistent: true }, () => { clearTimeout(restart.t); restart.t = setTimeout(restart, 200); });
  fs.watch('client', { persistent: true }, (_, f) => { if (f === 'index.html' || f === 'style.css') copyStatic(); });
  console.log('Watching for changes...');
}
