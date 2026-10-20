// Teste da ponte: serve este repositório (com o EmulatorJS e o Mesen-S dos repositórios vizinhos), abre
// teste/pagina.html no Chrome sem janela e mostra o resultado.
// Uso: node teste/rodar.mjs   (variáveis opcionais: CHROME, EMULATORJS e MESEN_S com os caminhos)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// O EmulatorJS e o núcleo Mesen-S vêm dos repositórios vizinhos (ou de onde as variáveis disserem).
const pastaEmulatorjs = path.resolve(raiz, process.env.EMULATORJS || "../355k-emulatorjs/emulatorjs");
const pastaMesenS = path.resolve(raiz, process.env.MESEN_S || "../355k-mesen-s/dist");
for (const p of [pastaEmulatorjs, pastaMesenS]) if (!existsSync(p)) throw new Error(`Pasta não encontrada: ${p}`);
const tipos = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".wasm": "application/wasm" };

// ROM mínima de SNES (LoROM, 32 KB, 8 KB de SRAM com bateria): grava 0x55 na SRAM, desliga a tela,
// pinta a cor de fundo de vermelho, liga a tela e fica em laço.
function romDeTeste() {
  const rom = new Uint8Array(0x8000);
  rom.set([0x78, 0x18, 0xfb, 0xa9, 0x55, 0x8f, 0x00, 0x00, 0x70, 0xa9, 0x80, 0x8d, 0x00, 0x21, 0x9c, 0x21, 0x21,
    0xa9, 0x1f, 0x8d, 0x22, 0x21, 0x9c, 0x22, 0x21, 0xa9, 0x0f, 0x8d, 0x00, 0x21, 0x80, 0xfe], 0);
  rom[0x100] = 0x40; // RTI para as interrupções
  const titulo = "TESTE 355K".padEnd(21, " ");
  for (let i = 0; i < 21; i++) rom[0x7fc0 + i] = titulo.charCodeAt(i);
  Object.assign(rom, { 0x7fd5: 0x20, 0x7fd6: 0x02, 0x7fd7: 0x05, 0x7fd8: 0x03, 0x7fd9: 0x01 });
  const vetor = (off, end) => { rom[off] = end & 0xff; rom[off + 1] = end >> 8; };
  for (const off of [0x7fea, 0x7fee, 0x7ffa, 0x7ffe]) vetor(off, 0x8100);
  vetor(0x7ffc, 0x8000);
  vetor(0x7fdc, 0xffff);
  let soma = 0;
  for (const b of rom) soma = (soma + b) & 0xffff;
  vetor(0x7fde, soma);
  vetor(0x7fdc, soma ^ 0xffff);
  return rom;
}

const rom = romDeTeste();
const servidor = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/rom-teste.sfc") return res.end(rom);
  const relativo = path.normalize(url).replace(/^[/\\]+/, "");
  // emulatorjs/... vem do 355k-emulatorjs, menos os arquivos do Mesen-S, que vêm do 355k-mesen-s.
  const [base, dentro] = relativo.startsWith("emulatorjs" + path.sep)
    ? existsSync(path.join(pastaMesenS, path.basename(relativo))) ? [pastaMesenS, path.basename(relativo)] : [pastaEmulatorjs, relativo.slice("emulatorjs".length + 1)]
    : [raiz, relativo];
  const arquivo = path.join(base, dentro);
  if (!arquivo.startsWith(base)) return res.writeHead(403).end();
  try {
    const dados = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": tipos[path.extname(arquivo)] || "application/octet-stream" });
    res.end(dados);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.on("listening", r));

const chrome = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);
if (!chrome) throw new Error("Chrome não encontrado: defina CHROME com o caminho dele.");

const perfil = mkdtempSync(path.join(tmpdir(), "ponte-teste-"));
const porta = 9300 + Math.floor(Math.random() * 600);
const nucleo = process.argv[2] || "mesen_s";
const navegador = spawn(chrome, ["--headless=new", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
  `http://127.0.0.1:${servidor.address().port}/teste/pagina.html?nucleo=${nucleo}`], { stdio: "ignore" });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  await esperar(500);
  try {
    const abas = await (await fetch(`http://127.0.0.1:${porta}/json`)).json();
    const aba = abas.find((a) => a.type === "page");
    if (aba) ws = new WebSocket(aba.webSocketDebuggerUrl);
  } catch {}
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const respostas = new Map();
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && respostas.has(d.id)) respostas.get(d.id)(d.result);
});
const avaliar = (expressao) => new Promise((r) => {
  const i = ++id;
  respostas.set(i, r);
  ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expressao, returnByValue: true } }));
});

let resultado = null;
for (let i = 0; i < 180 && !resultado; i++) {
  await esperar(1000);
  resultado = (await avaliar("window.__resultado || null")).result.value;
}
console.log(JSON.stringify(resultado || { ok: false, erro: "a página não terminou em 3 minutos" }));
navegador.kill();
servidor.close();
// O Chrome demora a soltar a pasta do perfil depois de fechado (no Windows, principalmente).
try { rmSync(perfil, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch {}
process.exit(resultado && resultado.ok ? 0 : 1);
