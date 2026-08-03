import { spawn } from "node-pty";

const p = spawn("/bin/echo", ["pty-ok"], {
  name: "xterm",
  cols: 40,
  rows: 10,
  cwd: process.cwd(),
});
let out = "";
p.onData((d) => {
  out += d;
});
p.onExit(({ exitCode }) => {
  console.log(JSON.stringify({ exitCode, out: out.trim() }));
  process.exit(exitCode === 0 && out.includes("pty-ok") ? 0 : 1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(2);
}, 2500);
