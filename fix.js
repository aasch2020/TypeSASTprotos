import fs from "fs";

const file = "C:\\Users\\daial\\protos\\oldsymdex.ts";
let content = fs.readFileSync(file, "utf-8");
// Remove BOM if present
if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
fs.writeFileSync(file, content, "utf-8");
console.log("BOM removed and saved as UTF-8");