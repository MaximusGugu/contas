import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "localhost";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp"
};

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\\/])+/, "");
  let filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  res.setHeader("Content-Type", types[extname(filePath)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  createReadStream(filePath).pipe(res);
}).listen(port, host, () => {
  console.log(`http://${host}:${port}/`);
});
