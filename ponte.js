// Ponte do 355k: a página do emulador (EmulatorJS 4.2.3) que o 355k abre num iframe.
// Tudo que mexe por dentro do EmulatorJS fica aqui. Quem abre a página só conversa com ela por
// mensagens (postMessage), descritas no README. Licença: GPL-3.0, a mesma do EmulatorJS.
(() => {
  "use strict";

  const ORIGEM = location.origin; // só conversa com a página da mesma origem que abriu o iframe
  const PASTA = "emulatorjs/";

  // Sem isto o navegador apaga o canvas WebGL logo depois de mostrar cada quadro,
  // e capturas da tela (miniaturas, capa) saem pretas. O custo é desprezível nesses consoles.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (String(type).startsWith("webgl")) attrs = { ...attrs, preserveDrawingBuffer: true };
    return getContext.call(this, type, attrs);
  };

  // ---------- mensagens ----------
  // Pedido:   { ponte: 1, id, cmd, dados }
  // Resposta: { ponte: 1, id, ok: true, valor } ou { ponte: 1, id, ok: false, erro }
  // Evento:   { ponte: 1, evento, dados }
  const enviar = (msg) => parent.postMessage({ ponte: 1, ...msg }, ORIGEM);
  const evento = (nome, dados) => enviar({ evento: nome, dados });

  addEventListener("message", async (e) => {
    if (e.source !== parent || e.origin !== ORIGEM || !e.data || e.data.ponte !== 1 || !e.data.cmd) return;
    const { id, cmd, dados } = e.data;
    try {
      if (!Object.hasOwn(COMANDOS, cmd)) throw new Error(`Comando desconhecido: ${cmd}`);
      enviar({ id, ok: true, valor: await COMANDOS[cmd](dados || {}) });
    } catch (err) {
      enviar({ id, ok: false, erro: String((err && err.message) || err) });
    }
  });

  let ejs = null;
  let gm = null;
  let iniciado = false;
  let cfg = null; // o que veio em "iniciar"

  const precisaJogo = () => {
    if (!iniciado) throw new Error("O jogo ainda não começou.");
  };

  // ---------- controles ----------
  // Índices do RetroPad (os mesmos no Mesen-S, no mGBA, no melonDS e no PCSX). L2/R2/L3/R3 só no PS1.
  const RETROPAD = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11, l2: 12, r2: 13, l3: 14, r3: 15 };
  const NOME_DO_INDICE = Object.fromEntries(Object.entries(RETROPAD).map(([n, i]) => [i, n]));
  // Controle pela posição física, como no SNES: B embaixo, A à direita, Y à esquerda, X em cima.
  // Assim um 8BitDo (ou outro com layout de SNES) bate com os nomes, e um de Xbox fica na posição do original.
  const BOTAO_DO_CONTROLE = {
    b: "BUTTON_1", a: "BUTTON_2", y: "BUTTON_3", x: "BUTTON_4", select: "SELECT", start: "START", up: "DPAD_UP", down: "DPAD_DOWN",
    left: "DPAD_LEFT", right: "DPAD_RIGHT", l: "LEFT_TOP_SHOULDER", r: "RIGHT_TOP_SHOULDER",
    l2: "LEFT_BOTTOM_SHOULDER", r2: "RIGHT_BOTTOM_SHOULDER", l3: "LEFT_STICK", r3: "RIGHT_STICK",
  };
  // Os dois analógicos do DualShock (PS1, valem com o modo analógico ligado). Só no controle.
  const ANALOGICOS = {
    16: "LEFT_STICK_X:+1", 17: "LEFT_STICK_X:-1", 18: "LEFT_STICK_Y:+1", 19: "LEFT_STICK_Y:-1",
    20: "RIGHT_STICK_X:+1", 21: "RIGHT_STICK_X:-1", 22: "RIGHT_STICK_Y:+1", 23: "RIGHT_STICK_Y:-1",
  };

  // Os botões que existem em cada console.
  function botoesDo(sistema) {
    const nomes = Object.keys(RETROPAD).filter((n) => sistema === "psx" || !["l2", "r2", "l3", "r3"].includes(n));
    return sistema === "gba" ? nomes.filter((n) => n !== "x" && n !== "y") : nomes; // o GBA não tem X e Y
  }

  // Controles no formato do EmulatorJS a partir de { nomeDoBotão: nomeDaTecla } (teclas sem nome ficam vazias).
  function controlesDe(teclas) {
    const out = {};
    if (!teclas) return out;
    for (const nome of botoesDo(cfg.sistema)) out[RETROPAD[nome]] = { value: teclas[nome] || "", value2: BOTAO_DO_CONTROLE[nome] };
    if (cfg.sistema === "psx") for (const [i, v] of Object.entries(ANALOGICOS)) out[i] = { value: "", value2: v };
    return out;
  }

  // Controles guardados pelo EmulatorJS antes de L3/R3 e dos analógicos existirem: completa.
  function completarPs1() {
    if (cfg.sistema !== "psx") return;
    for (const p of [0, 1]) {
      for (const nome of ["l3", "r3"]) ejs.controls[p][RETROPAD[nome]] ||= { value: -1, value2: BOTAO_DO_CONTROLE[nome] };
      for (const [i, v] of Object.entries(ANALOGICOS)) ejs.controls[p][i] ||= { value: -1, value2: v };
    }
  }

  // A tecla de cada botão agora (o jogador pode ter trocado): { nomeDoBotão: nomeDaTecla ou "" }.
  function teclasAtuais(jogador) {
    const c = ejs.controls[jogador - 1] || {};
    const out = {};
    for (const nome of botoesDo(cfg.sistema)) {
      const codigo = c[RETROPAD[nome]]?.value;
      out[nome] = (codigo > 0 && ejs.keyMap[codigo]) || "";
    }
    return out;
  }

  // Troca a tecla de um botão. Se a tecla nova já era de outro botão (de qualquer jogador), ele fica com a
  // tecla antiga deste. Devolve quem trocou ({ player, index, old }) ou null.
  function trocar(controls, player, index, code) {
    const mine = (controls[player][index] ||= {});
    const old = mine.value;
    let swapped = null;
    for (const p in controls) {
      for (const i in controls[p]) {
        const c = controls[p][i];
        if (c?.value !== code || c === mine) continue;
        c.value = old;
        swapped = { player: Number(p), index: Number(i), old };
      }
    }
    mine.value = code;
    return swapped;
  }

  // O SNES, o GBA e o DS não têm analógico (e o PS1 no modo digital também não usa): o analógico esquerdo
  // vira direcional, junto com o direcional de verdade. O EmulatorJS só aceita um ouvinte por evento do
  // controle, por isso o original é embrulhado.
  function analogicoComoDirecional() {
    const LIMIAR = 0.5;
    const eixos = { LEFT_STICK_X: [6, 7], LEFT_STICK_Y: [4, 5] }; // [esquerda, direita] e [cima, baixo] no RetroPad
    const segurando = {}; // "jogador:índice" -> pressionado pelo analógico
    const original = ejs.gamepad.listeners.axischanged;
    ejs.gamepad.on("axischanged", (e) => {
      if (original) original(e);
      if (cfg.sistema === "psx" && cfg.analogico) return; // no modo analógico, o analógico é analógico mesmo
      const eixo = eixos[e.axis];
      const pad = ejs.gamepad.gamepads[e.gamepadIndex];
      if (!eixo || !pad) return;
      const jogador = ejs.gamepadSelection.indexOf(`${pad.id}_${pad.index}`);
      if (jogador < 0) return;
      const [neg, pos] = eixo;
      for (const [btn, on] of [[neg, e.value < -LIMIAR], [pos, e.value > LIMIAR]]) {
        const k = `${jogador}:${btn}`;
        if (!!segurando[k] === on) continue; // só manda quando muda, para não soltar o direcional à toa
        segurando[k] = on;
        gm.simulateInput(jogador, btn, on ? 1 : 0);
      }
    });
  }

  // ---------- modo analógico (PS1) ----------
  // O tipo de controle do PCSX não é uma opção do núcleo: é o "device" de cada porta no retroarch.cfg,
  // que o EmulatorJS escreve ao montar o GameManager. Por isso só vale ao abrir o jogo.
  const DUALSHOCK = 517; // RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_ANALOG, 1) no libretro do PCSX ReARMed
  // ponytail: troca o protótipo no "ready", que dispara 20 ms depois de começar e bem antes de o núcleo baixar
  // e o GameManager nascer. Se o EmulatorJS um dia criar o GameManager antes do ready, o modo analógico para de valer.
  function usarDualShock() {
    const GM = window.EJS_GameManager;
    if (cfg.sistema !== "psx" || !cfg.analogico || !GM) return;
    const original = GM.prototype.getRetroArchCfg;
    GM.prototype.getRetroArchCfg = function () {
      return original.call(this) + `input_libretro_device_p1 = "${DUALSHOCK}"\ninput_libretro_device_p2 = "${DUALSHOCK}"\n`;
    };
  }

  // ---------- disco com os arquivos já soltos (PS1) ----------
  // O EmulatorJS passa todo arquivo do jogo por checkCompression; só a chamada do jogo tem fileCb
  // (a do núcleo e a da BIOS seguem pelo caminho normal). Entrega os arquivos direto, sem pacote.
  function entregarArquivos(arquivos) {
    const original = ejs.checkCompression.bind(ejs);
    ejs.checkCompression = async (data, msg, fileCb) => {
      if (typeof fileCb !== "function") return original(data, msg, fileCb);
      for (const [i, f] of arquivos.entries()) {
        ejs.textElem.innerText = `Preparando o jogo (${i + 1} de ${arquivos.length})`;
        fileCb(f.nome, new Uint8Array(await f.dados.arrayBuffer()));
      }
      return {};
    };
  }

  // ---------- arquivos do emulador ----------
  function criarPastas(FS, caminho) {
    let atual = "";
    for (const parte of caminho.split("/").slice(0, -1)) {
      if (!parte) continue;
      atual += "/" + parte;
      if (!FS.analyzePath(atual).exists) FS.mkdir(atual);
    }
  }

  function esvaziar(FS, pasta) {
    if (!FS.analyzePath(pasta).exists) return;
    for (const nome of FS.readdir(pasta)) {
      if (nome === "." || nome === "..") continue;
      const p = `${pasta}/${nome}`;
      if (FS.isDir(FS.stat(p).mode)) {
        esvaziar(FS, p);
        FS.rmdir(p);
      } else FS.unlink(p);
    }
  }

  // ---------- aparência ----------
  // No menu de ajustes fica só "Graphics Settings". Esconde depois de montado (e não com EJS_hideSettings)
  // porque é ao montar que o EmulatorJS aplica o padrão de cada opção; uma opção escondida antes ficaria
  // sem padrão nenhum. Os títulos das seções não são traduzidos, por isso dá para achar pelo texto.
  function soGraficos() {
    const home = ejs.settingsMenu?.querySelector(".ejs_setting_menu");
    if (!home) return;
    let graficos = null;
    for (const item of home.children) {
      if (item.firstChild?.textContent === "Graphics Settings") {
        item.firstChild.textContent = "Gráficos";
        graficos = item;
      } else item.style.display = "none";
    }
    // A caixa do menu foi medida com tudo dentro: mede de novo (fechada, mediria zero; nada é pintado no meio).
    const antes = ejs.settingsMenu.style.display;
    ejs.settingsMenu.style.display = "";
    const tam = ejs.getElementSize(home);
    ejs.settingsMenu.style.display = antes;
    home.parentElement.style.width = `${tam.width + 20}px`;
    home.parentElement.style.height = `${tam.height}px`;
    // Com uma seção só, Ajustes já abre nela (o emulador abre o menu no próprio clique, antes deste ouvinte).
    const ajustes = ejs.elements.bottomBar?.settings?.[0]?.[0];
    if (ajustes && graficos) {
      ajustes.addEventListener("click", () => {
        if (ejs.settingsMenu.style.display !== "none") graficos.click();
      });
    }
  }

  // Barra do emulador só com os botões pedidos ("ajustes", "telaCheia"); o resto some.
  function soBotoesDaBarra(manter) {
    const bar = ejs.elements.bottomBar || {};
    const ficam = [];
    if (manter.includes("ajustes")) ficam.push(bar.settings?.[0]?.[0]);
    if (manter.includes("telaCheia")) ficam.push(...(bar.fullscreen || []));
    for (const el of ejs.elements.menu.children) {
      if (!ficam.some((k) => k && el.contains(k))) el.style.setProperty("display", "none", "important");
    }
  }

  function css(regras) {
    const s = document.createElement("style");
    s.textContent = regras;
    document.head.appendChild(s);
  }

  // ---------- carregando ----------
  // Avisa os passos do emulador (baixando o núcleo, preparando o jogo…), o erro, se houver, e quando aparece
  // imagem de verdade (confere o brilho da tela) ou passam 20 s de jogo (abertura que é preta mesmo).
  function acompanharCarregamento() {
    const sonda = document.createElement("canvas");
    sonda.width = 32;
    sonda.height = 24;
    const ctx = sonda.getContext("2d", { willReadFrequently: true });
    let ultimoPasso = null;
    let rodandoDesde = 0;
    const timer = setInterval(() => {
      const texto = ejs && ejs.textElem;
      if (texto && texto.classList.contains("ejs_error_text")) {
        clearInterval(timer);
        return evento("erro", { texto: texto.innerText });
      }
      if (!iniciado) {
        const passo = (texto && texto.innerText) || "";
        if (passo !== ultimoPasso) evento("passo", { texto: (ultimoPasso = passo) });
        return;
      }
      rodandoDesde ||= Date.now();
      if (Date.now() - rodandoDesde > 20_000 || temImagem()) {
        clearInterval(timer);
        evento("imagem");
      }
    }, 300);

    function temImagem() {
      try {
        ctx.drawImage(ejs.canvas, 0, 0, sonda.width, sonda.height);
      } catch {
        return true; // não deu para olhar a tela: melhor dizer que tem
      }
      const px = ctx.getImageData(0, 0, sonda.width, sonda.height).data;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) return true;
      return false;
    }
  }

  // ---------- jogar online (quem abriu a sala) ----------
  // A tela e o som vão por WebRTC direto para o convidado, que vira o jogador 2 e manda só os botões.
  // A troca de ofertas (sinalização) é com quem abriu a ponte: aqui só a conexão.
  let rede = null; // { pc } da conexão com o convidado
  let transmissao = null; // tela + som do emulador, criado uma vez e reaproveitado a cada convidado
  let aplicar = null; // o simulateInput original, usado para os botões do convidado
  const segurados = new Set(); // botões que o convidado está segurando

  // Com convidado, o jogador 2 é só dele: o teclado e o 2º controle daqui ficam mudos para o jogador 2.
  // O EmulatorJS manda todo botão local por gameManager.simulateInput, então basta filtrar ali.
  function assumirJogador2() {
    if (!aplicar) {
      aplicar = gm.simulateInput.bind(gm);
      gm.simulateInput = (player, index, value) => (player === 1 && rede?.pc ? undefined : aplicar(player, index, value));
    }
    for (let i = 0; i <= 13; i++) aplicar(1, i, 0); // solta o que estava segurado no controle 2 daqui
  }

  // O convidado manda [botão, 0|1]. Só os botões do controle (0 a 13): nada de atalhos do emulador.
  function botaoDoConvidado(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    const [index, value] = msg;
    if (!Number.isInteger(index) || index < 0 || index > 13 || (value !== 0 && value !== 1)) return;
    if (value) segurados.add(index);
    else segurados.delete(index);
    aplicar(1, index, value);
  }

  // Se o convidado cai segurando um botão, solta tudo para o jogador 2 não ficar andando sozinho.
  function soltarConvidado() {
    for (const index of segurados) aplicar?.(1, index, 0);
    segurados.clear();
  }

  // Espera juntar os caminhos de rede para mandar a oferta inteira de uma vez (com STUN leva menos de 1 s).
  function juntarCaminhos(pc, ms = 2000) {
    return new Promise((resolve) => {
      const confere = () => pc.iceGatheringState === "complete" && pronto();
      const pronto = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", confere); resolve(); };
      const timer = setTimeout(pronto, ms);
      pc.addEventListener("icegatheringstatechange", confere);
      confere();
    });
  }

  // ---------- comandos ----------
  const COMANDOS = {
    // Liga o emulador. dados: { nucleo, sistema, nomeDoJogo, rom (Blob) ou arquivos ([{ nome, dados: Blob }]),
    // cartucho (Uint8Array ou null), teclas ({ 1: {...}, 2: {...} ou null }), analogico, idDoJogo, idioma, cor, fundo,
    // soGraficos, barra (lista de botões ou null), controleNaTelaSoEmTelaCheia, semBotoesDeVelocidade }.
    // window.PONTE_OPCOES (se existir) completa e vence o que veio: serve para quem embute a página ajustar a aparência.
    iniciar(dados) {
      if (cfg) throw new Error("O emulador já foi iniciado.");
      cfg = { ...dados, ...(window.PONTE_OPCOES || {}) };
      if (cfg.controleNaTelaSoEmTelaCheia) css("#jogo:not(:fullscreen) .ejs_virtualGamepad_parent{display:none!important}");
      if (cfg.semBotoesDeVelocidade) css(".b_speed_fast,.b_speed_slow,.b_speed_rewind{display:none!important}");

      Object.assign(window, {
        EJS_player: "#jogo",
        EJS_core: cfg.nucleo,
        EJS_controlScheme: cfg.sistema,
        EJS_pathtodata: PASTA,
        // Disco com os arquivos já soltos: o emulador recebe um arquivo vazio e os de verdade em entregarArquivos.
        EJS_gameUrl: URL.createObjectURL(cfg.arquivos ? new Blob([new Uint8Array(1)]) : cfg.rom),
        EJS_gameName: cfg.nomeDoJogo,
        EJS_gameID: cfg.idDoJogo,
        EJS_language: cfg.idioma || "pt-BR",
        EJS_startOnLoaded: true,
        EJS_disableDatabases: true, // a ROM e os saves ficam com quem abriu a ponte
        EJS_color: cfg.cor,
        EJS_backgroundColor: cfg.fundo,
        EJS_defaultControls: { 0: controlesDe(cfg.teclas[1]), 1: controlesDe(cfg.teclas[2]), 2: {}, 3: {} },
        EJS_Buttons: {
          saveState: false, loadState: false, quickSave: false, quickLoad: false,
          saveSavFiles: false, loadSavFiles: false, netplay: false, cacheManager: false, exitEmulation: false,
        },
        EJS_ready: aoFicarPronto,
      });
      acompanharCarregamento();
      const s = document.createElement("script");
      s.src = PASTA + "loader.js";
      document.body.appendChild(s);
    },

    // Pede ao emulador para gravar o save do cartucho; os bytes chegam no evento "cartucho".
    salvarCartucho() {
      if (iniciado) gm.saveSaveFiles();
    },

    // { dados: Uint8Array, captura: Blob PNG ou null }
    async obterEstado() {
      precisaJogo();
      const dados = gm.getState();
      const shot = await ejs.takeScreenshot("canvas", "png", 1).catch(() => null);
      return { dados, captura: shot && shot.blob && shot.blob.size ? shot.blob : null };
    },

    carregarEstado({ dados }) {
      precisaJogo();
      gm.loadState(dados);
    },

    // A tela de agora, em PNG (Blob) ou null.
    async captura() {
      precisaJogo();
      const shot = await ejs.takeScreenshot("canvas", "png", 1).catch(() => null);
      return shot && shot.blob && shot.blob.size ? shot.blob : null;
    },

    mensagem({ texto }) {
      if (iniciado) ejs.displayMessage(texto);
    },

    // Pausa; devolve se estava rodando (para continuar depois só nesse caso).
    pausar() {
      if (!iniciado || ejs.paused) return false;
      ejs.pause();
      return true;
    },

    continuar() {
      if (iniciado && ejs.paused) ejs.play();
    },

    situacao() {
      return { iniciado, pausado: !!(ejs && ejs.paused) };
    },

    telaCheia() {
      precisaJogo();
      ejs.toggleFullscreen(true);
    },

    // As teclas só chegam ao jogo com ele em foco.
    focar() {
      ejs?.elements?.parent.focus();
    },

    discos() {
      precisaJogo();
      return { total: gm.getDiskCount(), atual: gm.getCurrentDisk() };
    },

    trocarDisco({ disco }) {
      precisaJogo();
      gm.setCurrentDisk(disco);
      ejs.displayMessage(`Disco ${disco + 1} colocado`);
    },

    // Nomes de tecla que o emulador conhece: { códigoDaTecla: nome }.
    mapaDeTeclas() {
      precisaJogo();
      return ejs.keyMap;
    },

    teclas({ jogador }) {
      precisaJogo();
      return teclasAtuais(jogador);
    },

    // Troca a tecla de um botão (pelo código da tecla, o keyCode). Devolve as teclas novas do jogador e, se
    // a tecla era de outro botão, quem ficou com a antiga: { teclas, trocou: { jogador, botao, tecla } ou null }.
    trocarTecla({ jogador, botao, codigo }) {
      precisaJogo();
      if (!ejs.keyMap[codigo]) throw new Error("Essa tecla o emulador não reconhece.");
      if (!(botao in RETROPAD)) throw new Error("Botão desconhecido.");
      const s = trocar(ejs.controls, jogador - 1, RETROPAD[botao], codigo);
      ejs.saveSettings();
      return {
        teclas: teclasAtuais(jogador),
        trocou: s && { jogador: s.player + 1, botao: NOME_DO_INDICE[s.index] || null, tecla: (s.old > 0 && ejs.keyMap[s.old]) || "" },
      };
    },

    // Volta teclado e controle de todos os jogadores ao padrão que veio em "iniciar".
    teclasPadrao() {
      precisaJogo();
      for (const n of [1, 2]) {
        const novos = controlesDe(cfg.teclas[n]);
        for (const i in novos) novos[i].value = parseInt(ejs.keyLookup(novos[i].value)) || 0;
        ejs.controls[n - 1] = novos;
      }
      completarPs1();
      ejs.saveSettings();
    },

    // Abre o menu de controles do próprio emulador (para trocar os botões do controle USB/Bluetooth).
    menuDoControle() {
      precisaJogo();
      ejs.controlMenu.style.display = "";
    },

    // Abre a conexão com um convidado e devolve a oferta ({ type, sdp }) para quem abriu a ponte repassar.
    // dados: { servidoresIce, bitrate }. A conexão avisa pelo evento "online" ({ estado }).
    async conectarConvidado({ servidoresIce, bitrate }) {
      precisaJogo();
      rede?.pc.close();
      soltarConvidado();
      assumirJogador2();
      transmissao ||= ejs.collectScreenRecordingMediaTracks(ejs.canvas, 60);
      const pc = new RTCPeerConnection({ iceServers: servidoresIce });
      rede = { pc };
      for (const track of transmissao.getTracks()) {
        pc.addTransceiver(track, {
          direction: "sendonly",
          streams: [transmissao],
          sendEncodings: track.kind === "video" ? [{ maxBitrate: bitrate }] : undefined,
        });
      }
      const canal = pc.createDataChannel("controles");
      canal.onmessage = (e) => botaoDoConvidado(e.data);
      canal.onclose = soltarConvidado;
      pc.onconnectionstatechange = () => {
        if (rede?.pc === pc) evento("online", { estado: pc.connectionState });
      };
      await pc.setLocalDescription(await pc.createOffer());
      await juntarCaminhos(pc);
      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    },

    async respostaDoConvidado({ descricao }) {
      if (rede) await rede.pc.setRemoteDescription(descricao);
    },

    desconectarConvidado() {
      rede?.pc.close();
      rede = null;
      soltarConvidado();
    },
  };

  // ---------- emulador pronto ----------
  function aoFicarPronto() {
    ejs = window.EJS_emulator;
    usarDualShock();
    if (cfg.arquivos) entregarArquivos(cfg.arquivos);
    // Bug do EmulatorJS 4.2.3: em jogo de vários discos ele monta o menu de discos antes de criar
    // allSettings, e o jogo "falha ao iniciar". Criar vazio antes resolve (o menu de opções recria depois).
    ejs.allSettings ||= {};

    // Saves antigos guardados no navegador pelo emulador: quem manda é o save que veio em "iniciar".
    ejs.on("saveDatabaseLoaded", (FS) => {
      try { esvaziar(FS, "/data/saves"); } catch (e) { console.warn(e); }
    });

    ejs.on("start", () => {
      gm = ejs.gameManager;
      if (cfg.cartucho && cfg.cartucho.length) {
        const caminho = gm.getSaveFilePath();
        criarPastas(gm.FS, caminho);
        if (gm.FS.analyzePath(caminho).exists) gm.FS.unlink(caminho);
        gm.FS.writeFile(caminho, cfg.cartucho);
        gm.loadSaveFiles();
        gm.restart(); // reinicia para o jogo ler o save logo na abertura
      }
      iniciado = true;
      analogicoComoDirecional();
      completarPs1();
      if (cfg.soGraficos) soGraficos();
      if (cfg.barra) soBotoesDaBarra(cfg.barra);
      ejs.elements.parent.focus();
      evento("iniciou", { discos: { total: gm.getDiskCount(), atual: gm.getCurrentDisk() }, estados: gm.supportsStates() });
    });

    // Disparado sempre que o emulador grava o save do cartucho.
    ejs.on("saveSaveFiles", (dados) => evento("cartucho", { dados: dados && dados.length ? dados.slice() : null }));
  }

  // Ao esconder ou fechar a página, grava o save do cartucho (vai pelo evento "cartucho").
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") COMANDOS.salvarCartucho();
  });
  addEventListener("pagehide", () => COMANDOS.salvarCartucho());

  // Mouse preso na tela (toque do DS): quem abriu a ponte pode avisar que a Esc solta.
  document.addEventListener("pointerlockchange", () => evento("mouse", { preso: !!document.pointerLockElement }));

  evento("pronta");
})();
