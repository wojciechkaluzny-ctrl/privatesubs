// Packs extension/ into dist/privatesubs-<version>.zip (manifest.json at the zip root),
// ready for "Load unpacked" (after extracting), GitHub Releases and the Chrome / Edge / Opera stores.
// Pure Node.js – no dependencies, works on Windows, macOS and Linux.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "extension");
const version = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")).version;
const OUT = path.join(ROOT, "dist", `privatesubs-${version}.zip`);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir, base = "") {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

const locals = [], centrals = [];
let offset = 0;
for (const { full, rel } of listFiles(SRC)) {
  const data = fs.readFileSync(full);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);        // version needed
  local.writeUInt16LE(0x0800, 6);    // UTF-8 names
  local.writeUInt16LE(8, 8);         // deflate
  local.writeUInt16LE(0, 10);        // time
  local.writeUInt16LE(0x21, 12);     // date (1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, comp);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + comp.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
const count = centrals.length / 2;
end.writeUInt16LE(count, 8);
end.writeUInt16LE(count, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...locals, centralBuf, end]));
console.log(`${path.relative(ROOT, OUT)} (${count} files)`);
