// Render the social share card (og:image / twitter:image) from its SVG source.
// X and most social platforms do not render SVG share images, so we ship a PNG.
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs/public",
);
const source = path.join(publicDir, "og-card.svg");
const target = path.join(publicDir, "og-card.png");

const info = await sharp(source, { density: 72 })
  .resize(1200, 630)
  .flatten({ background: "#071013" })
  .png({ compressionLevel: 9 })
  .toFile(target);

console.log(`og-card.png: ${info.width}x${info.height}, ${info.size} bytes`);
