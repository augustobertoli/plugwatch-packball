// ==UserScript==
// @name         PlugWatch (Packball) - VIP
// @namespace    pw-augusto
// @version      0.72
// @description  Alerta limpo (liga, jogo, minuto) do Packball para o Telegram, com painel lateral
// @match        *://packball.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  function ensurePanel() {
    if (document.getElementById("pw")) return;

    // ---------- UI ----------
    const css = `
#pw{position:fixed;left:16px;bottom:90px;z-index:2147483647;background:#111;color:#fff;padding:10px 12px;border-radius:10px;font:13px system-ui}
#pw .r{margin-top:6px;display:flex;gap:6px}
#pw button{background:#2b82f6;color:#fff;border:0;border-radius:8px;padding:6px 8px;cursor:pointer}
#pw button.secondary{background:#2a2a2a}
#pwm{margin-top:6px;opacity:.85}`;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    const box = document.createElement("div");
    box.id = "pw";
    box.innerHTML = `<b>PlugWatch</b>
      <div class="r">
        <button id="pwc">Configurar</button>
        <button id="pwt" class="secondary">Teste</button>
        <button id="pws" class="secondary">Iniciar</button>
      </div>
      <div id="pwm"></div>`;
    document.body.appendChild(box);

    // ---------- Estado ----------
    let S = {};
    try { S = JSON.parse(localStorage.getItem("PlugWatch") || "{}"); } catch { S = {}; }
    const save = () => localStorage.setItem("PlugWatch", JSON.stringify(S));
    const msg  = (t) => (document.getElementById("pwm").textContent = t);

    // ---------- Util ----------
    async function send(text){
      if(!S.token || !S.chat){ msg("Configure token/chat"); return; }
      const url  = `https://api.telegram.org/bot${encodeURIComponent(S.token)}/sendMessage`;
      const body = { chat_id:S.chat, text, parse_mode:"Markdown", disable_web_page_preview:true };
      try{
        const r = await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
        if(!r.ok) throw new Error("HTTP "+r.status);
        msg("Enviado ✅");
      }catch(e){ msg("Erro: "+e.message); }
    }

    function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return String(h); }

    // ---------- Parse: só liga, jogo (placar único) e minuto (com acréscimo) ----------
    function prettify(raw){
      raw = (raw||"").replace(/\s+/g," ").trim();

      // 1) Liga até hora/minuto/HT/FT
      let league="", minute="";
      let m = raw.match(/^(.*?)(\d{1,2}:\d{2})\s+(\d{1,2})\s*'\s*/); // ... 17:15 43'
      if(m){ league=m[1].trim(); minute=m[3]; raw=raw.slice(m[0].length).trim(); }
      else if((m=raw.match(/^(.*?)(\d{1,2}:\d{2})\s*/))){ league=m[1].trim(); raw=raw.slice(m[0].length).trim(); }
      else if((m=raw.match(/^(.*?)(?:\bHT\b|\bFT\b)\s*/i))){ league=m[1].trim(); raw=raw.slice(m[0].length).trim(); }
      else { const idx=raw.search(/\d+\s*-\s*\d+/); league=idx>10?raw.slice(0,idx).trim():""; if(idx>0) raw=raw.slice(idx).trim(); }

      // 2) Se começar com minuto (ex: "45(1) ' ..."), captura e remove
      let lead = raw.match(/^(\d{1,2})(?:\((\d{1,2})\))?\s*['’]\s*/); // 45' ou 45(1) '
      if (lead) {
        if (!minute) minute = lead[1] + (lead[2] ? `+${lead[2]}` : "");
        raw = raw.slice(lead[0].length).trim();
      }

        let line = "";
        // pega só o PRIMEIRO confronto e corta antes de novo placar, odds (1.28), ou " x "
        m = raw.match(
            /([A-Za-zÀ-ÿ0-9 .'"´`^~()\-\u2019]+?)\s+(\d+)\s*-\s*(\d+)\s+([A-Za-zÀ-ÿ0-9 .'"´`^~()\-\u2019]+?)(?=\s+\d+\s*-\s*\d+|\s+\d+\.\d+|\s+x\s+|$)/
        );
        if (m) {
            const home = m[1].trim(), g1 = m[2], g2 = m[3], away = m[4].trim();
            line = `${home} ${g1}-${g2} ${away}`;
        } else {
            line = raw.split(/\s{2,}/)[0] || raw;
        }


      // 4) Se terminar repetindo o mesmo placar, remove o último (A 0-0 B 0-0 -> A 0-0 B)
      (function(){
        const scores = line.match(/\d+\s*-\s*\d+/g);
        if (scores && scores.length >= 2) {
          const first = scores[0].replace(/\s+/g,'');
          const last  = scores[scores.length-1].replace(/\s+/g,'');
          if (first === last) line = line.replace(/\s+\d+\s*-\s*\d+\s*$/, '');
        }
      })();

      // 5) Número solto no final (tipo " ... Envigado 8")
      line = line.replace(/\s+\d{1,2}$/, "").trim();

      // 6) Se não pegou minuto ainda, tenta no meio do texto (inclui acréscimo)
      if(!minute){
        const mm = raw.match(/(\d{1,2})(?:\((\d{1,2})\))?\s*['’]/);
        if(mm) minute = mm[1] + (mm[2] ? `+${mm[2]}` : "");
      }

      return { league, minute, line };
    }

    const seen = {};
    let obs=null, running=false;

    function start(){
      if(!S.selector){ msg("Defina o seletor CSS (ex: ul.row)"); return; }
      obs && obs.disconnect();
      obs = new MutationObserver(ms=>{
        ms.forEach(m=>{
          m.addedNodes && m.addedNodes.forEach(n=>{
            if(n.nodeType!==1) return;
            const nodes = (n.matches && n.matches(S.selector)) ? [n] :
                          (n.querySelectorAll ? n.querySelectorAll(S.selector) : []);
            nodes.forEach(el=>{
              const raw = el.innerText; if(!raw) return;
              if(S.keyword && !(new RegExp(S.keyword,"i")).test(raw)) return;

              const p = prettify(raw);
              const id = hash(p.league+'|'+p.line);
              if(seen[id]) return; seen[id]=1;

              const txt = S.template
                ? S.template.replace(/\{text\}/g, raw).replace(/\{url\}/g, location.href)
                : `🚨 *Novo jogo detectado!*
🏆 *${p.league || 'Jogo'}*
⚽ ${p.line}${p.minute ? `\n⏱️ ${p.minute}’` : ''}

📊 *Link:* [Clique aqui para ver no site](${location.href})

⚙️ _Alerta automático gerado pelo PlugWatch_`;

              send(txt);
            });
          });
        });
      });
      obs.observe(document.body,{ childList:true, subtree:true });
      running = true;
      msg(`Observando… (${S.selector}${S.keyword?`, filtro: /${S.keyword}/i`:''})`);
      document.getElementById("pws").textContent = "Pausar";
    }

    function stop(){
      obs && obs.disconnect();
      running = false;
      document.getElementById("pws").textContent = "Iniciar";
      msg("Pausado");
    }

    // ---- Botões / Config ----
    document.getElementById("pwc").onclick = () => {
      const tkn = prompt("BOT_TOKEN do Telegram:", S.token || "");          if (tkn !== null) S.token = tkn;
      const cht = prompt("chat_id do Telegram:", S.chat || "");             if (cht !== null) S.chat = cht;
      const sel = prompt("CSS selector dos cards/linhas (ex: ul.row):", S.selector || ""); if (sel !== null) S.selector = sel;
      const flt = prompt("Filtro (regex opcional). Ex: Brasil|Over HT (vazio = todos):", S.keyword || ""); if (flt !== null) S.keyword = flt;

      // se deixar em branco, limpa mesmo (não restaura antigo)
      const tmp = prompt("Template (use {text} e {url}) - deixe vazio p/ padrão:", S.template || "");
      if (tmp !== null) S.template = tmp;

      save(); msg("Config salvo.");
    };
    document.getElementById("pwt").onclick = () => send("🔔 Teste do PlugWatch\n"+location.href);
    document.getElementById("pws").onclick = () => (running ? stop() : start());

    // Reinjeta se o site trocar via SPA
    setInterval(()=>{ if(!document.getElementById("pw")) ensurePanel(); }, 3000);
  }

  const tryInject = () => { try { ensurePanel(); } catch{} };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryInject);
  else tryInject();
  setTimeout(tryInject, 800);
  setInterval(tryInject, 3000);
})();
