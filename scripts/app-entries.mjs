// index.html is the only editable application source. 404.html is generated.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../index.html', import.meta.url);
const target = new URL('../404.html', import.meta.url);
const bytes = await readFile(source);
if (process.argv.includes('--write')) {
  await writeFile(target, bytes);
  console.log(`Generated ${fileURLToPath(target)} from index.html`);
} else {
  const generated = await readFile(target).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!generated || !bytes.equals(generated)) {
    console.error('404.html is stale. Run npm run entries:sync; do not edit 404.html manually.');
    process.exitCode = 1;
  } else {
    console.log('PASS: index.html and generated 404.html are byte-identical.');
  }
}
