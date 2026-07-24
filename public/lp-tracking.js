/*!
 * Rastreio da landing page — Dashboard de Campanha (Consórcio)
 * ---------------------------------------------------------------------------
 * O que este arquivo faz:
 *   1. Captura UTMs e fbclid da URL e guarda em cookie first-party (a origem
 *      precisa sobreviver à navegação até o envio do formulário).
 *   2. Preenche campos ocultos utm_* do formulário, se existirem.
 *   3. Registra visita e cliques no CTA no dashboard.
 *   4. No envio do formulário, gera um event_id ÚNICO e dispara o mesmo evento
 *      pelo navegador (Pixel/GA4) e pelo servidor (CAPI) com esse id — é assim
 *      que a Meta deduplica e não conta o lead duas vezes.
 *
 * Como instalar (antes do </body>, DEPOIS do Pixel):
 *   <script>
 *     window.__DASH_CONFIG = {
 *       endpoint: "https://SEU-APP.vercel.app/api/track",
 *       ingestKey: "SUA_INGEST_KEY",   // = TRACK_INGEST_KEY no .env
 *       requireConsent: true            // LGPD: veja a nota no fim
 *     };
 *   </script>
 *   <script src="lp-tracking.js"></script>
 *
 * No formulário, marque os elementos:
 *   <form data-track="lead-form"> ... </form>
 *   <a data-track="cta"> Agendar reunião </a>
 *
 * LGPD: rastreio não essencial exige consentimento opt-in. Com
 * requireConsent: true nada dispara até a sua CMP chamar
 * window.dashConsent(true).
 */
(function () {
  "use strict";

  var CFG = window.__DASH_CONFIG || {};
  var ENDPOINT = CFG.endpoint || "";
  var COOKIE = "dash_attr";
  var MAX_AGE = 60 * 60 * 24 * 90; // 90 dias
  var ready = !CFG.requireConsent;
  var queue = [];

  if (!ENDPOINT) {
    console.warn("[dash] __DASH_CONFIG.endpoint não configurado — rastreio desligado.");
    return;
  }

  /* ---------------- cookies ---------------- */
  function setCookie(name, value, maxAge) {
    document.cookie =
      name + "=" + encodeURIComponent(value) + ";path=/;max-age=" + maxAge + ";SameSite=Lax";
  }
  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return m ? decodeURIComponent(m[2]) : "";
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ---------------- atribuição ---------------- */
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function readAttribution() {
    var params = new URLSearchParams(window.location.search);
    var stored = {};
    try {
      stored = JSON.parse(getCookie(COOKIE) || "{}");
    } catch (e) {
      stored = {};
    }

    var fresh = {};
    var hasFresh = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) {
        fresh[k] = v;
        hasFresh = true;
      }
    });

    var fbclid = params.get("fbclid");
    if (fbclid) {
      fresh.fbclid = fbclid;
      // formato exigido pela Meta quando o cookie _fbc ainda não existe
      fresh.fbc = "fb.1." + Date.now() + "." + fbclid;
      hasFresh = true;
    }
    var gclid = params.get("gclid");
    if (gclid) {
      fresh.gclid = gclid;
      hasFresh = true;
    }

    // Primeiro toque vence: só sobrescreve quando a URL traz parâmetros novos.
    var attr = hasFresh ? fresh : stored;
    if (hasFresh) setCookie(COOKIE, JSON.stringify(attr), MAX_AGE);
    return attr;
  }

  var attribution = readAttribution();

  function currentFbc() {
    return getCookie("_fbc") || attribution.fbc || "";
  }
  function currentFbp() {
    return getCookie("_fbp") || "";
  }
  /** client_id do GA4, extraído do cookie _ga (formato GA1.1.XXXX.YYYY). */
  function gaClientId() {
    var ga = getCookie("_ga");
    if (!ga) return "";
    var p = ga.split(".");
    return p.length >= 4 ? p[2] + "." + p[3] : "";
  }
  /**
   * session_id do GA4, do cookie _ga_<STREAM> (formato GS1.1.<session_id>....).
   * É ele que faz o evento server-side herdar origem/campanha da sessão.
   */
  function gaSessionId() {
    var m = document.cookie.match(/_ga_[A-Z0-9]+=GS\d+\.\d+\.(\d+)/);
    return m ? m[1] : "";
  }

  /* ---------------- envio ---------------- */
  function post(payload) {
    if (!ready) {
      queue.push(payload);
      return;
    }
    payload.ingestKey = CFG.ingestKey || "";
    payload.pageUrl = window.location.href;
    payload.attribution = attribution;
    payload.fbc = currentFbc();
    payload.fbp = currentFbp();
    payload.gaClientId = gaClientId();
    payload.gaSessionId = gaSessionId();

    // text/plain de propósito: mantém a requisição "simples" para CORS, senão o
    // navegador exige preflight — que o sendBeacon não sabe fazer.
    var body = JSON.stringify(payload);
    var TYPE = "text/plain;charset=UTF-8";
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: TYPE }));
        return;
      }
    } catch (e) {
      /* cai no fetch */
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": TYPE },
      body: body,
      keepalive: true,
      mode: "cors",
    }).catch(function () {});
  }

  function flush() {
    var pending = queue.slice();
    queue.length = 0;
    pending.forEach(post);
  }

  /** Chame window.dashConsent(true) quando a CMP autorizar. */
  window.dashConsent = function (granted) {
    ready = !!granted;
    if (ready) flush();
    else queue.length = 0;
  };

  /* ---------------- campos ocultos do formulário ---------------- */
  function fillHiddenFields(form) {
    UTM_KEYS.concat(["fbclid", "gclid"]).forEach(function (k) {
      var field = form.querySelector('[name="' + k + '"]');
      if (field && !field.value && attribution[k]) field.value = attribution[k];
    });
  }

  /* ---------------- eventos ---------------- */
  post({ type: "page_view" });

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-track="cta"]') : null;
    if (el) post({ type: "cta_click", label: (el.textContent || "").trim().slice(0, 80) });
  });

  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!form || form.getAttribute("data-track") !== "lead-form") return;

      fillHiddenFields(form);

      var data = new FormData(form);
      var get = function (names) {
        for (var i = 0; i < names.length; i++) {
          var v = data.get(names[i]);
          if (v) return String(v);
        }
        return "";
      };

      var eventId = uuid();

      // 1) navegador — Pixel e GA4, com o MESMO event_id do servidor
      try {
        if (window.fbq) window.fbq("track", "Lead", {}, { eventID: eventId });
      } catch (err) {}
      try {
        if (window.gtag) window.gtag("event", "generate_lead", { event_id: eventId });
      } catch (err) {}

      // 2) servidor — CAPI (deduplicado pelo event_id)
      post({
        type: "lead",
        eventId: eventId,
        name: get(["name", "nome", "full_name"]),
        email: get(["email", "e-mail"]),
        phone: get(["phone", "telefone", "whatsapp", "celular"]),
      });
    },
    true,
  );
})();
