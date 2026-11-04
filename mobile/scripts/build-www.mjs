/* Builds mobile/www from the website's public pages.

   The app holds only the public directory: Find care, Ambulance and
   Contact us, plus the facility profile, thank-you, privacy and terms
   pages they link to. Admin and superadmin pages, their scripts and every
   link to them are left out. The pages call the live API, set by
   FINDCARE_API_ORIGIN (default https://findcareghana.com).

   Run:  npm run build   (from mobile/)
*/
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, '..', '..', 'frontend');
const OUT = join(here, '..', 'www');
const API_ORIGIN = process.env.FINDCARE_API_ORIGIN || 'https://findcareghana.com';

const PAGES = [
  'index.html', 'ambulance.html', 'facility.html', 'contact.html',
  'thank-you.html', 'privacy.html', 'terms.html',
];
const SCRIPTS = ['api.js', 'ui.js', 'home.js', 'facility.js', 'ambulance.js', 'contact.js'];
const IMAGES = ['findcareghana-logo.svg', 'findcareghana-icon.svg', 'findcareghana-icon-192.png'];

/* Each rule must match at least once somewhere, so a change to the website
   that the app no longer handles fails the build instead of slipping in. */
const RULES = [
  // Admin entry points.
  ['footer sign-in link', /\s*<li><a href="\/admin">.*?Facility sign in<\/a><\/li>/g, ''],
  ['contact page sign-in note', /\s*<p class="notice">Already listed\? <a href="\/admin">.*?<\/p>/g, ''],
  // Website-only: analytics and cookie banner, install manifest, sharing tags.
  ['site config script', /\s*<script src="\/site-config\.js"><\/script>/g, ''],
  ['cookie and analytics script', /\s*<script src="(\/)?js\/site\.js"><\/script>/g, ''],
  ['manifest link', /\s*<link rel="manifest"[^>]*>/g, ''],
  ['canonical link', /\s*<link rel="canonical"[^>]*>/g, ''],
  ['social sharing tags', /\s*<meta (property="og:|name="twitter:)[^>]*>/g, ''],
  ['structured data', /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''],
  // The pages live at the app's root; point root-relative assets there too.
  ['root-relative paths', /(href|src)="\/(css|js|images)\//g, '$1="$2/'],
  ['home links', /href="\/(\?[^"]*)?"/g, 'href="index.html$1"'],
  ['page links', /href="\/(ambulance|contact|privacy|terms|thank-you)\.html/g, 'href="$1.html'],
  // Native shell: draw under the status bar, add app styles, call the live API.
  ['viewport', /<meta name="viewport" content="width=device-width, initial-scale=1">/g,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'],
  ['app stylesheet', /(<link rel="stylesheet" href="css\/styles\.css">)/g,
    '$1\n<link rel="stylesheet" href="css/app.css">'],
  ['API origin', /(<script src="js\/api\.js"><\/script>)/g,
    `<script>window.API_ORIGIN = ${JSON.stringify(API_ORIGIN)};</script>\n$1`],
  ['app body class', /<body( class="([^"]*)")?>/g, (_, __, cls) => `<body class="${cls ? `${cls} ` : ''}in-app">`],
];

// Empty www/ rather than deleting it, so a preview server running in it survives.
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) rmSync(join(OUT, entry), { recursive: true, force: true });
mkdirSync(join(OUT, 'js'), { recursive: true });
mkdirSync(join(OUT, 'css'), { recursive: true });
mkdirSync(join(OUT, 'images'), { recursive: true });

const used = new Set();
for (const page of PAGES) {
  let html = readFileSync(join(FRONTEND, page), 'utf8');
  for (const [name, pattern, replacement] of RULES) {
    const next = html.replace(pattern, replacement);
    if (next !== html) used.add(name);
    html = next;
  }
  if (/\/admin|superadmin/.test(html)) {
    throw new Error(`${page} still links to an admin page`);
  }
  writeFileSync(join(OUT, page), html);
}
const unused = RULES.map(([name]) => name).filter((name) => !used.has(name));
if (unused.length) throw new Error(`Rules that matched nothing: ${unused.join(', ')}`);

for (const script of SCRIPTS) cpSync(join(FRONTEND, 'js', script), join(OUT, 'js', script));
for (const image of IMAGES) cpSync(join(FRONTEND, 'images', image), join(OUT, 'images', image));
cpSync(join(FRONTEND, 'css', 'styles.css'), join(OUT, 'css', 'styles.css'));
cpSync(join(here, '..', 'app.css'), join(OUT, 'css', 'app.css'));

console.log(`Built ${PAGES.length} pages into www/ (API: ${API_ORIGIN})`);
