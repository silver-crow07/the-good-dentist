import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the Phase 1 placeholder artwork in /public/images.
 *
 * Run with: `node scripts/generate-placeholders.mjs`
 * Replace the generated files with real clinic photography when available —
 * the file names are referenced from `data/`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "images");

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const INK = "#171914";
const MUTED = "#62665B";
const PRIMARY = "#5F7327";
const SOFT = "#A9BA78";

/** Line-art icon paths drawn inside a 0 0 100 100 viewBox. */
const icons = {
  tooth: `
    <path d="M50 20C40 12 26 12 20 20C13 29 15 42 19 53C22 62 25 70 27 80C28 88 30 94 34 94C38 94 39 86 41 78C43 70 45 66 50 66C55 66 57 70 59 78C61 86 62 94 66 94C70 94 72 88 73 80C75 70 78 62 81 53C85 42 87 29 80 20C74 12 60 12 50 20Z" />
    <path d="M36 34c4-4 10-6 14-6" />`,
  chair: `
    <rect x="27" y="26" width="18" height="40" rx="9" transform="rotate(-14 36 46)" />
    <rect x="30" y="58" width="46" height="14" rx="7" />
    <path d="M44 72v16M34 92h20" />
    <path d="M74 46h12M80 40v12" />`,
  equipment: `
    <rect x="14" y="22" width="72" height="46" rx="7" />
    <path d="M40 76h20M50 68v8" />
    <path d="M24 54l12-14 9 9 13-16 10 13" />
    <circle cx="70" cy="34" r="4" />`,
  building: `
    <path d="M20 84V42l30-18 30 18v42" />
    <path d="M12 84h76" />
    <rect x="42" y="56" width="16" height="28" rx="2" />
    <rect x="26" y="48" width="12" height="12" rx="2" />
    <rect x="62" y="48" width="12" height="12" rx="2" />`,
  people: `
    <circle cx="31" cy="34" r="12" />
    <circle cx="69" cy="34" r="12" />
    <path d="M13 82c0-12 8-20 18-20s18 8 18 20" />
    <path d="M51 82c0-12 8-20 18-20s18 8 18 20" />`,
  care: `
    <path d="M50 76s-24-15-24-31a13 13 0 0 1 24-7 13 13 0 0 1 24 7c0 16-24 31-24 31z" />
    <path d="M16 60c4 14 14 25 34 30 20-5 30-16 34-30" />
    <path d="M86 22l3 6 6 3-6 3-3 6-3-6-6-3 6-3z" />`,
  reception: `
    <circle cx="50" cy="30" r="13" />
    <path d="M31 58c0-11 8-19 19-19s19 8 19 19" />
    <rect x="16" y="58" width="68" height="20" rx="5" />
    <path d="M24 78v10M76 78v10" />`,
  map: `
    <path d="M50 90s27-27 27-48a27 27 0 1 0-54 0c0 21 27 48 27 48z" />
    <circle cx="50" cy="42" r="10" />`,
  portrait: `
    <circle cx="50" cy="38" r="19" />
    <path d="M17 94c0-19 15-32 33-32s33 13 33 32" />`,
  sparkle: `
    <path d="M50 14l7 24 24 7-24 7-7 24-7-24-24-7 24-7z" />
    <path d="M79 66l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />`,
};

function scene({ width, height, icon, title, subtitle, tint = "#F1F4E8" }) {
  const scale = Math.min(width, height) / 620;
  const iconSize = Math.round(150 * scale);
  const titleSize = Math.round(34 * scale);
  const subtitleSize = Math.round(15 * scale);
  const cx = width / 2;

  const gapTitle = Math.round(iconSize * 0.3);
  const gapSubtitle = Math.round(subtitleSize * 1.7);
  const blockHeight =
    iconSize + gapTitle + titleSize + gapSubtitle + subtitleSize;
  const top = Math.round((height - blockHeight) / 2);

  const iconY = top + iconSize / 2;
  const titleY = top + iconSize + gapTitle + titleSize;
  const subtitleY = titleY + gapSubtitle + subtitleSize;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} — placeholder image">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tint}" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0%" stop-color="${SOFT}" stop-opacity="0.16" />
      <stop offset="100%" stop-color="${SOFT}" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="${Math.round(46 * scale)}" height="${Math.round(46 * scale)}" patternUnits="userSpaceOnUse">
      <path d="M${Math.round(46 * scale)} 0H0V${Math.round(46 * scale)}" fill="none" stroke="${PRIMARY}" stroke-opacity="0.07" />
    </pattern>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect width="${width}" height="${height}" fill="url(#grid)" />
  <circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.16)}" r="${Math.round(Math.min(width, height) * 0.3)}" fill="url(#glow)" />
  <circle cx="${Math.round(width * 0.12)}" cy="${Math.round(height * 0.86)}" r="${Math.round(Math.min(width, height) * 0.26)}" fill="${tint}" opacity="0.85" />
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${Math.round(24 * scale)}" fill="none" stroke="#E8E6E1" />

  <g transform="translate(${cx - iconSize / 2}, ${iconY - iconSize / 2}) scale(${iconSize / 100})" fill="none" stroke="${PRIMARY}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
${icons[icon]}
  </g>

  <text x="${cx}" y="${titleY}" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" font-weight="600" fill="${INK}">${title}</text>
  <text x="${cx}" y="${subtitleY}" text-anchor="middle" font-family="${FONT}" font-size="${subtitleSize}" letter-spacing="${Math.round(subtitleSize * 0.18)}" fill="${MUTED}">${subtitle.toUpperCase()}</text>
</svg>
`;
}

const files = [
  {
    name: "hero-clinic.svg",
    width: 960,
    height: 1040,
    icon: "chair",
    title: "Treatment Room",
    subtitle: "Hero image placeholder",
  },
  {
    name: "why-choose-us.svg",
    width: 1000,
    height: 800,
    icon: "reception",
    title: "Clinic Interior",
    subtitle: "Section image placeholder",
  },
  {
    name: "about-clinic.svg",
    width: 1000,
    height: 800,
    icon: "care",
    title: "Patient Care",
    subtitle: "Section image placeholder",
  },
  {
    name: "reception.svg",
    width: 800,
    height: 600,
    icon: "reception",
    title: "Reception",
    subtitle: "Gallery placeholder",
  },
  {
    name: "treatment-room.svg",
    width: 800,
    height: 600,
    icon: "chair",
    title: "Treatment Room",
    subtitle: "Gallery placeholder",
  },
  {
    name: "dental-equipment.svg",
    width: 800,
    height: 600,
    icon: "equipment",
    title: "Dental Equipment",
    subtitle: "Gallery placeholder",
  },
  {
    name: "clinic-exterior.svg",
    width: 800,
    height: 600,
    icon: "building",
    title: "Clinic Exterior",
    subtitle: "Gallery placeholder",
  },
  {
    name: "team.svg",
    width: 800,
    height: 600,
    icon: "people",
    title: "Our Team",
    subtitle: "Gallery placeholder",
  },
  {
    name: "patient-care.svg",
    width: 800,
    height: 600,
    icon: "sparkle",
    title: "Patient Care",
    subtitle: "Gallery placeholder",
  },
  {
    name: "map-placeholder.svg",
    width: 800,
    height: 560,
    icon: "map",
    title: "Clinic Location",
    subtitle: "Map placeholder",
  },
  {
    name: "dr-portrait-1.svg",
    width: 440,
    height: 540,
    icon: "portrait",
    title: "Dentist Portrait",
    subtitle: "Replace with photo",
    tint: "#E9EFDA",
  },
  {
    name: "dr-portrait-2.svg",
    width: 440,
    height: 540,
    icon: "tooth",
    title: "Dentist Portrait",
    subtitle: "Replace with photo",
    tint: "#FAF7EC",
  },
];

mkdirSync(outDir, { recursive: true });

for (const file of files) {
  writeFileSync(join(outDir, file.name), scene(file), "utf8");
  console.log(`written public/images/${file.name}`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#F1F4E8" />
  <g transform="translate(5.58 4.52) scale(0.44)">
    <path
      d="M60 22 C72 12 87 16 92 31 C97 47 93 60 89 74 C86 86 84 100 78 108 C73 113 69 105 68 95 C66 87 64 84 60 82 C56 84 54 87 52 95 C51 105 47 113 42 108 C36 100 34 86 31 74 C27 60 23 47 28 31 C33 16 48 12 60 22 Z"
      fill="#657D29"
    />
  </g>
</svg>
`;

writeFileSync(join(root, "app", "icon.svg"), favicon, "utf8");
console.log("written app/icon.svg");
