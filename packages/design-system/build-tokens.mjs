#!/usr/bin/env node
// build-tokens.mjs - writes tokens.css from tokens.json. tokens.json is the only place a token value lives.
// Run after editing tokens.json: node packages/design-system/build-tokens.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const t = JSON.parse(readFileSync(new URL('tokens.json', here), 'utf8'));
const [first, ...rest] = t.color.themes.map(th => th.id);

// Colors and shadows carry a value per theme; a missing theme inherits the first.
const themed = [...t.color.tokens, ...(t.shadow?.tokens ?? [])];
const valueIn = (tok, theme) => (typeof tok.value === 'string' ? tok.value : tok.value[theme] ?? tok.value[first]);
const vars = (theme, indent) => themed.map(tok => `${indent}--${tok.name}: ${valueIn(tok, theme)};`).join('\n');
const plain = Object.entries(t)
  .filter(([key, fam]) => !['color', 'shadow', 'type'].includes(key) && Array.isArray(fam?.tokens))
  .flatMap(([, fam]) => fam.tokens.map(tok => `  --${tok.name}: ${tok.value};`));
const fonts = Object.entries(t.type.families).map(([k, v]) => `  --font-${k}: ${v};`);
const styles = t.type.groups.flatMap(g => g.styles.map(s => {
  const decl = [`font-family: var(--font-${s.family ?? g.family})`, `font-size: ${s.fontSize}`, `line-height: ${s.lineHeight}`, `font-weight: ${s.fontWeight}`];
  if (s.letterSpacing) decl.push(`letter-spacing: ${s.letterSpacing}`);
  return `.${s.name} { ${decl.join('; ')}; }`;
}));

const css = `/* Plaintask — generated from tokens.json by build-tokens.mjs. Do not edit. */
:root, [data-theme="${first}"] {
${vars(first, '  ')}
}
${rest.map(id => `@media (prefers-color-scheme: ${id}) {
  :root:not([data-theme="${first}"]) {
${vars(id, '    ')}
    color-scheme: ${id};
  }
}
[data-theme="${id}"] {
${vars(id, '  ')}
  color-scheme: ${id};
}`).join('\n')}
:root {
${[...plain, ...fonts].join('\n')}
}
${styles.join('\n')}
`;
writeFileSync(fileURLToPath(new URL('tokens.css', here)), css);
console.log(`tokens.css: ${themed.length} themed, ${plain.length} plain, ${styles.length} type styles`);
