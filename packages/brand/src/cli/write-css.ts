// Build step: renders tokens.ts to dist/*.css, imported by web/app/app.css.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toCssVariables, toTailwindTheme } from '../css-variables.js';
import { tokens } from '../tokens.js';

const header =
  '/* Generated from packages/brand/src/tokens.ts — do not edit. */\n';
const outputs = {
  'tokens.css': toCssVariables(tokens),
  'tailwind-theme.css': toTailwindTheme(tokens),
};

for (const [name, css] of Object.entries(outputs)) {
  const out = fileURLToPath(new URL(`../${name}`, import.meta.url));
  writeFileSync(out, header + css);
  console.log(`wrote ${out}`);
}
