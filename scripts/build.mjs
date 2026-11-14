import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const nearConnectCsp = { name: 'near-connect-style-nonce', setup(builder) { builder.onLoad({ filter: /near-connect[\/]build[\/]popups[\/]Popup\.js$/ }, async args => { const source = await readFile(args.path, 'utf8'); const anchor = 'document.head.append(style);'; if (!source.includes(anchor)) throw new Error('NEAR Connect style adapter requires review after dependency update.'); return { contents: source.replace(anchor, `style.nonce = document.querySelector('script[type=\"module\"]')?.nonce || ''; ${anchor}`), loader: 'js' }; }); } };
await build({ plugins: [nearConnectCsp], entryPoints: ['app/client.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/app.js', minify: true });
await copyFile('app/style.css', 'dist/style.css');
console.log('Dashboard bundle built in dist/.');
