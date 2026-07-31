#!/usr/bin/env node
/**
 * Compares the PRODUCTS array in an old vs new version of index.html
 * and posts a Discord embed for every newly-added product.
 *
 * Usage: node notify-new-products.js <old-file> <new-file>
 * Env:   DISCORD_WEBHOOK_URL (required)
 */

const fs = require('fs');
const https = require('https');

function extractProductsArrayText(html) {
  const startMarker = 'var PRODUCTS = [';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  // Walk forward from the opening '[' tracking bracket depth and string state
  // so we find the *matching* closing bracket, regardless of formatting.
  let i = startIdx + startMarker.length - 1; // index of the '['
  let depth = 0;
  let inString = false;
  let quoteChar = null;
  let escaped = false;

  for (; i < html.length; i++) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        // include this closing bracket
        return html.slice(startIdx + 'var PRODUCTS = '.length, i + 1);
      }
    }
  }
  return null; // unbalanced — bail out rather than guess
}

function parseProducts(html) {
  const arrayText = extractProductsArrayText(html);
  if (!arrayText) return [];
  try {
    // Safe here: this is our own repo's own source file, evaluated in CI only.
    // eslint-disable-next-line no-eval
    return eval(arrayText) || [];
  } catch (err) {
    console.error('Failed to parse PRODUCTS array:', err.message);
    return [];
  }
}

function productKey(p) {
  const id = p && p.src && p.src.id ? p.src.id : '';
  return `${p.brand || ''}|${p.name || ''}|${id}`;
}

function diffNewProducts(oldList, newList) {
  const oldKeys = new Set(oldList.map(productKey));
  return newList.filter(p => !oldKeys.has(productKey(p)));
}

const SITE_BASE_URL = 'https://cnfound.com';

function buildSiteImageUrl(imgPath) {
  if (!imgPath) return null;
  if (/^https?:\/\//.test(imgPath)) return imgPath;
  // Use the original PNG for Discord embeds (better compatibility than WebP)
  const encodedPath = imgPath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${SITE_BASE_URL}/${encodedPath}`;
}

function buildProductPageUrl(name) {
  return `${SITE_BASE_URL}/?product=${encodeURIComponent(name)}`;
}

function toEmbed(p) {
  const productUrl = buildProductPageUrl(p.name || '');
  const imageUrl = buildSiteImageUrl(p.img);

  const embed = {
    title: `🆕 ${p.name || 'New item'}`,
    url: productUrl, // clicking the title goes straight to the product on the site
    color: 0x5865f2,
    fields: [],
  };
  if (p.brand) embed.fields.push({ name: 'Brand', value: p.brand, inline: true });
  if (p.cat) embed.fields.push({ name: 'Category', value: p.cat, inline: true });
  embed.fields.push({ name: 'View on site', value: `[Open product page](${productUrl})`, inline: true });
  if (p.qc) embed.fields.push({ name: 'QC photos', value: `[View QC](${p.qc})`, inline: true });
  if (imageUrl) embed.image = { url: imageUrl }; // full-size picture, not just a thumbnail
  return embed;
}

function postToDiscord(webhookUrl, embeds) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify({
      content: `**${embeds.length} new item${embeds.length > 1 ? 's' : ''} added to CNFound**`,
      embeds,
    });
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`Discord webhook failed: ${res.statusCode} ${body}`));
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const [, , oldFile, newFile] = process.argv;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!oldFile || !newFile) {
    console.error('Usage: node notify-new-products.js <old-file> <new-file>');
    process.exit(1);
  }
  if (!webhookUrl) {
    console.error('DISCORD_WEBHOOK_URL is not set — skipping notification.');
    process.exit(0);
  }

  const oldHtml = fs.existsSync(oldFile) ? fs.readFileSync(oldFile, 'utf8') : '';
  const newHtml = fs.readFileSync(newFile, 'utf8');

  const oldProducts = parseProducts(oldHtml);
  const newProducts = parseProducts(newHtml);
  const added = diffNewProducts(oldProducts, newProducts);

  if (added.length === 0) {
    console.log('No new products detected — nothing to post.');
    return;
  }

  console.log(`Found ${added.length} new product(s). Posting to Discord...`);

  // Discord allows max 10 embeds per message — batch if needed.
  for (let i = 0; i < added.length; i += 10) {
    const batch = added.slice(i, i + 10).map(toEmbed);
    await postToDiscord(webhookUrl, batch);
  }

  console.log('Done.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  extractProductsArrayText,
  parseProducts,
  diffNewProducts,
  productKey,
  toEmbed,
  buildSiteImageUrl,
  buildProductPageUrl,
};
