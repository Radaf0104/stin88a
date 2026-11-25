// Tiny local web server (no install needed):  node serve.mjs   then open http://localhost:5173
// Local development only (this file is not uploaded to GitHub). Besides serving files it:
//  - supports byte ranges, so videos can be scrubbed/seeked (needed to pull frames out of the orbit video)
//  - accepts POST /__save?path=v2/... so the browser-based bake tools can write images/JSON into the v2 folder
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 5176; // V5
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".bin": "application/octet-stream",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".gz": "application/gzip", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".ktx2": "image/ktx2",
};
const saveRoot = join(root, "tools", "out") + sep; // dev tools may only write inside tools/out/

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/__save") {
      const file = normalize(join(root, url.searchParams.get("path") || ""));
      if (!file.startsWith(saveRoot)) { res.writeHead(403).end("only v2/ is writable"); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.concat(chunks));
      res.writeHead(200).end("saved");
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    const type = types[extname(file).toLowerCase()] || "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    const data = await readFile(file);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : info.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-cache" });
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`STIN 88A site running at http://localhost:${port}`));

