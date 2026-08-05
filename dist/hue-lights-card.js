/**
 * Hue Lights Card v2.4.5
 *
 * Pièces en dégradé façon Philips Hue, avec :
 *   — découverte automatique des lumières, regroupées par pièce
 *   — OU sélection manuelle d'entités (entities: [light.x, light.y])
 *   — découverte des scènes réelles de Home Assistant (pièce, group_name, recoupement)
 *   — navigation : grille → pièce (scènes + lampes) → sélecteur de couleur
 *   — sélection multiple des lampes dans le sélecteur
 *   — gestes configurables et garde-fous contre les appuis accidentels
 *   — éditeur visuel complet
 *
 * https://github.com/junkoku38/hue-lights-card
 */

const CARD_VERSION = "2.4.5";

console.info(
  `%c HUE-LIGHTS-CARD %c v${CARD_VERSION} `,
  "color:#0e1014;background:#e0499a;font-weight:700;border-radius:3px 0 0 3px;padding:2px 6px",
  "color:#ffb870;background:#0e1014;border-radius:0 3px 3px 0;padding:2px 6px"
);

/* ================================================================== */
/* Utilitaires                                                        */
/* ================================================================== */

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const fireEvent = (node, type, detail = {}) => {
  const ev = new CustomEvent(type, { bubbles: true, composed: true, detail });
  node.dispatchEvent(ev);
  return ev;
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function areaOf(hass, entityId) {
  const ent = hass.entities?.[entityId];
  if (!ent) return null;
  if (ent.area_id) return ent.area_id;
  const dev = ent.device_id ? hass.devices?.[ent.device_id] : null;
  return dev?.area_id || null;
}

/* ---- couleurs ---- */

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHs(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (mx === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  return [(h + 360) % 360, mx ? d / mx : 0];
}

function kelvinToRgb(k) {
  const t = clamp(k, 1500, 8000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (v) => clamp(Math.round(v), 0, 255);
  return [c(r), c(g), c(b)];
}

const rgbStr = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
const mixWhite = (a, k) => rgbStr(a.map((v) => Math.round(v + (255 - v) * k)));

/** Couleur affichée d'une lampe, d'après ses attributs réels. */
function lightColor(st) {
  const a = st?.attributes || {};
  if (Array.isArray(a.rgb_color)) return `rgb(${a.rgb_color.join(",")})`;
  if (Array.isArray(a.hs_color)) return rgbStr(hsvToRgb(a.hs_color[0], a.hs_color[1] / 100, 1));
  if (a.color_temp_kelvin) return rgbStr(kelvinToRgb(a.color_temp_kelvin));
  if (a.color_temp) return rgbStr(kelvinToRgb(1e6 / a.color_temp));
  return "rgb(255,196,120)";
}

/** Position sur la roue : teinte 0° à 3 heures, comme conic-gradient(from 90deg). */
const hueToKelvin = (h, lo, hi) => Math.round(lo + (hi - lo) * (1 - Math.abs(2 * (h / 360) - 1)));
const kelvinToHue = (k, lo, hi) => {
  const f = clamp((k - lo) / (hi - lo), 0, 1);
  return (1 - f) * 180; // moitié chaude de la roue par défaut
};

/* ---- icônes ---- */

const ICONS = {
  bulb: `<path d="M12 2a7 7 0 0 0-4 12.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3A7 7 0 0 0 12 2zm-2 19h4v.5a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 21.5V21z"/>`,
  living_room: `<path d="M4 9V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0-2 2v2H6v-2a2 2 0 0 0-2-2zm-1 3a1.5 1.5 0 0 1 3 0v4h12v-4a1.5 1.5 0 0 1 3 0v7h-2v-1H5v1H3v-7z"/>`,
  kitchen: `<path d="M8 2v7a3 3 0 0 0 2 2.8V22h2V11.8A3 3 0 0 0 14 9V2h-1.6v6H11V2H9.4v6H8V2zm8.5 0c-1.4 0-2.5 2-2.5 4.5S15 11 16.5 11V22h1.8V2h-1.8z"/>`,
  dining: `<path d="M11 2v8.5a2.5 2.5 0 0 1-2 2.4V22H7v-9.1a2.5 2.5 0 0 1-2-2.4V2h1.6v6h1.1V2h1.6v6h1.1V2H11zm5.6 0C15.2 2 14 4.2 14 7v5h2v10h2V2h-1.4z"/>`,
  bedroom: `<path d="M3 7h2v6h6V9h6a3 3 0 0 1 3 3v5h-2v-2H5v2H3V7zm4 1.5A1.75 1.75 0 1 1 7 12a1.75 1.75 0 0 1 0-3.5z"/>`,
  hallway: `<path d="M11 3H5v18h6v-2H7V5h4V3zm2 0v18h6V3h-6zm3 8.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>`,
  office: `<path d="M4 5h16v10H4V5zm2 2v6h12V7H6zM2 17h20v2H2v-2z"/>`,
  bathroom: `<path d="M6 3a3 3 0 0 1 3 3H7a1 1 0 0 0-2 0v6h16v2a5 5 0 0 1-3 4.6V21h-2v-2H8v2H6v-2.4A5 5 0 0 1 3 14v-2H2v-2h1V6a3 3 0 0 1 3-3z"/>`,
  garden: `<path d="M12 2c2.5 3 4 5.5 4 8a4 4 0 0 1-3 3.9V22h-2v-8.1A4 4 0 0 1 8 10c0-2.5 1.5-5 4-8z"/>`,
  garage: `<path d="M12 3 2 9v12h4v-8h12v8h4V9L12 3zM8 15h8v2H8v-2z"/>`,
  back: `<path d="M15.5 4 8 12l7.5 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  sun: `<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v3m0 14v3M2 12h3m14 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/>`,
  spark: `<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>`,
  check: `<path d="M9.6 16.2 5.4 12l1.4-1.4 2.8 2.8 7-7L18 7.8z"/>`,
  scene: `<path d="M12 3a9 9 0 1 0 9 9A6 6 0 0 1 12 3z"/>`,
};

function roomIcon(name) {
  const n = norm(name);
  if (/salon|living|sejour/.test(n)) return ICONS.living_room;
  if (/cuisine|kitchen/.test(n)) return ICONS.kitchen;
  if (/manger|dining/.test(n)) return ICONS.dining;
  if (/chambre|bedroom|dormir/.test(n)) return ICONS.bedroom;
  if (/couloir|hall|entree|escalier/.test(n)) return ICONS.hallway;
  if (/bureau|office|atelier/.test(n)) return ICONS.office;
  if (/bain|douche|wc|toilette/.test(n)) return ICONS.bathroom;
  if (/jardin|terrasse|exterieur/.test(n)) return ICONS.garden;
  if (/garage|cave|local/.test(n)) return ICONS.garage;
  return ICONS.bulb;
}

/* ---- mémoire des couleurs de scènes ---- */

const STORE_KEY = "hue-lights-card:scene-colors";

function loadSceneColors() {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function saveSceneColors(map) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch (_) {
    /* stockage indisponible : la carte fonctionne sans mémoire */
  }
}

/* ================================================================== */
/* Carte                                                              */
/* ================================================================== */

class HueLightsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._view = "grid";
    this._roomKey = null;
    this._sel = new Set();
    this._sig = "";
    this._interacting = false;
    this._pending = new Map();
    this._undo = null;
    this._undoTimer = null;
    this._sceneColors = loadSceneColors();
    this._watch = null;      // identifiants surveillés : lumières et scènes
    this._watchCount = 0;    // taille du registre au dernier balayage
    this._lastRefs = new Map();
  }

  /**
   * Le setter hass est appelé à chaque changement d'état de l'installation.
   * On ne fait le travail que si une lumière ou une scène a réellement bougé,
   * ce qui évite de parcourir tout le registre plusieurs fois par seconde.
   */
  _relevantChanged(hass) {
    const n = Object.keys(hass.states).length;
    if (!this._watch || n !== this._watchCount) {
      this._watchCount = n;
      this._watch = Object.keys(hass.states).filter(
        (id) => id.startsWith("light.") || id.startsWith("scene.")
      );
      this._lastRefs = new Map();
    }
    let changed = false;
    for (const id of this._watch) {
      const st = hass.states[id];
      if (this._lastRefs.get(id) !== st) {
        this._lastRefs.set(id, st);
        changed = true;
      }
    }
    return changed;
  }

  static getConfigElement() {
    return document.createElement("hue-lights-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:hue-lights-card",
      name: "Lumières",
      layout: "tiles",
      gesture: "horizontal",
      entities: [],
      group_by_area: true,
    };
  }

  setConfig(config) {
    this._config = {
      name: "Lumières",
      /* affichage */
      layout: "tiles", // tiles | rows
      columns: 2,
      show_header: true,
      show_off: true,
      show_unassigned: false,
      transparent: false,
      /* gestes */
      gesture: "horizontal", // horizontal | vertical_hold | none
      hold_ms: 220,
      tap_action: "open", // open | toggle
      /* garde-fous */
      guard_scroll: true,
      guard_thresholds: true,
      undo: true,
      undo_ms: 5000,
      /* scènes */
      show_scenes: true,
      scene_match: ["area", "group", "overlap"],
      max_scenes: 12,
      scene_transition: 1,
      allow_scene_create: true,
      learn_scene_colors: true,
      /* couleur */
      show_color_picker: true,
      /* filtres */
      exclude: [],
      areas: null,
      /* sélection explicite : liste d'entity_id à afficher.
         Si fourni, la découverte automatique est ignorée.
         Les lumières sont regroupées par pièce comme d'habitude. */
      entities: null,
      /* Si true, chaque lumière est sa propre "pièce" (pas de regroupement).
         Utile avec `entities` pour afficher des lampes éparses sans pièce commune. */
      group_by_area: true,
      ...(config || {}),
    };
    if (typeof this._config.exclude === "string")
      this._config.exclude = this._config.exclude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (typeof this._config.scene_match === "string")
      this._config.scene_match = this._config.scene_match.split(",").map((s) => s.trim());
    this._built = false;
    this._view = "grid";
    this._sig = "";
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }

  getCardSize() {
    return 10;
  }

  connectedCallback() {
    /* une carte sortie de l'écran cesse de se redessiner */
    if ("IntersectionObserver" in window && !this._io) {
      this._io = new IntersectionObserver((entries) => {
        this._visible = entries[0].isIntersecting;
        if (this._visible) {
          this._dirty = true;
          this._update();
        }
      });
      this._io.observe(this);
    }
    this._visible = true;
  }

  disconnectedCallback() {
    this._io?.disconnect();
    this._io = null;
  }

  set hass(hass) {
    const first = !this._hass;
    const changed = this._relevantChanged(hass);
    this._hass = hass;
    if (!this._built) this._build();
    /* rien de pertinent n'a bougé : on sort avant tout parcours coûteux */
    if (!first && !changed && !this._dirty) return;
    this._dirty = false;
    this._update();
  }

  /* ================= Découverte ================= */

  _rooms() {
    const c = this._config;
    const hass = this._hass;
    const exPat = c.exclude.map(norm);
    const areaFilter = c.areas ? c.areas.map(norm) : null;
    const rooms = new Map();

    /* Liste d'entités à parcourir :
       - `entities` explicite si fourni (sélection manuelle, light.* et switch.*)
       - sinon découverte automatique de toutes les light.* */
    const isLightOrSwitch = (id) => id && (id.startsWith("light.") || id.startsWith("switch."));
    const candidateIds = c.entities && c.entities.length
      ? c.entities.filter(isLightOrSwitch)
      : null;

    const sourceIds = candidateIds
      ? candidateIds
      : Object.keys(hass.states).filter((id) => id.startsWith("light."));

    sourceIds.forEach((id) => {
      const st = hass.states[id];
      if (!st || st.state === "unavailable") return;
      const reg = hass.entities?.[id];
      if (reg?.hidden || reg?.disabled_by) return;
      const label = norm(`${id} ${st.attributes?.friendly_name || ""}`);
      if (exPat.some((p) => label.includes(p))) return;

      const areaId = areaOf(hass, id);
      const areaName = areaId ? hass.areas?.[areaId]?.name : null;
      /* En mode sélection manuelle, on garde même les lampes sans pièce. */
      if (!candidateIds && !areaId && !c.show_unassigned) return;
      if (areaFilter && !candidateIds) {
        const an = norm(areaName || "");
        if (!areaFilter.includes(norm(areaId || "")) && !areaFilter.includes(an)) return;
      }
      /* Clé de regroupement : area si group_by_area, sinon l'id (1 lampe = 1 "pièce") */
      const key = c.group_by_area ? (areaId || (candidateIds ? null : "__none__")) : `e:${id}`;
      if (key === null && candidateIds) {
        /* sans pièce + group_by_area true en mode manuel : groupe "Sans pièce" */
      }
      const gKey = key || "__none__";
      if (!rooms.has(gKey)) {
        const gName = !c.group_by_area
          ? (st.attributes?.friendly_name || id)
          : (areaName || "Sans pièce");
        rooms.set(gKey, { key: gKey, areaId: c.group_by_area ? areaId : null, name: gName, lights: [] });
      }
      const isGroup = !id.startsWith("switch.") && Array.isArray(st.attributes?.entity_id)
        && st.attributes.entity_id.length > 0
        && st.attributes.entity_id.every((m) => m.startsWith("light."));
      rooms.get(gKey).lights.push({
        id,
        st,
        name: st.attributes?.friendly_name || id,
        on: st.state === "on",
        pct:
          st.attributes?.brightness != null
            ? Math.round((st.attributes.brightness / 255) * 100)
            : st.state === "on"
            ? 100
            : 0,
        color: lightColor(st),
        /* Capacités déduites du domaine et des color modes supportés */
        isSwitch: id.startsWith("switch."),
        isGroup,
        members: isGroup ? st.attributes.entity_id : null,
        dimmable: !id.startsWith("switch.") && st.attributes?.brightness != null
          || (Array.isArray(st.attributes?.supported_color_modes) &&
              st.attributes.supported_color_modes.some(m => ["brightness","dimmer","hs","rgb","rgbw","rgbww","xy","color_temp"].includes(m))),
        colorable: !id.startsWith("switch.") && (Array.isArray(st.attributes?.hs_color) ||
          Array.isArray(st.attributes?.rgb_color) ||
          (Array.isArray(st.attributes?.supported_color_modes) &&
           st.attributes.supported_color_modes.some(m => ["hs","rgb","rgbw","rgbww","xy"].includes(m)))),
        kelvinable: !id.startsWith("switch.") && (st.attributes?.color_temp_kelvin != null ||
          (Array.isArray(st.attributes?.supported_color_modes) &&
           st.attributes.supported_color_modes.includes("color_temp"))),
      });
    });

    return [...rooms.values()]
      .map((r) => {
        const on = r.lights.filter((l) => l.on);
        const pct = on.length
          ? Math.round(on.reduce((a, b) => a + b.pct, 0) / on.length)
          : 0;
        const colors = on.map((l) => l.color);
        while (colors.length && colors.length < 3) colors.push(colors[colors.length - 1]);
        /* Aplatir les membres : si une lampe est un groupe, on utilise
           ses membres à la place pour ids/onIds (commander les ampoules réelles). */
        const flatLights = r.lights.flatMap((l) => {
          if (l.isGroup && l.members) {
            return l.members.map((mid) => {
              const mst = this._hass.states[mid];
              if (!mst || mst.state === "unavailable") return null;
              return {
                id: mid,
                st: mst,
                name: mst.attributes?.friendly_name || mid,
                on: mst.state === "on",
                pct: mst.attributes?.brightness != null
                  ? Math.round((mst.attributes.brightness / 255) * 100)
                  : mst.state === "on" ? 100 : 0,
                color: lightColor(mst),
                isSwitch: false,
                isGroup: false,
                members: null,
                dimmable: mst.attributes?.brightness != null
                  || (Array.isArray(mst.attributes?.supported_color_modes) &&
                      mst.attributes.supported_color_modes.some(m2 => ["brightness","dimmer","hs","rgb","rgbw","rgbww","xy","color_temp"].includes(m2))),
                colorable: Array.isArray(mst.attributes?.hs_color) ||
                  Array.isArray(mst.attributes?.rgb_color) ||
                  (Array.isArray(mst.attributes?.supported_color_modes) &&
                   mst.attributes.supported_color_modes.some(m2 => ["hs","rgb","rgbw","rgbww","xy"].includes(m2))),
                kelvinable: mst.attributes?.color_temp_kelvin != null ||
                  (Array.isArray(mst.attributes?.supported_color_modes) &&
                   mst.attributes.supported_color_modes.includes("color_temp")),
              };
            }).filter(Boolean);
          }
          return [l];
        });
        const flatOn = flatLights.filter((l) => l.on);
        const flatColors = flatOn.map((l) => l.color);
        while (flatColors.length && flatColors.length < 3) flatColors.push(flatColors[flatColors.length - 1]);
        return {
          ...r,
          lights: r.lights,
          flatLights,
          on: on.length,
          total: r.lights.length,
          pct: this._pending.has(r.key) ? this._pending.get(r.key) : pct,
          colors: flatColors.slice(0, 3),
          ids: flatLights.map((l) => l.id),
          onIds: flatOn.map((l) => l.id),
        };
      })
      .sort((a, b) => b.on - a.on || a.name.localeCompare(b.name));
  }

  /** Scènes rattachées à une pièce, par trois critères cumulables. */
  _scenes(room) {
    const c = this._config;
    if (!c.show_scenes) return [];
    const hass = this._hass;
    const match = c.scene_match || [];
    const out = [];

    Object.keys(hass.states).forEach((id) => {
      if (!id.startsWith("scene.")) return;
      const st = hass.states[id];
      const reg = hass.entities?.[id];
      if (reg?.hidden || reg?.disabled_by) return;

      let ok = false;
      if (match.includes("area") && room.areaId && areaOf(hass, id) === room.areaId) ok = true;
      if (
        !ok &&
        match.includes("group") &&
        st.attributes?.group_name &&
        norm(st.attributes.group_name) === norm(room.name)
      )
        ok = true;
      if (!ok && match.includes("overlap")) {
        const targets = st.attributes?.entity_id || [];
        if (targets.some((t) => room.ids.includes(t))) ok = true;
      }
      if (!ok) return;

      out.push({
        id,
        name: st.attributes?.friendly_name || id.split(".")[1],
        dynamic: !!st.attributes?.is_dynamic,
        colors: this._sceneColors[id] || null,
        last: (st.state && st.state !== "unknown") ? (new Date(st.state).getTime() || 0) : 0,
      });
    });

    return out
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
      .slice(0, c.max_scenes);
  }

  _room(key) {
    return this._rooms().find((r) => r.key === key) || null;
  }

  _gradient(room) {
    if (!room.on || !room.colors.length) return "linear-gradient(120deg,#23262d,#1c1f26)";
    const [a, b, cc] = room.colors;
    return `linear-gradient(120deg,${a} 0%,${b || a} 50%,${cc || b || a} 100%)`;
  }

  /** Luminance perçue (0-1) d'une chaîne rgb(). */
  _luminance(rgbStr) {
    const m = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m) return 0;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  /** Overlay sombre selon la luminance : plus la couleur est claire, plus on assombrit. */
  _dim(room) {
    if (!room.on || !room.colors.length) return 0;
    const avg = room.colors.reduce((a, c) => a + this._luminance(c), 0) / room.colors.length;
    return Math.min(0.55, avg * 0.5);
  }

  /* ================= Services ================= */

  /** Sépare une liste d'entity_id par domaine (light. vs switch.). */
  _splitByDomain(ids) {
    const lights = [];
    const switches = [];
    for (const id of ids) {
      if (id.startsWith("switch.")) switches.push(id);
      else lights.push(id);
    }
    return { lights, switches };
  }

  /** Allume/éteint un mélange de light.* et switch.* */
  _turn(ids, on) {
    const { lights, switches } = this._splitByDomain(ids);
    if (lights.length) this._hass.callService("light", on ? "turn_on" : "turn_off", { entity_id: lights });
    if (switches.length) this._hass.callService("switch", on ? "turn_on" : "turn_off", { entity_id: switches });
  }

  _toggle(ids) {
    const { lights, switches } = this._splitByDomain(ids);
    if (lights.length) this._hass.callService("light", "toggle", { entity_id: lights });
    if (switches.length) this._hass.callService("switch", "toggle", { entity_id: switches });
  }

  _snapshot(ids) {
    return ids.map((id) => {
      const st = this._hass.states[id];
      return {
        id,
        state: st.state,
        brightness: st.attributes?.brightness,
        hs_color: st.attributes?.hs_color,
        color_temp_kelvin: st.attributes?.color_temp_kelvin,
      };
    });
  }

  _restore(snap) {
    snap.forEach((s) => {
      if (s.state !== "on") {
        this._turn([s.id], false);
        return;
      }
      const isSwitch = s.id.startsWith("switch.");
      if (isSwitch) { this._turn([s.id], true); return; }
      const data = { entity_id: s.id };
      if (s.brightness != null) data.brightness = s.brightness;
      if (s.hs_color) data.hs_color = s.hs_color;
      else if (s.color_temp_kelvin) data.color_temp_kelvin = s.color_temp_kelvin;
      this._hass.callService("light", "turn_on", data);
    });
  }

  _toggleRoom(room) {
    const snap = this._snapshot(room.ids);
    this._turn(room.ids, !room.on);
    this._showUndo(`${room.name} ${room.on ? "éteinte" : "allumée"}`, () => this._restore(snap));
  }

  _setBrightness(ids, pct) {
    if (!ids.length) return;
    /* Sépare les entités dimmables des non-dimmables (switchs, on/off only) */
    const dimmable = [];
    const onOffOnly = [];
    for (const id of ids) {
      const st = this._hass.states[id];
      const reg = this._hass.entities?.[id];
      const isSwitch = id.startsWith("switch.");
      const hasBrightness = st?.attributes?.brightness != null;
      const hasColorModes = Array.isArray(st?.attributes?.supported_color_modes) &&
        st.attributes.supported_color_modes.some(m => ["brightness","dimmer","hs","rgb","rgbw","rgbww","xy","color_temp"].includes(m));
      if (isSwitch || (!hasBrightness && !hasColorModes)) onOffOnly.push(id);
      else dimmable.push(id);
    }
    if (pct <= 0) {
      this._turn(ids, false);
      return;
    }
    if (dimmable.length)
      this._hass.callService("light", "turn_on", { entity_id: dimmable, brightness_pct: Math.round(pct) });
    if (onOffOnly.length)
      this._turn(onOffOnly, true);
  }

  _setColor(ids, payload) {
    if (!ids.length) return;
    /* Ne garde que les entités qui supportent la couleur/kelvin */
    const colorable = ids.filter((id) => {
      if (id.startsWith("switch.")) return false;
      const st = this._hass.states[id];
      if (!st) return false;
      if (payload.hs_color) {
        return Array.isArray(st.attributes?.hs_color) ||
          Array.isArray(st.attributes?.rgb_color) ||
          (Array.isArray(st.attributes?.supported_color_modes) &&
           st.attributes.supported_color_modes.some(m => ["hs","rgb","rgbw","rgbww","xy"].includes(m)));
      }
      if (payload.color_temp_kelvin) {
        return st.attributes?.color_temp_kelvin != null ||
          (Array.isArray(st.attributes?.supported_color_modes) &&
           st.attributes.supported_color_modes.includes("color_temp"));
      }
      return true;
    });
    const nonColor = ids.filter((id) => !colorable.includes(id));
    if (colorable.length)
      this._hass.callService("light", "turn_on", { entity_id: colorable, ...payload });
    if (nonColor.length)
      this._turn(nonColor, true);
  }

  _allOff() {
    const rooms = this._rooms().filter((r) => r.on);
    if (!rooms.length) return;
    const ids = rooms.flatMap((r) => r.onIds);
    const snap = this._snapshot(ids);
    this._turn(ids, false);
    this._showUndo("Toutes les lumières éteintes", () => this._restore(snap));
  }

  _activateScene(scene, room) {
    const c = this._config;
    if (scene.dynamic && this._hass.services?.hue?.activate_scene) {
      this._hass.callService("hue", "activate_scene", {
        entity_id: scene.id,
        dynamic: true,
      });
    } else {
      const data = { entity_id: scene.id };
      if (c.scene_transition) data.transition = c.scene_transition;
      this._hass.callService("scene", "turn_on", data);
    }
    if (c.learn_scene_colors) this._learnSceneColors(scene, room);
  }

  /** Après activation, relit les couleurs obtenues et les mémorise. */
  _learnSceneColors(scene, room) {
    const delay = (this._config.scene_transition || 1) * 1000 + 900;
    setTimeout(() => {
      const fresh = this._room(room.key);
      if (!fresh || !fresh.on) return;
      this._sceneColors[scene.id] = fresh.colors.slice(0, 3);
      saveSceneColors(this._sceneColors);
      this._sig = "";
      this._dirty = true;
      this._update();
    }, delay);
  }

  _createScene(room, name) {
    const slug =
      norm(name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") ||
      `scene_${Date.now().toString(36)}`;
    this._hass.callService("scene", "create", {
      scene_id: slug,
      snapshot_entities: room.ids,
    });
    const fresh = this._room(room.key);
    if (fresh) {
      this._sceneColors[`scene.${slug}`] = fresh.colors.slice(0, 3);
      saveSceneColors(this._sceneColors);
    }
    this._showUndo(`Scène « ${esc(name)} » enregistrée`, null);
  }

  /* ================= Annulation ================= */

  _showUndo(msg, fn) {
    if (!this._config.undo) return;
    const t = this.shadowRoot.querySelector(".toast");
    if (!t) return;
    this._undo = fn;
    t.querySelector(".tt").textContent = msg;
    t.querySelector(".tu").style.display = fn ? "" : "none";
    t.classList.add("show");
    const bar = t.querySelector(".bar");
    bar.style.transition = "none";
    bar.style.width = "100%";
    requestAnimationFrame(() => {
      bar.style.transition = `width ${this._config.undo_ms}ms linear`;
      bar.style.width = "0%";
    });
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => this._hideUndo(), this._config.undo_ms);
  }

  _hideUndo() {
    this.shadowRoot.querySelector(".toast")?.classList.remove("show");
    this._undo = null;
    clearTimeout(this._undoTimer);
  }

  /* ================= Construction ================= */

  _build() {
    const tr = this._config.transparent ? " transparent" : "";
    this.shadowRoot.innerHTML = `<style>${HueLightsCard.styles}</style>
      <ha-card class="${tr}">
        <div class="view"></div>
        <div class="toast"><span class="tt">—</span>
          <span class="tu">Annuler</span><span class="bar"></span></div>
      </ha-card>`;
    this._built = true;
    this._view = "grid";
    const t = this.shadowRoot.querySelector(".toast .tu");
    t.addEventListener("click", () => {
      if (this._undo) this._undo();
      this._hideUndo();
    });
  }

  _go(view, roomKey) {
    this._view = view;
    if (roomKey !== undefined) this._roomKey = roomKey;
    this._sig = "";
    this._dirty = true;
    this._update();
  }

  /* ================= Mise à jour ================= */

  _update() {
    if (!this._hass || !this._built || this._interacting) return;
    if (this._visible === false) return;
    const rooms = this._rooms();
    let sig = `${this._view}|${this._roomKey}|${[...this._sel].join()}|${this._config.layout}${this._config.columns}`;
    sig += rooms
      .map((r) => `${r.key}:${r.on}:${r.pct}:${r.colors.join()}`)
      .join("|");
    if (this._view !== "grid") {
      const room = this._room(this._roomKey);
      if (room) sig += "|" + this._scenes(room).map((s) => s.id + (s.colors || "")).join();
    }
    if (sig === this._sig) return;
    this._sig = sig;

    const host = this.shadowRoot.querySelector(".view");
    if (this._view === "grid") this._renderGrid(host, rooms);
    else if (this._view === "room") this._renderRoom(host);
    else this._renderColor(host);
  }

  /* ---------------- Vue 1 : grille ---------------- */

  _roomHtml(r) {
    const c = this._config;
    const grad = this._gradient(r);
    const dim = r.on ? Math.max(0, 1 - (r.pct / 100) * 0.9) : 0;
    const lum = this._dim(r);
    const nameE = esc(r.name);
    const sub = r.on
      ? `${r.on} lumière${r.on > 1 ? "s" : ""} · ${r.pct} %`
      : `${r.total} lumière${r.total > 1 ? "s" : ""} · éteinte${r.total > 1 ? "s" : ""}`;
    if (c.layout === "rows") {
      return `<div class="rw ${r.on ? "on" : "off"}" data-k="${esc(r.key)}">
        <div class="bg" style="background:${grad}"></div>
        <div class="ov" style="background:rgba(8,9,12,${Math.max(dim, lum).toFixed(2)})"></div>
        <div class="scrim"></div>
        <div class="ct">
          <div class="ic"><svg viewBox="0 0 24 24">${roomIcon(r.name)}</svg></div>
          <div class="tx"><b>${nameE}</b><span>${esc(sub)}</span></div>
          <div class="sw ${r.on ? "on" : ""}" data-sw="1"><i></i></div>
        </div>
        <div class="sl"><div class="tk"><div class="fl" style="width:${r.pct}%"></div>
          <div class="kn" style="left:${r.pct}%"></div></div></div>
        <div class="hud"><span class="hv">${r.pct}</span><small>%</small></div>
      </div>`;
    }
    return `<div class="tl ${r.on ? "on" : "off"}" data-k="${esc(r.key)}">
      <div class="bg" style="background:${grad}"></div>
      <div class="em" style="height:${100 - r.pct}%"></div>
      <div class="scrim" style="opacity:${lum.toFixed(2)}"></div>
      <div class="ct">
        <div class="top"><svg viewBox="0 0 24 24">${roomIcon(r.name)}</svg>
          <div class="sw ${r.on ? "on" : ""}" data-sw="1"><i></i></div></div>
        <div class="bot"><b>${nameE}</b><span>${r.on ? `${r.pct} %` : "Éteint"}</span></div>
      </div>
      <div class="hud"><span class="hv">${r.pct}</span><small>%</small></div>
    </div>`;
  }

  _renderGrid(host, rooms) {
    const c = this._config;
    const shown = c.show_off ? rooms : rooms.filter((r) => r.on);
    const onLights = rooms.reduce((a, r) => a + r.on, 0);
    const total = rooms.reduce((a, r) => a + r.total, 0);
    const onRooms = rooms.filter((r) => r.on).length;

    host.innerHTML = `
      ${
        c.show_header
          ? `<div class="hd">
               <div><div class="h1">${esc(c.name)}</div>
                 <div class="h2">${
                   rooms.length
                     ? onLights
                       ? `${onLights} sur ${total} allumées · ${onRooms} pièce${onRooms > 1 ? "s" : ""}`
                       : `${total} lumières · toutes éteintes`
                     : "Aucune lumière trouvée"
                 }</div></div>
               <div class="gsw ${onLights ? "on" : ""}"><i></i></div>
             </div>`
          : ""
      }
      <div class="body ${c.layout}" style="${
      c.layout === "tiles" ? `grid-template-columns:repeat(${c.columns},1fr)` : ""
    }">${shown.map((r) => this._roomHtml(r)).join("")}</div>`;

    host.querySelector(".gsw")?.addEventListener("click", () => this._allOff());
    host.querySelectorAll("[data-k]").forEach((el) => {
      const room = shown.find((r) => r.key === el.dataset.k);
      if (room) this._bindTile(el, room);
    });
  }

  _bindTile(el, room) {
    const c = this._config;
    let sx = 0,
      sy = 0,
      sp = room.pct,
      t0 = 0,
      scroll0 = 0,
      moved = 0,
      dragging = false,
      armed = false,
      onSwitch = false,
      timer = null,
      pct = room.pct;

    const em = el.querySelector(".em");
    const fl = el.querySelector(".fl");
    const kn = el.querySelector(".kn");
    const hv = el.querySelector(".hv");
    const paint = () => {
      const p = Math.round(pct);
      if (em) em.style.height = `${100 - p}%`;
      if (fl) fl.style.width = `${p}%`;
      if (kn) kn.style.left = `${p}%`;
      if (hv) hv.textContent = p;
    };

    el.addEventListener(
      "touchmove",
      (e) => {
        if (dragging || armed) e.preventDefault();
      },
      { passive: false }
    );

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      sx = e.clientX;
      sy = e.clientY;
      sp = pct;
      t0 = Date.now();
      moved = 0;
      dragging = false;
      armed = false;
      scroll0 = window.scrollY;
      onSwitch = !!e.target.closest("[data-sw]");
      this._interacting = true;
      if (c.gesture === "vertical_hold" && !onSwitch)
        timer = setTimeout(() => {
          armed = true;
          el.classList.add("armed");
          if (navigator.vibrate) navigator.vibrate(12);
        }, c.hold_ms);
    });

    el.addEventListener("pointermove", (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - sx;
      const dy = sy - e.clientY;
      moved = Math.max(moved, Math.hypot(dx, e.clientY - sy));
      if (onSwitch || c.gesture === "none") return;
      let delta = null;
      if (c.gesture === "horizontal") {
        if (Math.abs(dx) < 6) return;
        delta = (dx / el.getBoundingClientRect().width) * 130;
      } else {
        if (!armed) {
          if (moved > 8) clearTimeout(timer);
          return;
        }
        delta = (dy / el.getBoundingClientRect().height) * 130;
      }
      if (!dragging) {
        dragging = true;
        el.classList.add("drag");
      }
      pct = clamp(sp + delta, 0, 100);
      paint();
    });

    el.addEventListener("pointerup", (e) => {
      clearTimeout(timer);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (_) {}
      el.classList.remove("armed");
      this._interacting = false;
      const dt = Date.now() - t0;
      const scrolled = Math.abs(window.scrollY - scroll0);

      if (dragging) {
        el.classList.remove("drag");
        pct = Math.round(pct);
        paint();
        this._pending.set(room.key, pct);
        setTimeout(() => {
          this._pending.delete(room.key);
          this._sig = "";
        }, 2500);
        this._setBrightness(room.on ? room.onIds : room.ids, pct);
        dragging = false;
        return;
      }
      if (c.guard_scroll && scrolled > 4) return;
      if (c.guard_thresholds && moved > 10) return;
      if (c.guard_thresholds && dt < 60) return;

      if (onSwitch) {
        this._toggleRoom(room);
        return;
      }
      if (c.tap_action === "toggle") {
        this._toggleRoom(room);
        return;
      }
      this._go("room", room.key);
    });

    el.addEventListener("pointercancel", () => {
      clearTimeout(timer);
      el.classList.remove("drag", "armed");
      dragging = false;
      armed = false;
      this._interacting = false;
    });
  }

  /* ---------------- Vue 2 : pièce ---------------- */

  _renderRoom(host) {
    const c = this._config;
    const room = this._room(this._roomKey);
    if (!room) return this._go("grid");
    const scenes = this._scenes(room);
    const dim = room.on ? Math.max(0, 1 - (room.pct / 100) * 0.85) : 0;

    host.innerHTML = `
      <div class="rhead">
        <div class="rhbg" style="background:${this._gradient(room)}"></div>
        <div class="rhov" style="background:rgba(8,9,12,${dim.toFixed(2)})"></div>
        <div class="rhct">
          <div class="rhtop">
            <div class="rback"><svg viewBox="0 0 24 24">${ICONS.back}</svg></div>
            <div class="rname">${esc(room.name)}</div>
            <div class="sw ${room.on ? "on" : ""}" data-rsw="1"><i></i></div>
          </div>
          ${room.lights.some((l) => l.dimmable)
            ? `<div class="rslider"><div class="rfill" style="width:${room.pct}%"></div>
               <div class="rknob" style="left:${room.pct}%"></div></div>`
            : ""}
        </div>
      </div>

      ${
        c.show_scenes
          ? `<div class="rsec">Scènes${
              scenes.length ? "" : " · aucune trouvée pour cette pièce"
            }</div>
             ${
               scenes.length
                 ? `<div class="scenes">${scenes
                     .map(
                       (s) => `<div class="scn" data-s="${esc(s.id)}">
                         <div class="scdot" style="background:${
                           s.colors
                             ? `linear-gradient(135deg,${s.colors.join(",")})`
                             : "rgba(255,255,255,.10)"
                         }">${
                         s.colors
                           ? ""
                           : `<svg viewBox="0 0 24 24" style="fill:rgba(255,255,255,.55)">${ICONS.scene}</svg>`
                       }</div>
                         <b>${esc(s.name)}</b>
                         ${s.dynamic ? `<i class="dyn">dynamique</i>` : ""}
                       </div>`
                     )
                     .join("")}</div>`
                 : ""
             }`
          : ""
      }

      <div class="rsec rowsec"><span>Lumières</span>
        ${
          c.show_color_picker && room.lights.some((l) => l.colorable || l.kelvinable)
            ? `<span class="pill2" data-group="1">Couleur du groupe</span>`
            : ""
        }
        ${
          c.allow_scene_create
            ? `<span class="pill2" data-save="1">Enregistrer</span>`
            : ""
        }
      </div>
      <div class="lights">${room.lights
        .map((l) => {
          /* Un groupe est remplacé par ses membres directement */
          if (l.isGroup && l.members) {
            const memLights = l.members
              .map((mid) => {
                const mst = this._hass.states[mid];
                if (!mst || mst.state === "unavailable") return null;
                const md = mst.state === "on" ? Math.max(0, 1 - ((mst.attributes?.brightness || 255) / 255) * 0.8) : 0;
                return { mid, mst, md };
              })
              .filter(Boolean);
            if (memLights.length) {
              return memLights.map((m) => {
                const mColor = m.mst.state === "on" ? lightColor(m.mst) : "#2a2e36";
                return `<div class="lt ${m.mst.state === "on" ? "on" : "off"}" data-l="${esc(m.mid)}">
                  <div class="ltbg" style="background:${mColor}"></div>
                  <div class="ltov" style="background:rgba(8,9,12,${m.md.toFixed(2)})"></div>
                  <div class="scrim" style="opacity:${m.mst.state === "on" ? this._dim({colors:[mColor],on:true}).toFixed(2) : 0}"></div>
                  <div class="ltct">
                    <div class="ltic"><svg viewBox="0 0 24 24">${ICONS.bulb}</svg></div>
                    <div class="ltn">${esc(m.mst.attributes?.friendly_name || m.mid)}</div>
                    <div class="ltbar"><div class="ltsw ${m.mst.state === "on" ? "on" : ""}" data-lsw="${esc(m.mid)}"><i></i></div></div>
                  </div></div>`;
              }).join("");
            }
          }
          const d = l.on ? Math.max(0, 1 - (l.pct / 100) * 0.8) : 0;
          return `<div class="lt ${l.on ? "on" : "off"}" data-l="${esc(l.id)}">
            <div class="ltbg" style="background:${l.on ? l.color : "#2a2e36"}"></div>
            <div class="ltov" style="background:rgba(8,9,12,${d.toFixed(2)})"></div>
            <div class="scrim" style="opacity:${l.on ? this._dim({colors:[l.color],on:true}).toFixed(2) : 0}"></div>
            <div class="ltct">
              <div class="ltic"><svg viewBox="0 0 24 24">${ICONS.bulb}</svg></div>
              <div class="ltn">${esc(l.name)}</div>
              <div class="ltbar"><div class="ltsw ${l.on ? "on" : ""}" data-lsw="${
            esc(l.id)
          }"><i></i></div></div>
            </div></div>`;
        })
        .join("")}</div>`;

    host.querySelector(".rback").addEventListener("click", () => this._go("grid"));
    host
      .querySelector("[data-rsw]")
      .addEventListener("click", () => this._toggleRoom(room));

    /* curseur d'intensité de la pièce (seulement si des lampes sont dimmables) */
    const sl = host.querySelector(".rslider");
    if (sl) {
      const setFromX = (cx) => {
        const b = sl.getBoundingClientRect();
        const v = clamp(((cx - b.left) / b.width) * 100, 0, 100);
        host.querySelector(".rfill").style.width = `${v}%`;
        host.querySelector(".rknob").style.left = `${v}%`;
        return Math.round(v);
      };
      let sliding = false;
      sl.addEventListener("pointerdown", (e) => {
        sl.setPointerCapture(e.pointerId);
        sliding = true;
        this._interacting = true;
        setFromX(e.clientX);
      });
      sl.addEventListener("pointermove", (e) => sliding && setFromX(e.clientX));
      sl.addEventListener("pointerup", (e) => {
        sliding = false;
        this._interacting = false;
        const v = setFromX(e.clientX);
        this._setBrightness(room.on ? room.onIds : room.ids, v);
      });
    }

    host.querySelectorAll(".scn").forEach((el) =>
      el.addEventListener("click", () => {
        const sc = scenes.find((s) => s.id === el.dataset.s);
        if (sc) this._activateScene(sc, room);
      })
    );

    host.querySelector("[data-group]")?.addEventListener("click", () => {
      this._sel = new Set(room.ids);
      this._go("color");
    });

    host
      .querySelector("[data-save]")
      ?.addEventListener("click", () => this._openSaveDialog(room));

    host.querySelectorAll("[data-l]").forEach((el) => {
      let t0 = 0,
        moved = 0,
        sx = 0,
        sy = 0,
        onSw = false;
      el.addEventListener("pointerdown", (e) => {
        t0 = Date.now();
        moved = 0;
        sx = e.clientX;
        sy = e.clientY;
        onSw = !!e.target.closest("[data-lsw]");
      });
      el.addEventListener("pointermove", (e) => {
        moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
      });
      el.addEventListener("pointerup", () => {
        if (moved > 10 || Date.now() - t0 < 60) return;
        const id = el.dataset.l;
        if (onSw) {
          this._toggle([id]);
          /* Mise à jour visuelle immédiate du commutateur */
          const swEl = el.querySelector("[data-lsw]");
          if (swEl) {
            const light = room.lights.find((l) => l.id === id)
              || (room.flatLights || []).find((l) => l.id === id);
            if (light) {
              const newOn = !light.on;
              swEl.classList.toggle("on", newOn);
              light.on = newOn;
            }
          }
          this._sig = "";
          this._dirty = true;
          return;
        }
        if (!this._config.show_color_picker) {
          fireEvent(this, "hass-more-info", { entityId: id });
          return;
        }
        this._sel = new Set([id]);
        this._go("color");
      });
    });
  }

  /* ---------------- Vue 3 : couleur ---------------- */

  _kelvinRange(lights) {
    let lo = 2000;
    let hi = 6500;
    lights.forEach((l) => {
      const a = l.st.attributes || {};
      if (a.min_color_temp_kelvin) lo = Math.max(lo, a.min_color_temp_kelvin);
      if (a.max_color_temp_kelvin) hi = Math.min(hi, a.max_color_temp_kelvin);
    });
    return hi > lo ? [lo, hi] : [2000, 6500];
  }

  _lightHS(l) {
    const a = l.st.attributes || {};
    if (Array.isArray(a.hs_color)) return [a.hs_color[0], a.hs_color[1] / 100, "color"];
    if (Array.isArray(a.rgb_color) && a.rgb_color.length >= 3)
      return [...rgbToHs(a.rgb_color[0], a.rgb_color[1], a.rgb_color[2]), "color"];
    if (a.color_temp_kelvin) {
      const [lo, hi] = this._kelvinRange([l]);
      return [kelvinToHue(a.color_temp_kelvin, lo, hi), 0.7, "white"];
    }
    return [40, 0.7, "color"];
  }

  _renderColor(host) {
    const room = this._room(this._roomKey);
    if (!room) return this._go("grid");
    const lights = room.flatLights || room.lights;
    const sel = lights.filter((l) => this._sel.has(l.id));
    if (!sel.length) {
      this._sel = new Set([lights[0].id]);
      return this._renderColor(host);
    }
    const ref = sel[0];
    const [rh, rs, rmode] = this._lightHS(ref);
    /* Si on vient de sélectionner une couleur sur la roue, on garde la
       position du curseur au lieu de revenir à l'état brut de la lampe
       (qui peut différer à cause de l'arrondi hs_color ou de la latence HA). */
    const lastColorKey = [...this._sel].sort().join(",");
    const last = this._lastColor && this._lastColorKey === lastColorKey
      ? this._lastColor : null;
    const initH = last ? last.h : rh;
    const initS = last ? last.s : rs;
    const mode = this._mode || rmode;
    const [kLo, kHi] = this._kelvinRange(sel);
    const avg = Math.round(sel.reduce((a, b) => a + b.pct, 0) / sel.length) || 100;
    const allSel = sel.length === lights.length;
    /* Capacités de la sélection */
    const anyColorable = sel.some((l) => l.colorable || l.kelvinable);
    const anyDimmable = sel.some((l) => l.dimmable);
    const hasKelvin = sel.some((l) => l.kelvinable);

    host.innerHTML = `
      <div class="cptop">
        <div class="cpb" data-back="1"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round">${ICONS.back}</svg></div>
        ${
          this._config.allow_scene_create
            ? `<div class="cpb" data-save="1">Enregistrer la scène</div>`
            : ""
        }
        <div class="cpb right" data-done="1">Terminé</div>
      </div>
      <div class="cptitle">${
        sel.length === 1 ? esc(ref.name) : `${sel.length} lampes sélectionnées`
      }</div>
      ${anyColorable ? `<div class="wheelw">
        <div class="wheel ${mode}"></div>
        <div class="dots"></div>
        <div class="pin"><svg viewBox="0 0 38 46">
          <path d="M19 46C19 46 36 26.5 36 17A17 17 0 1 0 2 17C2 26.5 19 46 19 46Z" fill="${ref.color}"/>
        </svg><div class="pi"><svg viewBox="0 0 24 24">${ICONS.bulb}</svg></div></div>
      </div>` : `<div class="cp-no-color">Aucune lampe de la sélection ne supporte la couleur.</div>`}
      <div class="cpmodes">
        <div class="mchips">
          ${anyColorable ? `<div class="mc rainbow ${mode === "color" ? "on" : ""}" data-m="color"></div>` : ""}
          ${hasKelvin ? `<div class="mc white ${mode === "white" ? "on" : ""}" data-m="white"></div>` : ""}
          <div class="mc fx" data-m="fx"><svg viewBox="0 0 24 24">${ICONS.spark}</svg></div>
        </div>
        ${anyDimmable ? `<div class="cpbr">
          <div class="cpbrv">${avg} %</div>
          <div class="cpbrs"><div class="cpbrf" style="width:${avg}%"></div>
            <svg viewBox="0 0 24 24" style="stroke:#12151c">${ICONS.sun}</svg></div>
        </div>` : ""}
      </div>
      <div class="cpsel"><span class="cpsl">Appliquer à</span>
        <span class="pill2 ${allSel ? "on" : ""}" data-all="1">Toutes les lampes</span></div>
      <div class="cplights">${lights
        .map((l) => {
          const d = l.on ? Math.max(0, 1 - (l.pct / 100) * 0.8) : 0;
          return `<div class="cpl ${this._sel.has(l.id) ? "sel" : ""}" data-cl="${esc(l.id)}">
            <div class="ltbg" style="background:${l.on ? l.color : "#2a2e36"}"></div>
            <div class="ltov" style="background:rgba(8,9,12,${d.toFixed(2)})"></div>
            <div class="cpcheck"><svg viewBox="0 0 24 24">${ICONS.check}</svg></div>
            <div class="ltct"><div class="ltic"><svg viewBox="0 0 24 24">${ICONS.bulb}</svg></div>
              <div class="ltn">${esc(l.name)}</div>
              <div class="ltbar"><div class="ltsw ${l.on ? "on" : ""}" data-clsw="${
            esc(l.id)
          }"><i></i></div></div></div></div>`;
        })
        .join("")}</div>`;

    /* en-tête */
    host.querySelector("[data-back]").addEventListener("click", () => this._go("room"));
    host.querySelector("[data-done]").addEventListener("click", () => this._go("room"));
    host
      .querySelector("[data-save]")
      ?.addEventListener("click", () => this._openSaveDialog(room));

    /* sélection */
    host.querySelector("[data-all]").addEventListener("click", () => {
      this._sel = allSel ? new Set([ref.id]) : new Set(room.ids);
      this._go("color");
    });
    host.querySelectorAll("[data-cl]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-clsw]")) return;
        const id = el.dataset.cl;
        if (this._sel.has(id)) {
          if (this._sel.size > 1) this._sel.delete(id);
        } else this._sel.add(id);
        this._go("color");
      })
    );
    host.querySelectorAll("[data-clsw]").forEach((sw) =>
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggle([sw.dataset.clsw]);
        /* Mise à jour visuelle immédiate du commutateur */
        const light = lights.find((l) => l.id === sw.dataset.clsw);
        if (light) {
          const newOn = !light.on;
          sw.classList.toggle("on", newOn);
          light.on = newOn;
        }
        /* Force un re-render au prochain cycle hass */
        this._sig = "";
        this._dirty = true;
      })
    );

    /* modes */
    host.querySelectorAll(".mc[data-m]").forEach((m) =>
      m.addEventListener("click", () => {
        const v = m.dataset.m;
        if (v === "fx") {
          fireEvent(this, "hass-more-info", { entityId: ref.id });
          return;
        }
        this._mode = v;
        this._go("color");
      })
    );

    /* roue (seulement si des lampes sont colorables) */
    const ww = host.querySelector(".wheelw");
    if (ww) {
      const pin = host.querySelector(".pin");
      const dots = host.querySelector(".dots");
      const R = () => ww.clientWidth / 2;
      const pos = (h, s) => {
        const a = (h * Math.PI) / 180;
        const rad = s * R() * 0.94;
        return [R() + rad * Math.cos(a), R() + rad * Math.sin(a)];
      };
      let curH = initH;
      let curS = initS;
      const place = () => {
        const [x, y] = pos(curH, curS);
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;
        const col =
          mode === "white"
            ? mixWhite(kelvinToRgb(hueToKelvin(curH, kLo, kHi)), 1 - curS)
            : rgbStr(hsvToRgb(curH, curS, 1));
        pin.querySelector("path").setAttribute("fill", col);
        dots.innerHTML = lights
          .filter((l) => l.on && l.id !== ref.id && (l.colorable || l.kelvinable))
          .map((l) => {
            const [h2, s2] = this._lightHS(l);
            const [dx, dy] = pos(h2, s2);
            return `<div class="dot ${this._sel.has(l.id) ? "sel" : ""}"
              style="left:${dx}px;top:${dy}px;background:${l.color}"></div>`;
          })
          .join("");
      };
      place();

      const apply = (cx, cy, commit) => {
        const b = ww.getBoundingClientRect();
        const r0 = b.width / 2;
        const dx = cx - b.left - r0;
        const dy = cy - b.top - r0;
        const dist = Math.min(r0 * 0.94, Math.hypot(dx, dy));
        curH = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        curS = dist / (r0 * 0.94);
        place();
        this._lastColor = { h: curH, s: curS };
        this._lastColorKey = lastColorKey;
        if (!commit) return;
        const ids = [...this._sel];
        if (mode === "white")
          this._setColor(ids, { color_temp_kelvin: hueToKelvin(curH, kLo, kHi) });
        else
          this._setColor(ids, {
            hs_color: [Math.round(curH), Math.round(curS * 100)],
          });
      };
      let drag = false;
      ww.addEventListener("pointerdown", (e) => {
        ww.setPointerCapture(e.pointerId);
        drag = true;
        this._interacting = true;
        apply(e.clientX, e.clientY, false);
      });
      ww.addEventListener("pointermove", (e) => drag && apply(e.clientX, e.clientY, false));
      ww.addEventListener("pointerup", (e) => {
        drag = false;
        this._interacting = false;
        apply(e.clientX, e.clientY, true);
      });
    }

    /* intensité (seulement si des lampes sont dimmables) */
    const bs = host.querySelector(".cpbrs");
    if (bs) {
      const setB = (cx) => {
        const b = bs.getBoundingClientRect();
        const v = clamp(Math.round(((cx - b.left) / b.width) * 100), 1, 100);
        host.querySelector(".cpbrf").style.width = `${v}%`;
        host.querySelector(".cpbrv").textContent = `${v} %`;
        return v;
      };
      let bd = false;
      bs.addEventListener("pointerdown", (e) => {
        bs.setPointerCapture(e.pointerId);
        bd = true;
        this._interacting = true;
        setB(e.clientX);
      });
      bs.addEventListener("pointermove", (e) => bd && setB(e.clientX));
      bs.addEventListener("pointerup", (e) => {
        bd = false;
        this._interacting = false;
        this._setBrightness([...this._sel], setB(e.clientX));
      });
    }
  }

  /* ---------------- Boîte d'enregistrement ---------------- */

  _openSaveDialog(room) {
    const card = this.shadowRoot.querySelector("ha-card");
    if (card.querySelector(".dlg")) return;
    const cols = room.colors.length ? room.colors : ["#2a2e36", "#2a2e36", "#2a2e36"];
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.innerHTML = `<div class="dlgb">
      <div class="dlgt">Enregistrer la scène</div>
      <div class="dlgs">${room.on} lumière${room.on > 1 ? "s" : ""} allumée${
      room.on > 1 ? "s" : ""
    } sur ${room.total} · l'état exact de chaque lampe est capturé.</div>
      <div class="dlgp">${cols
        .slice(0, 4)
        .map((c) => `<i style="background:${c}"></i>`)
        .join("")}</div>
      <input class="dlgi" type="text" maxlength="32" placeholder="Nom de la scène">
      <div class="dlga">
        <div class="dlgbtn" data-cancel="1">Annuler</div>
        <div class="dlgbtn pri" data-ok="1">Enregistrer</div>
      </div></div>`;
    card.appendChild(dlg);
    const input = dlg.querySelector(".dlgi");
    input.value = `${room.name} ${new Date().toLocaleTimeString(
      this._hass?.locale?.language || "fr",
      { hour: "2-digit", minute: "2-digit" }
    )}`;
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
    const close = () => dlg.remove();
    dlg.querySelector("[data-cancel]").addEventListener("click", close);
    dlg.addEventListener("click", (e) => e.target === dlg && close());
    const save = () => {
      const name = (input.value || "").trim() || room.name;
      this._createScene(room, name);
      close();
      this._sig = "";
      this._update();
    };
    dlg.querySelector("[data-ok]").addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") close();
    });
  }
}

/* ================================================================== */
/* Styles                                                             */
/* ================================================================== */

HueLightsCard.styles = `
:host{display:block;}
*{box-sizing:border-box;}
ha-card{
  border-radius:var(--ha-card-border-radius,20px);
  background:#0e1014;border:1px solid rgba(255,255,255,.05);
  padding:16px 14px 14px;color:#eef1f6;position:relative;overflow:hidden;
  font-family:var(--primary-font-family,"Inter","Segoe UI",Roboto,sans-serif);
}
/* mode transparent : fond invisible, bordure invisible, padding réduit */
ha-card.transparent{
  background:transparent !important;border:none !important;
  padding:0;box-shadow:none !important;
}

/* ---- en-tête grille ---- */
.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 4px 0;}
.h1{font-size:22px;font-weight:700;letter-spacing:-.5px;}
.h2{font-size:11px;color:rgba(255,255,255,.4);margin-top:4px;}
.gsw{width:48px;height:28px;border-radius:15px;flex-shrink:0;cursor:pointer;
  background:rgba(255,255,255,.12);position:relative;transition:.2s;}
.gsw i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;
  background:rgba(255,255,255,.55);transition:.2s;}
.gsw.on{background:#3b82f6;} .gsw.on i{left:23px;background:#fff;}

.body{margin-top:15px;}
.body.tiles{display:grid;gap:8px;}
.body.rows{display:flex;flex-direction:column;gap:8px;}

/* ---- vignettes ---- */
.tl{position:relative;height:124px;border-radius:17px;overflow:hidden;
  touch-action:pan-y;user-select:none;-webkit-user-select:none;transition:transform .12s;}
.tl.drag{transform:scale(1.02);box-shadow:0 8px 26px rgba(0,0,0,.5);z-index:2;}
.tl.armed{box-shadow:0 0 0 2px rgba(255,255,255,.55),0 8px 26px rgba(0,0,0,.5);}
.tl.off{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}
.tl .bg{position:absolute;inset:0;}
.tl .scrim{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(to bottom,rgba(8,9,12,0) 35%,rgba(8,9,12,.45) 70%,rgba(8,9,12,.72) 100%);
  opacity:0;transition:opacity .2s;}
.tl .em{position:absolute;left:0;right:0;top:0;background:rgba(8,9,12,.82);
  border-bottom:1px solid rgba(255,255,255,.16);transition:height .18s;}
.tl.drag .em{transition:none;border-bottom-color:rgba(255,255,255,.55);}
.tl.off .em{border-bottom:none;background:rgba(8,9,12,.86);}
.tl .ct{position:relative;height:100%;display:flex;flex-direction:column;
  justify-content:space-between;padding:12px 13px;}
.tl .top{display:flex;align-items:flex-start;justify-content:space-between;}
.tl .top svg{width:19px;height:19px;fill:rgba(255,255,255,.92);pointer-events:none;
  filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));}
.tl.off .top svg{fill:rgba(255,255,255,.3);}
.tl .bot{pointer-events:none;}
.tl .bot b{display:block;font-size:13px;font-weight:600;
  text-shadow:0 1px 4px rgba(0,0,0,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tl .bot span{display:block;font-size:11px;color:rgba(255,255,255,.72);margin-top:2px;
  font-variant-numeric:tabular-nums;}
.tl.off .bot b{color:rgba(255,255,255,.55);}
.tl.off .bot span{color:rgba(255,255,255,.28);}

/* ---- barres ---- */
.rw{position:relative;height:76px;border-radius:16px;overflow:hidden;
  touch-action:pan-y;user-select:none;-webkit-user-select:none;transition:transform .12s;}
.rw.drag{transform:scale(1.01);box-shadow:0 8px 26px rgba(0,0,0,.5);z-index:2;}
.rw.armed{box-shadow:0 0 0 2px rgba(255,255,255,.55);}
.rw.off{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}
.rw .bg,.rw .ov{position:absolute;inset:0;}
.rw .scrim{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(to right,rgba(8,9,12,.45) 0%,rgba(8,9,12,.15) 40%,rgba(8,9,12,.45) 100%);
  opacity:0;transition:opacity .2s;}
.rw .ct{position:relative;display:flex;align-items:center;gap:11px;padding:13px 14px 0;}
.rw .ic{width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;
  justify-content:center;pointer-events:none;}
.rw .ic svg{width:20px;height:20px;fill:rgba(255,255,255,.92);
  filter:drop-shadow(0 1px 3px rgba(0,0,0,.35));}
.rw.off .ic svg{fill:rgba(255,255,255,.35);}
.rw .tx{flex:1;min-width:0;pointer-events:none;}
.rw .tx b{display:block;font-size:14.5px;font-weight:600;letter-spacing:-.1px;
  text-shadow:0 1px 3px rgba(0,0,0,.35);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rw .tx span{display:block;font-size:10.5px;color:rgba(255,255,255,.62);margin-top:2px;}
.rw.off .tx b{color:rgba(255,255,255,.62);}
.rw .sl{position:relative;padding:0 14px;margin-top:14px;pointer-events:none;}
.rw .tk{position:relative;height:4px;border-radius:2px;background:rgba(255,255,255,.18);}
.rw.off .tk{background:rgba(255,255,255,.06);}
.rw .fl{position:absolute;left:0;top:0;bottom:0;border-radius:2px;
  background:rgba(255,255,255,.55);transition:width .18s;}
.rw.drag .fl{transition:none;}
.rw .kn{position:absolute;top:50%;transform:translate(-50%,-50%);width:15px;height:15px;
  border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:left .18s;}
.rw.drag .kn{transition:none;}

/* ---- commutateur commun ---- */
.sw{width:38px;height:23px;border-radius:12px;flex-shrink:0;cursor:pointer;
  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.2);position:relative;
  transition:.2s;}
.sw::before{content:"";position:absolute;inset:-9px;}
.sw i{position:absolute;top:2.5px;left:3px;width:16px;height:16px;border-radius:50%;
  background:rgba(255,255,255,.45);transition:.2s;pointer-events:none;}
.sw.on{background:rgba(255,255,255,.28);border-color:rgba(255,255,255,.45);}
.sw.on i{left:17px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);}

/* ---- valeur pendant le geste ---- */
.hud{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(.8);
  display:flex;align-items:baseline;gap:1px;opacity:0;transition:.14s;pointer-events:none;
  font-variant-numeric:tabular-nums;text-shadow:0 2px 10px rgba(0,0,0,.7);}
.hud span{font-size:36px;font-weight:200;letter-spacing:-2px;}
.hud small{font-size:13px;opacity:.65;}
.drag .hud{opacity:1;transform:translate(-50%,-50%) scale(1);}
.drag .bot,.drag .top,.drag .tx,.drag .ic{opacity:.25;transition:.14s;}

/* ---- vue pièce ---- */
.rhead{position:relative;border-radius:18px;overflow:hidden;padding:14px 15px 16px;}
.rhbg,.rhov{position:absolute;inset:0;}
.rhct{position:relative;}
.rhtop{display:flex;align-items:center;gap:10px;}
.rback{width:34px;height:34px;border-radius:50%;flex-shrink:0;cursor:pointer;
  background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.18);
  display:flex;align-items:center;justify-content:center;color:#fff;}
.rback svg{width:16px;height:16px;}
.rname{flex:1;font-size:19px;font-weight:700;letter-spacing:-.3px;
  text-shadow:0 1px 6px rgba(0,0,0,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rslider{position:relative;height:6px;border-radius:4px;margin-top:16px;
  background:rgba(255,255,255,.22);touch-action:none;cursor:pointer;}
.rfill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:rgba(255,255,255,.62);}
.rknob{position:absolute;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;
  border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.45);}
.rsec{font-size:9px;letter-spacing:1.8px;text-transform:uppercase;
  color:rgba(255,255,255,.34);font-weight:700;margin:18px 0 9px;padding-left:3px;}
.rsec.rowsec{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.rsec.rowsec > span:first-child{flex:1;}
.pill2{font-size:10.5px;font-weight:600;padding:6px 12px;border-radius:14px;cursor:pointer;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
  color:rgba(255,255,255,.65);text-transform:none;letter-spacing:0;transition:.15s;}
.pill2:hover{background:rgba(255,255,255,.13);color:#eef1f6;}
.pill2.on{background:#fff;color:#12151c;border-color:#fff;}
.scenes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.scn{position:relative;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);
  border-radius:15px;padding:13px 6px 11px;text-align:center;cursor:pointer;transition:.15s;}
.scn:hover{background:rgba(255,255,255,.09);}
.scdot{width:50px;height:50px;border-radius:50%;margin:0 auto;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 14px rgba(0,0,0,.4);}
.scdot svg{width:24px;height:24px;}
.scn b{display:block;font-size:10.5px;font-weight:600;margin-top:8px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.scn .dyn{display:block;font-style:normal;font-size:8px;letter-spacing:.6px;
  text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:3px;}
.lights{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
.lt{position:relative;border-radius:15px;overflow:hidden;height:132px;cursor:pointer;
  transition:transform .12s;}
.lt:active{transform:scale(.98);}
.ltbg,.ltov{position:absolute;inset:0;}
.lt .scrim{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(to bottom,rgba(8,9,12,0) 40%,rgba(8,9,12,.5) 100%);}
.ltct{position:relative;height:100%;display:flex;flex-direction:column;
  justify-content:space-between;padding:13px 13px 0;}
.ltic svg{width:24px;height:24px;fill:rgba(255,255,255,.95);
  filter:drop-shadow(0 1px 4px rgba(0,0,0,.4));}
.lt.off .ltic svg{fill:rgba(255,255,255,.4);}
.ltn{font-size:12.5px;font-weight:600;line-height:1.3;
  text-shadow:0 1px 4px rgba(0,0,0,.45);}
.ltn small{font-size:10px;font-weight:400;opacity:.55;}
.grp-badge{position:absolute;top:9px;left:9px;width:20px;height:20px;
  background:rgba(0,0,0,.35);border-radius:50%;display:flex;align-items:center;
  justify-content:center;z-index:2;pointer-events:none;}
.grp-badge svg{width:14px;height:14px;fill:rgba(255,255,255,.8);}
.lt.is-group{border:1px solid rgba(255,255,255,.12);}
.grp-members{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,1fr);
  gap:6px;padding:0 4px 8px 24px;}
.lt-sub{height:96px !important;border-radius:12px;}
.lt-sub .ltic svg{width:18px;height:18px;}
.lt-sub .ltn{font-size:11px;}
.lt-sub .ltsw{transform:scale(.82);}
.grp-members:empty{display:none;}
.lt.off .grp-badge svg{fill:rgba(255,255,255,.35);}
  text-shadow:0 1px 4px rgba(0,0,0,.45);}
.lt.off .ltn{color:rgba(255,255,255,.55);}
.ltbar{margin:10px -13px 0;padding:10px 13px 12px;
  border-top:1px solid rgba(255,255,255,.16);}
.ltsw{width:44px;height:26px;border-radius:14px;background:rgba(0,0,0,.3);
  border:1px solid rgba(255,255,255,.2);position:relative;cursor:pointer;}
.ltsw i{position:absolute;top:2.5px;left:3px;width:19px;height:19px;border-radius:50%;
  background:rgba(255,255,255,.5);transition:.2s;}
.ltsw.on i{left:20px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);}

/* ---- vue couleur ---- */
.cptop{display:flex;align-items:center;gap:9px;padding:2px 2px 0;}
.cpb{padding:9px 15px;border-radius:20px;background:rgba(255,255,255,.09);
  font-size:12px;font-weight:600;cursor:pointer;color:rgba(255,255,255,.8);
  display:flex;align-items:center;}
.cpb.right{margin-left:auto;}
.cptitle{font-size:12px;font-weight:600;color:rgba(255,255,255,.75);
  text-align:center;margin-top:8px;}
.wheelw{position:relative;width:100%;max-width:270px;aspect-ratio:1;margin:18px auto 0;
  touch-action:none;}
.wheel{position:absolute;inset:0;border-radius:50%;cursor:crosshair;
  box-shadow:0 12px 40px rgba(0,0,0,.55);}
.wheel.color{background:
  radial-gradient(circle at 50% 50%,rgba(255,255,255,1) 0%,rgba(255,255,255,0) 68%),
  conic-gradient(from 90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000);}
.wheel.white{background:
  radial-gradient(circle at 50% 50%,#fff 0%,rgba(255,255,255,0) 62%),
  conic-gradient(from 90deg,#ffb257,#ffd7a8,#ffffff,#cfe4ff,#a8c8ff,#cfe4ff,#ffd7a8,#ffb257);}
.dots{position:absolute;inset:0;pointer-events:none;}
.dot{position:absolute;width:14px;height:14px;border-radius:50%;
  transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.55);
  box-shadow:0 2px 6px rgba(0,0,0,.5);}
.dot.sel{border-color:#fff;}
.pin{position:absolute;width:38px;height:46px;transform:translate(-50%,-100%);
  pointer-events:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5));}
.pin svg{width:100%;height:100%;}
.pin .pi{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding-bottom:9px;}
.pin .pi svg{width:16px;height:16px;fill:#fff;}
.cpmodes{display:flex;align-items:center;gap:10px;margin-top:20px;}
.mchips{display:flex;gap:9px;align-items:center;background:rgba(255,255,255,.07);
  border-radius:22px;padding:7px 11px;}
.mc{width:30px;height:30px;border-radius:50%;cursor:pointer;border:2px solid transparent;
  transition:.15s;}
.mc.on{border-color:#fff;}
.mc.rainbow{background:conic-gradient(from 90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000);}
.mc.white{background:linear-gradient(135deg,#ffb257,#fff,#cfe4ff);}
.mc.fx{background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;}
.mc.fx svg{width:16px;height:16px;fill:#fff;}
.cpbr{margin-left:auto;text-align:right;}
.cpbrv{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;}
.cp-no-color{padding:40px 20px;text-align:center;color:rgba(255,255,255,.4);
  font-size:13px;background:rgba(255,255,255,.04);border-radius:18px;margin:18px auto;
  max-width:270px;}
.cpbrs{position:relative;width:104px;height:34px;border-radius:18px;margin-top:6px;
  background:rgba(255,255,255,.12);overflow:hidden;cursor:pointer;touch-action:none;}
.cpbrf{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.55);}
.cpbrs svg{position:absolute;top:50%;right:11px;transform:translateY(-50%);
  width:16px;height:16px;fill:none;}
.cpsel{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:20px;}
.cpsl{font-size:10.5px;color:rgba(255,255,255,.5);}
.cplights{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:9px;}
.cpl{position:relative;border-radius:15px;overflow:hidden;height:112px;cursor:pointer;
  border:2px solid transparent;transition:.15s;}
.cpl.sel{border-color:#fff;}
.cpl:not(.sel){opacity:.5;}
.cpl .ltct{padding:11px 12px 0;}
.cpcheck{position:absolute;top:9px;right:9px;width:19px;height:19px;border-radius:50%;
  border:1.6px solid rgba(255,255,255,.6);display:flex;align-items:center;
  justify-content:center;background:rgba(0,0,0,.25);z-index:2;}
.cpl.sel .cpcheck{background:#fff;border-color:#fff;}
.cpcheck svg{width:11px;height:11px;fill:#12151c;opacity:0;}
.cpl.sel .cpcheck svg{opacity:1;}

/* ---- boîte de dialogue ---- */
.dlg{position:absolute;inset:0;z-index:40;display:flex;align-items:center;
  justify-content:center;padding:18px;background:rgba(6,7,10,.72);
  backdrop-filter:blur(3px);}
.dlgb{width:100%;background:#1b1f27;border:1px solid rgba(255,255,255,.14);
  border-radius:18px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.6);}
.dlgt{font-size:14px;font-weight:600;}
.dlgs{font-size:10.5px;color:rgba(255,255,255,.45);margin-top:4px;line-height:1.5;}
.dlgp{display:flex;gap:4px;margin-top:13px;}
.dlgp i{flex:1;height:34px;border-radius:8px;}
.dlgi{width:100%;margin-top:13px;padding:11px 12px;border-radius:11px;font-size:13px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  color:#eef1f6;font-family:inherit;outline:none;}
.dlga{display:flex;gap:8px;margin-top:14px;}
.dlgbtn{flex:1;text-align:center;font-size:12.5px;font-weight:600;padding:11px 0;
  border-radius:12px;cursor:pointer;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);}
.dlgbtn.pri{background:#fff;color:#12151c;border-color:#fff;}

/* ---- bandeau d'annulation ---- */
.toast{position:absolute;left:14px;right:14px;bottom:12px;background:#1c2029;
  border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:11px 14px;
  display:flex;align-items:center;gap:14px;z-index:30;overflow:hidden;
  box-shadow:0 12px 34px rgba(0,0,0,.6);opacity:0;transform:translateY(70px);
  transition:.25s;pointer-events:none;}
.toast.show{opacity:1;transform:translateY(0);pointer-events:auto;}
.toast .tt{flex:1;font-size:12px;}
.toast .tu{font-size:12px;font-weight:700;color:#7fb3ff;cursor:pointer;flex-shrink:0;}
.toast .bar{position:absolute;left:0;bottom:0;height:2px;background:#7fb3ff;width:100%;}
`;

/* ================================================================== */
/* Éditeur visuel                                                     */
/* ================================================================== */

class HueLightsCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
  }

  setConfig(config) {
    this._config = { ...HueLightsCard.getStubConfig(), ...(config || {}) };
    if (!this._built) this._build();
    this._sync();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _set(k, v) {
    this._config = { ...this._config, [k]: v };
    fireEvent(this, "config-changed", { config: this._config });
    this._sync();
  }

  _toggleList(key, value) {
    const list = Array.isArray(this._config[key]) ? [...this._config[key]] : [];
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
    this._set(key, list);
  }

  _build() {
    this.shadowRoot.innerHTML = `<style>${HueLightsCardEditor.styles}</style>
      <div class="ed">

        <div class="grp"><label class="lb">Nom</label>
          <input class="txt" data-k="name" type="text"></div>

        <div class="grp"><label class="lb">Disposition</label>
          <div class="seg" data-k="layout">
            <div class="sg" data-v="tiles">
              <div class="prev pv-tiles"><i></i><i></i><i></i><i></i></div>
              <b>Vignettes</b><span>Grille remplie verticalement</span></div>
            <div class="sg" data-v="rows">
              <div class="prev pv-rows"><i></i><i></i><i></i></div>
              <b>Barres</b><span>Lignes façon Hue</span></div>
          </div></div>

        <div class="grp cols"><label class="lb">Colonnes</label>
          <div class="seg small" data-k="columns">
            <div class="sg" data-v="1">1</div><div class="sg" data-v="2">2</div>
            <div class="sg" data-v="3">3</div></div></div>

        <div class="grp"><label class="lb">Geste de réglage</label>
          <div class="seg small" data-k="gesture">
            <div class="sg" data-v="horizontal">Horizontal</div>
            <div class="sg" data-v="vertical_hold">Vertical + appui</div>
            <div class="sg" data-v="none">Aucun</div></div>
          <div class="hint" id="ghint"></div></div>

        <div class="grp hold"><label class="lb">Durée de l'appui long
            <b class="val" id="holdv">220 ms</b></label>
          <input class="rng" data-k="hold_ms" type="range" min="120" max="600" step="20"></div>

        <div class="grp"><label class="lb">Appui court sur la surface</label>
          <div class="seg small" data-k="tap_action">
            <div class="sg" data-v="open">Ouvrir la pièce</div>
            <div class="sg" data-v="toggle">Basculer</div></div>
          <div class="hint">Avec « ouvrir la pièce », seul le commutateur allume —
            c'est le réglage le plus sûr et celui de l'application Hue.</div></div>

        <div class="grp"><label class="lb">Garde-fous</label>
          <div class="sws">
            <div class="row" data-k="guard_scroll"><div class="sw"><i></i></div>
              <div class="tx"><b>Annuler si la page a défilé</b>
                <span>Un appui devient sans effet si la page a bougé.</span></div></div>
            <div class="row" data-k="guard_thresholds"><div class="sw"><i></i></div>
              <div class="tx"><b>Seuils de mouvement et de durée</b>
                <span>Ignore au-delà de 10 px ou sous 60 ms.</span></div></div>
            <div class="row" data-k="undo"><div class="sw"><i></i></div>
              <div class="tx"><b>Bandeau d'annulation</b>
                <span>Restaure l'état exact de chaque lampe.</span></div></div>
          </div></div>

        <div class="grp"><label class="lb">Scènes</label>
          <div class="sws">
            <div class="row" data-k="show_scenes"><div class="sw"><i></i></div>
              <div class="tx"><b>Afficher les scènes</b>
                <span>Découvertes dans Home Assistant.</span></div></div>
            <div class="row" data-k="learn_scene_colors"><div class="sw"><i></i></div>
              <div class="tx"><b>Apprendre les couleurs</b>
                <span>Après la première activation, la pastille prend les vraies couleurs.</span></div></div>
            <div class="row" data-k="allow_scene_create"><div class="sw"><i></i></div>
              <div class="tx"><b>Enregistrement de scènes</b>
                <span>Capture l'état des lampes via scene.create.</span></div></div>
          </div></div>

        <div class="grp scmatch"><label class="lb">Rattachement des scènes</label>
          <div class="chips" data-k="scene_match">
            <div class="chip" data-v="area">Pièce assignée</div>
            <div class="chip" data-v="group">Nom du groupe Hue</div>
            <div class="chip" data-v="overlap">Recoupement des lampes</div>
          </div>
          <div class="hint">Les trois critères se cumulent. Le recoupement est le plus large :
            une scène appartient à la pièce si elle pilote au moins une de ses lampes.</div></div>

        <div class="grp two">
          <div><label class="lb">Scènes affichées</label>
            <input class="txt" data-k="max_scenes" type="number" min="3" max="30"></div>
          <div><label class="lb">Transition <small>s</small></label>
            <input class="txt" data-k="scene_transition" type="number" min="0" max="10" step="0.5"></div>
        </div>

        <div class="grp"><label class="lb">Affichage</label>
          <div class="sws">
            <div class="row" data-k="show_header"><div class="sw"><i></i></div>
              <div class="tx"><b>En-tête</b><span>Titre et interrupteur général.</span></div></div>
            <div class="row" data-k="transparent"><div class="sw"><i></i></div>
              <div class="tx"><b>Carte transparente</b><span>Fond et bordure invisibles, vignettes seules.</span></div></div>
            <div class="row" data-k="show_off"><div class="sw"><i></i></div>
              <div class="tx"><b>Pièces éteintes</b><span>Sinon seules les allumées.</span></div></div>
            <div class="row" data-k="show_unassigned"><div class="sw"><i></i></div>
              <div class="tx"><b>Lumières sans pièce</b><span>Regroupées sous « Sans pièce ».</span></div></div>
            <div class="row" data-k="show_color_picker"><div class="sw"><i></i></div>
              <div class="tx"><b>Sélecteur de couleur</b>
                <span>Sinon l'appui sur une lampe ouvre sa fiche.</span></div></div>
          </div></div>

        <div class="grp"><label class="lb">Lumières à afficher</label>
          <div class="picker" data-k="entities"></div>
          <div class="hint">Sélection manuelle de lumières et prises. Si rempli, ignore la
            découverte automatique et le filtre par pièce.</div></div>

        <div class="grp"><label class="lb">Regroupement</label>
          <div class="sws">
            <div class="row" data-k="group_by_area"><div class="sw"><i></i></div>
              <div class="tx"><b>Regrouper par pièce</b>
                <span>Sinon chaque lampe est sa propre tuige.</span></div></div>
          </div></div>

        <div class="grp"><label class="lb">Exclure <small>motifs séparés par des virgules</small></label>
          <input class="txt" data-k="exclude" type="text" placeholder="veilleuse, ruban, test"></div>

      </div>`;
    this._built = true;
    const sr = this.shadowRoot;
    sr.querySelectorAll(".txt").forEach((inp) =>
      inp.addEventListener("change", () => {
        const k = inp.dataset.k;
        let v = inp.type === "number" ? Number(inp.value) : inp.value;
        if (k === "exclude")
          v = String(inp.value)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        this._set(k, v);
      })
    );
    /* Sélecteur d'entités (ha-entities-picker) pour le champ entities */
    sr.querySelectorAll(".picker").forEach((el) => {
      const k = el.dataset.k;
      const picker = document.createElement("ha-entity-picker");
      picker.setAttribute("label", "Ajouter une entité");
      picker.hass = this._hass;
      picker.includeDomains = ["light", "switch"];
      picker.allowCustomEntity = true;
      picker.value = "";
      picker.addEventListener("value-changed", (ev) => {
        const val = ev.detail.value;
        if (!val) return;
        const list = Array.isArray(this._config[k]) ? [...this._config[k]] : [];
        if (!list.includes(val)) {
          list.push(val);
          this._set(k, list);
        }
        picker.value = "";
      });
      el.appendChild(picker);
      /* Zone pour afficher les entités sélectionnées avec bouton remove */
      const chips = document.createElement("div");
      chips.className = "ent-chips";
      el.appendChild(chips);
    });
    sr.querySelectorAll(".seg").forEach((seg) =>
      seg.querySelectorAll(".sg").forEach((sg) =>
        sg.addEventListener("click", () =>
          this._set(seg.dataset.k, seg.dataset.k === "columns" ? Number(sg.dataset.v) : sg.dataset.v)
        )
      )
    );
    sr.querySelectorAll(".chips").forEach((ch) =>
      ch.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", () => this._toggleList(ch.dataset.k, c.dataset.v))
      )
    );
    sr.querySelectorAll(".row").forEach((row) =>
      row.addEventListener("click", () => this._set(row.dataset.k, !this._config[row.dataset.k]))
    );
    const rng = sr.querySelector(".rng");
    rng.addEventListener("input", () => {
      sr.querySelector("#holdv").textContent = `${rng.value} ms`;
    });
    rng.addEventListener("change", () => this._set("hold_ms", Number(rng.value)));
  }

  _sync() {
    const sr = this.shadowRoot;
    const c = this._config;
    if (!this._built) return;
    sr.querySelectorAll(".txt").forEach((inp) => {
      const v = c[inp.dataset.k];
      inp.value = Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : v;
    });
    sr.querySelector(".rng").value = c.hold_ms ?? 220;
    sr.querySelector("#holdv").textContent = `${c.hold_ms ?? 220} ms`;
    sr.querySelectorAll(".seg").forEach((seg) =>
      seg
        .querySelectorAll(".sg")
        .forEach((sg) => sg.classList.toggle("on", String(c[seg.dataset.k]) === sg.dataset.v))
    );
    sr.querySelectorAll(".chips").forEach((ch) =>
      ch
        .querySelectorAll(".chip")
        .forEach((x) =>
          x.classList.toggle("on", (c[ch.dataset.k] || []).includes(x.dataset.v))
        )
    );
    sr.querySelectorAll(".row").forEach((row) =>
      row.classList.toggle("on", !!c[row.dataset.k])
    );
    sr.querySelector(".cols").style.display = c.layout === "tiles" ? "" : "none";
    sr.querySelector(".hold").style.display = c.gesture === "vertical_hold" ? "" : "none";
    sr.querySelector(".scmatch").style.display = c.show_scenes ? "" : "none";
    sr.querySelector("#ghint").textContent = {
      horizontal: "Le doigt vertical reste au défilement de la page : aucun conflit.",
      vertical_hold: "Maintenir arme la surface, puis le glissement vertical règle l'intensité.",
      none: "Aucun réglage au doigt : seuls la bascule et la navigation restent.",
    }[c.gesture];
    /* Affiche les entités sélectionnées comme chips cliquables (remove) */
    sr.querySelectorAll(".picker").forEach((el) => {
      const k = el.dataset.k;
      const chips = el.querySelector(".ent-chips");
      if (!chips) return;
      const list = Array.isArray(c[k]) ? c[k] : [];
      chips.innerHTML = list.map((eid) => {
        const fn = this._hass?.states?.[eid]?.attributes?.friendly_name || eid;
        return `<div class="ent-chip" data-eid="${esc(eid)}">${esc(fn)} <span class="ent-x">✕</span></div>`;
      }).join("");
      chips.querySelectorAll(".ent-chip").forEach((chip) =>
        chip.addEventListener("click", () => {
          const eid = chip.dataset.eid;
          this._set(k, list.filter((x) => x !== eid));
        })
      );
    });
  }
}

HueLightsCardEditor.styles = `
:host{display:block;}
*{box-sizing:border-box;}
.ed{display:flex;flex-direction:column;gap:20px;padding:4px 2px 8px;
  font-family:var(--primary-font-family,"Inter","Segoe UI",Roboto,sans-serif);
  color:var(--primary-text-color,#e8ecf3);}
.picker{display:flex;flex-direction:column;gap:8px;}
.ent-chips{display:flex;flex-wrap:wrap;gap:6px;min-height:4px;}
.ent-chip{font-size:11.5px;font-weight:600;padding:7px 10px;border-radius:10px;cursor:pointer;
  background:color-mix(in srgb,var(--primary-color,#3b82f6) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--primary-color,#3b82f6) 30%,transparent);
  color:var(--primary-text-color,#e8ecf3);display:flex;align-items:center;gap:6px;
  transition:.15s;}
.ent-chip:hover{background:color-mix(in srgb,var(--primary-color,#3b82f6) 20%,transparent);}
.ent-chip .ent-x{opacity:.5;font-size:13px;}
.ent-chip:hover .ent-x{opacity:1;}
.grp{display:flex;flex-direction:column;gap:8px;}
.grp.two{flex-direction:row;gap:10px;}
.grp.two > div{flex:1;display:flex;flex-direction:column;gap:8px;}
.lb{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--secondary-text-color,#9aa4b5);display:flex;align-items:baseline;
  justify-content:space-between;gap:8px;}
.lb small{font-size:9.5px;font-weight:500;letter-spacing:0;text-transform:none;opacity:.7;}
.lb .val{font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;
  color:var(--primary-text-color,#e8ecf3);}
.hint{font-size:11px;color:var(--secondary-text-color,#9aa4b5);opacity:.85;line-height:1.5;}
.txt{width:100%;padding:11px 12px;border-radius:10px;font-size:13px;
  background:rgba(127,127,127,.10);border:1px solid rgba(127,127,127,.24);
  color:inherit;font-family:inherit;outline:none;}
.txt:focus{border-color:var(--primary-color,#3b82f6);}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.seg.small{display:flex;gap:6px;}
.sg{border:1px solid rgba(127,127,127,.24);border-radius:12px;padding:11px 10px;
  cursor:pointer;transition:.15s;text-align:center;flex:1;background:rgba(127,127,127,.06);}
.seg.small .sg{padding:9px 8px;font-size:11.5px;font-weight:600;
  color:var(--secondary-text-color,#9aa4b5);}
.sg:hover{background:rgba(127,127,127,.14);}
.sg.on{border-color:var(--primary-color,#3b82f6);
  background:color-mix(in srgb,var(--primary-color,#3b82f6) 14%,transparent);}
.seg.small .sg.on{color:var(--primary-text-color,#e8ecf3);}
.sg b{display:block;font-size:12.5px;font-weight:600;margin-top:8px;}
.sg span{display:block;font-size:10px;color:var(--secondary-text-color,#9aa4b5);margin-top:3px;}
.prev{border-radius:8px;overflow:hidden;height:52px;background:#0e1014;padding:6px;
  display:grid;gap:4px;}
.pv-tiles{grid-template-columns:1fr 1fr;}
.pv-tiles i{border-radius:5px;background:linear-gradient(120deg,#7c4dff,#e0499a,#ff8a4d);}
.pv-tiles i:nth-child(2){background:linear-gradient(120deg,#a855f7,#ec4899,#fb923c);}
.pv-tiles i:nth-child(3){background:#22252c;}
.pv-tiles i:nth-child(4){background:linear-gradient(120deg,#f59e0b,#fbbf24,#fcd34d);}
.pv-rows{grid-template-rows:1fr 1fr 1fr;}
.pv-rows i{border-radius:4px;background:linear-gradient(100deg,#7c4dff,#e0499a,#ff8a4d);}
.pv-rows i:nth-child(2){background:linear-gradient(100deg,#f59e0b,#fbbf24,#fcd34d);}
.pv-rows i:nth-child(3){background:#22252c;}
.chips{display:flex;flex-wrap:wrap;gap:6px;}
.chip{font-size:11.5px;font-weight:600;padding:9px 12px;border-radius:12px;cursor:pointer;
  background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.24);
  color:var(--secondary-text-color,#9aa4b5);transition:.15s;}
.chip.on{border-color:var(--primary-color,#3b82f6);color:var(--primary-text-color,#e8ecf3);
  background:color-mix(in srgb,var(--primary-color,#3b82f6) 14%,transparent);}
.rng{width:100%;-webkit-appearance:none;appearance:none;height:5px;border-radius:3px;
  background:rgba(127,127,127,.25);outline:none;}
.rng::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;
  background:var(--primary-color,#3b82f6);cursor:pointer;}
.rng::-moz-range-thumb{width:15px;height:15px;border-radius:50%;border:none;
  background:var(--primary-color,#3b82f6);cursor:pointer;}
.sws{display:flex;flex-direction:column;gap:2px;}
.row{display:flex;align-items:center;gap:12px;padding:9px 0;cursor:pointer;}
.row .sw{width:40px;height:23px;border-radius:12px;flex-shrink:0;position:relative;
  background:rgba(127,127,127,.28);transition:.18s;}
.row .sw i{position:absolute;top:2.5px;left:3px;width:17px;height:17px;border-radius:50%;
  background:#fff;transition:.18s;opacity:.75;}
.row.on .sw{background:var(--primary-color,#3b82f6);}
.row.on .sw i{left:20px;opacity:1;}
.row .tx{flex:1;min-width:0;}
.row .tx b{display:block;font-size:12.5px;font-weight:600;}
.row .tx span{display:block;font-size:10.5px;color:var(--secondary-text-color,#9aa4b5);
  margin-top:2px;line-height:1.45;}
`;

/* ================================================================== */

if (!customElements.get("hue-lights-card"))
  customElements.define("hue-lights-card", HueLightsCard);
if (!customElements.get("hue-lights-card-editor"))
  customElements.define("hue-lights-card-editor", HueLightsCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hue-lights-card",
  name: "Hue Lights Card",
  description:
    "Pièces en dégradé façon Hue, scènes réelles, sélecteur de couleur multi-lampes et garde-fous.",
  preview: true,
  documentationURL: "https://github.com/junkoku38/hue-lights-card",
});