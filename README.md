# 355k-ponte

A **ponte** do [355k](https://355k.essk.space): a página do emulador que o 355k abre num iframe e com a qual só conversa por mensagens (`postMessage`). Todo o código que mexe por dentro do [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) fica aqui, em `ponte.js`.

Licença: **GPL-3.0** (ver `LICENSE`), a mesma do EmulatorJS.

O site, o aplicativo e o servidor do 355k são outro programa, proprietário. Eles não incluem nem modificam nada daqui: abrem `emulador.html` num iframe e trocam as mensagens descritas abaixo.

## Como se monta

| Repositório | Vai em | O que é |
|---|---|---|
| **355k-ponte** (este) | `./` | `emulador.html` e `ponte.js` |
| [355k-emulatorjs](https://github.com/essk-97/355k-emulatorjs) | `./emulatorjs/` | EmulatorJS 4.2.3 sem modificações, com os núcleos de GBA, DS e PS1 |
| [355k-mesen-s](https://github.com/essk-97/355k-mesen-s) | `./emulatorjs/cores/` (e `mesen_s.json` em `cores/reports/`) | O núcleo de Super Nintendo |

Testado em conjunto: 355k-emulatorjs com o EmulatorJS 4.2.3 e 355k-mesen-s versão `355k-1`.

## A ponte

A página que abre o iframe e a ponte precisam ter a **mesma origem**: a ponte só aceita mensagens da janela que a abriu, com a mesma origem dela.

O iframe precisa de `allow="autoplay; fullscreen; gamepad; pointer-lock"` e `allowfullscreen`. Se o servidor bloqueia iframes (`X-Frame-Options`/`frame-ancestors`), ele precisa liberar esta página para a mesma origem.

### Formato

```js
// pedido (de quem abriu o iframe para a ponte)
iframe.contentWindow.postMessage({ ponte: 1, id: 7, cmd: "obterEstado", dados: {} }, location.origin);
// resposta
{ ponte: 1, id: 7, ok: true, valor: { dados: Uint8Array, captura: Blob } }   // ou { ok: false, erro: "texto" }
// evento (a ponte avisa sozinha)
{ ponte: 1, evento: "cartucho", dados: { dados: Uint8Array } }
```

Antes de mandar qualquer coisa, espere o evento `pronta`.

### Comandos

| Comando | Dados | Resposta |
|---|---|---|
| `iniciar` | ver abaixo | — |
| `salvarCartucho` | — | — (os bytes vêm no evento `cartucho`) |
| `obterEstado` | — | `{ dados: Uint8Array, captura: Blob PNG ou null }` |
| `carregarEstado` | `{ dados: Uint8Array }` | — |
| `captura` | — | `Blob` PNG da tela, ou `null` |
| `mensagem` | `{ texto }` | — (aviso sobre a tela do jogo) |
| `pausar` | — | `true` se estava rodando |
| `continuar` | — | — |
| `situacao` | — | `{ iniciado, pausado }` |
| `telaCheia` | — | — (precisa vir logo depois de um clique) |
| `focar` | — | — (o teclado só chega ao jogo com ele em foco) |
| `discos` | — | `{ total, atual }` (atual começa em 0) |
| `trocarDisco` | `{ disco }` | — |
| `mapaDeTeclas` | — | `{ códigoDaTecla: nome }` das teclas que o emulador conhece |
| `teclas` | `{ jogador }` (1 ou 2) | `{ botão: nomeDaTecla ou "" }` |
| `trocarTecla` | `{ jogador, botao, codigo }` | `{ teclas, trocou }`. Se a tecla era de outro botão (de qualquer jogador), os dois trocam, e `trocou` diz quem ficou com a antiga: `{ jogador, botao, tecla }` |
| `teclasPadrao` | — | — (volta às teclas que vieram em `iniciar`) |
| `menuDoControle` | — | — (abre o menu de controles do EmulatorJS) |
| `conectarConvidado` | `{ servidoresIce, bitrate }` | oferta WebRTC `{ type, sdp }` |
| `respostaDoConvidado` | `{ descricao }` | — |
| `desconectarConvidado` | — | — |

Botões: `up down left right a b x y l r select start`, e no PS1 também `l2 r2 l3 r3`. Teclas pelo nome do EmulatorJS (`"w"`, `"enter"`, `"numpad 4"`, `"up arrow"`…).

#### `iniciar`

```js
{
  nucleo: "mesen_s",            // ou o console ("gba", "nds", "psx") para o núcleo padrão do EmulatorJS
  sistema: "snes",              // snes | gba | nds | psx: layout dos botões
  nomeDoJogo: "jogo.sfc",       // a extensão importa para o núcleo
  rom: Blob,                    // ou null, com:
  arquivos: [{ nome, dados: Blob }], // vários arquivos já soltos (disco de PS1 com .cue e faixas)
  cartucho: Uint8Array | null,  // save do cartucho para carregar ao ligar
  teclas: { 1: { up: "w", … }, 2: { … } | null },
  analogico: false,             // PS1: liga o DualShock (só vale ao ligar)
  idDoJogo: "355k-2",           // chave em que o EmulatorJS guarda os controles no navegador
  idioma: "pt-BR", cor: "#4f3f86", fundo: "#141218",
  soGraficos: true,             // no menu de ajustes, só Gráficos
  barra: ["ajustes", "telaCheia"], // ou null: botões que ficam na barra do emulador
  controleNaTelaSoEmTelaCheia: false,
  semBotoesDeVelocidade: false, // sem Rápido/Lento/Voltar no controle na tela
}
```

Quem embute a página também pode definir `window.PONTE_OPCOES` antes de `ponte.js` rodar: essas opções completam e vencem as de `iniciar`.

### Eventos

| Evento | Dados |
|---|---|
| `pronta` | — |
| `passo` | `{ texto }`: o que o emulador está fazendo enquanto carrega |
| `iniciou` | `{ discos: { total, atual }, estados: true/false }` |
| `imagem` | — : apareceu imagem de verdade (ou 20 s de jogo) |
| `erro` | `{ texto }` |
| `cartucho` | `{ dados: Uint8Array ou null }`: o jogo gravou o save do cartucho (também ao esconder a página) |
| `mouse` | `{ preso }`: mouse preso na tela de toque do DS |
| `online` | `{ estado }`: estado da conexão com o convidado (`connected`, `failed`…) |

## Testar

Com o 355k-emulatorjs e o 355k-mesen-s clonados ao lado deste repositório:

```bash
node teste/rodar.mjs
```

Precisa do Node 22+ e do Chrome (ou defina `CHROME` com o caminho; `EMULATORJS` e `MESEN_S` apontam para as outras pastas, se estiverem em outro lugar). Liga o Mesen-S com uma ROM mínima feita pelo próprio teste e confere a imagem, o save do cartucho, os estados e a troca de teclas, só pelas mensagens. Sai com código 0 se passar.
