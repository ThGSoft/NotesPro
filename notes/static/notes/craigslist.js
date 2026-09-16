/**
 * NotesPro ```noteslist``` block (also craigslist / classifieds) — category ads, search, reply, add, edit.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProCraigslist = api;
  root.NotesProNotesList = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FENCE_RE = /```(?:noteslist|notes-list|craigslist|classifieds|clist|ads)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const DEFAULT_CATS = ['community', 'services', 'housing', 'for sale', 'jobs', 'gigs'];

  const CAT_I18N = {
    en: {
      community: 'community',
      services: 'services',
      housing: 'housing',
      'for-sale': 'for sale',
      jobs: 'jobs',
      gigs: 'gigs',
    },
    de: {
      community: 'Gemeinschaft',
      services: 'Dienstleistungen',
      housing: 'Wohnen',
      'for-sale': 'Verkauf',
      jobs: 'Jobs',
      gigs: 'Aufträge',
    },
    fr: {
      community: 'communauté',
      services: 'services',
      housing: 'logement',
      'for-sale': 'à vendre',
      jobs: 'emplois',
      gigs: 'missions',
    },
    it: {
      community: 'comunità',
      services: 'servizi',
      housing: 'alloggi',
      'for-sale': 'in vendita',
      jobs: 'lavoro',
      gigs: 'lavoretti',
    },
    es: {
      community: 'comunidad',
      services: 'servicios',
      housing: 'vivienda',
      'for-sale': 'en venta',
      jobs: 'empleos',
      gigs: 'encargos',
    },
  };

  const STRINGS = {
    en: {
      search: 'search',
      searchPlaceholder: 'title, place, or keyword',
      all: 'all',
      back: '← back to listings',
      reply: 'Reply',
      add: 'Add item',
      edit: 'Edit',
      save: 'Save',
      to: 'To',
      toPlaceholder: 'all group members',
      category: 'Category',
      text: 'Text',
      send: 'Send',
      cancel: 'Cancel',
      empty: 'No listings yet. Add an item, or write Title | price | location | description | until:YYYY-MM-DD | image',
      none: 'No listings match.',
      select: 'Select a listing.',
      metaMail: 'local ads · reply by mail',
      metaDm: 'local ads · reply by private message',
      metaChat: 'local ads · reply by group chat',
      cats: 'Categories',
      textPlaceholder: 'Title | price | location | description',
      replySubject: 'Reply: {title}',
      addSubject: 'New listing: {cat}',
      toastReply: 'Sent reply for “{title}”.',
      toastAdd: 'Sent new listing.',
      toastEdit: 'Saved listing.',
      errReply: 'Could not send classifieds reply.',
      errReplyEmpty: 'Enter a reply.',
      errAdd: 'Could not send listing.',
      errEdit: 'Could not save listing.',
      errEmpty: 'Enter a title.',
      errUntil: 'Choose an end date within one month.',
      replyPlaceholder: 'Your message',
      brandSub: 'NotesList',
      fallback: 'NotesList',
      replyBodyTitle: 'NotesList reply',
      addBodyTitle: 'New NotesList listing',
      labelListing: 'Listing',
      labelTitle: 'Title',
      labelPrice: 'Price',
      labelLocation: 'Location',
      labelDescription: 'Description',
      labelUntil: 'Until',
      untilHint: 'Max 1 month',
      untilUntil: 'until {date}',
      labelTo: 'To',
      labelText: 'Text',
    },
    de: {
      search: 'suchen',
      searchPlaceholder: 'Titel, Ort oder Stichwort',
      all: 'alle',
      back: '← zurück zur Liste',
      reply: 'Antworten',
      add: 'Eintrag hinzufügen',
      edit: 'Bearbeiten',
      save: 'Speichern',
      to: 'An',
      toPlaceholder: 'alle Gruppenmitglieder',
      category: 'Kategorie',
      text: 'Text',
      send: 'Senden',
      cancel: 'Abbrechen',
      empty: 'Noch keine Anzeigen. Eintrag hinzufügen oder Zeile: Titel | Preis | Ort | Text | until:JJJJ-MM-TT | Bild',
      none: 'Keine Anzeigen gefunden.',
      select: 'Anzeige wählen.',
      metaMail: 'lokale Anzeigen · Antwort per Mail',
      metaDm: 'lokale Anzeigen · Antwort per Nachricht',
      metaChat: 'lokale Anzeigen · Antwort im Gruppenchat',
      cats: 'Kategorien',
      textPlaceholder: 'Titel | Preis | Ort | Beschreibung',
      replySubject: 'Antwort: {title}',
      addSubject: 'Neue Anzeige: {cat}',
      toastReply: 'Antwort zu „{title}“ gesendet.',
      toastAdd: 'Neue Anzeige gesendet.',
      toastEdit: 'Anzeige gespeichert.',
      errReply: 'Antwort konnte nicht gesendet werden.',
      errReplyEmpty: 'Antwort eingeben.',
      errAdd: 'Anzeige konnte nicht gesendet werden.',
      errEdit: 'Anzeige konnte nicht gespeichert werden.',
      errEmpty: 'Titel eingeben.',
      errUntil: 'Enddatum innerhalb eines Monats wählen.',
      replyPlaceholder: 'Ihre Nachricht',
      brandSub: 'NotesList',
      fallback: 'NotesList',
      replyBodyTitle: 'Kleinanzeigen-Antwort',
      addBodyTitle: 'Neue Kleinanzeige',
      labelListing: 'Anzeige',
      labelTitle: 'Titel',
      labelPrice: 'Preis',
      labelLocation: 'Ort',
      labelDescription: 'Beschreibung',
      labelUntil: 'Bis',
      untilHint: 'Max. 1 Monat',
      untilUntil: 'bis {date}',
      labelTo: 'An',
      labelText: 'Text',
    },
    fr: {
      search: 'rechercher',
      searchPlaceholder: 'titre, lieu ou mot-clé',
      all: 'tout',
      back: '← retour aux annonces',
      reply: 'Répondre',
      add: 'Ajouter une annonce',
      edit: 'Modifier',
      save: 'Enregistrer',
      to: 'À',
      toPlaceholder: 'tous les membres du groupe',
      category: 'Catégorie',
      text: 'Texte',
      send: 'Envoyer',
      cancel: 'Annuler',
      empty: 'Pas encore d’annonces. Ajoutez une ligne : Titre | prix | lieu | texte | until:AAAA-MM-JJ | image',
      none: 'Aucune annonce ne correspond.',
      select: 'Choisir une annonce.',
      metaMail: 'annonces locales · réponse par mail',
      metaDm: 'annonces locales · réponse en message privé',
      metaChat: 'annonces locales · réponse dans le chat',
      cats: 'Catégories',
      textPlaceholder: 'Titre | prix | lieu | description',
      replySubject: 'Réponse : {title}',
      addSubject: 'Nouvelle annonce : {cat}',
      toastReply: 'Réponse envoyée pour « {title} ».',
      toastAdd: 'Nouvelle annonce envoyée.',
      toastEdit: 'Annonce enregistrée.',
      errReply: 'Impossible d’envoyer la réponse.',
      errReplyEmpty: 'Saisir une réponse.',
      errAdd: 'Impossible d’envoyer l’annonce.',
      errEdit: 'Impossible d’enregistrer l’annonce.',
      errEmpty: 'Saisir un titre.',
      errUntil: 'Choisir une date de fin dans le mois.',
      replyPlaceholder: 'Votre message',
      brandSub: 'NotesList',
      fallback: 'NotesList',
      replyBodyTitle: 'Réponse petites annonces',
      addBodyTitle: 'Nouvelle petite annonce',
      labelListing: 'Annonce',
      labelTitle: 'Titre',
      labelPrice: 'Prix',
      labelLocation: 'Lieu',
      labelDescription: 'Description',
      labelUntil: 'Jusqu’au',
      untilHint: '1 mois max.',
      untilUntil: 'jusqu’au {date}',
      labelTo: 'À',
      labelText: 'Texte',
    },
    it: {
      search: 'cerca',
      searchPlaceholder: 'titolo, luogo o parola chiave',
      all: 'tutti',
      back: '← torna agli annunci',
      reply: 'Rispondi',
      add: 'Aggiungi annuncio',
      edit: 'Modifica',
      save: 'Salva',
      to: 'A',
      toPlaceholder: 'tutti i membri del gruppo',
      category: 'Categoria',
      text: 'Testo',
      send: 'Invia',
      cancel: 'Annulla',
      empty: 'Nessun annuncio. Aggiungi una riga: Titolo | prezzo | luogo | testo | until:AAAA-MM-GG | immagine',
      none: 'Nessun annuncio corrisponde.',
      select: 'Seleziona un annuncio.',
      metaMail: 'annunci locali · risposta per mail',
      metaDm: 'annunci locali · risposta in messaggio',
      metaChat: 'annunci locali · risposta in chat',
      cats: 'Categorie',
      textPlaceholder: 'Titolo | prezzo | luogo | descrizione',
      replySubject: 'Risposta: {title}',
      addSubject: 'Nuovo annuncio: {cat}',
      toastReply: 'Risposta inviata per “{title}”.',
      toastAdd: 'Nuovo annuncio inviato.',
      toastEdit: 'Annuncio salvato.',
      errReply: 'Impossibile inviare la risposta.',
      errReplyEmpty: 'Inserisci una risposta.',
      errAdd: 'Impossibile inviare l’annuncio.',
      errEdit: 'Impossibile salvare l’annuncio.',
      errEmpty: 'Inserisci un titolo.',
      errUntil: 'Scegli una data entro un mese.',
      replyPlaceholder: 'Il tuo messaggio',
      brandSub: 'NotesList',
      fallback: 'NotesList',
      replyBodyTitle: 'Risposta annunci',
      addBodyTitle: 'Nuovo annuncio',
      labelListing: 'Annuncio',
      labelTitle: 'Titolo',
      labelPrice: 'Prezzo',
      labelLocation: 'Luogo',
      labelDescription: 'Descrizione',
      labelUntil: 'Fino al',
      untilHint: 'Max 1 mese',
      untilUntil: 'fino al {date}',
      labelTo: 'A',
      labelText: 'Testo',
    },
    es: {
      search: 'buscar',
      searchPlaceholder: 'título, lugar o palabra clave',
      all: 'todos',
      back: '← volver a los anuncios',
      reply: 'Responder',
      add: 'Añadir anuncio',
      edit: 'Editar',
      save: 'Guardar',
      to: 'Para',
      toPlaceholder: 'todos los miembros del grupo',
      category: 'Categoría',
      text: 'Texto',
      send: 'Enviar',
      cancel: 'Cancelar',
      empty: 'Aún no hay anuncios. Añade una línea: Título | precio | lugar | texto | until:AAAA-MM-DD | imagen',
      none: 'Ningún anuncio coincide.',
      select: 'Elige un anuncio.',
      metaMail: 'anuncios locales · respuesta por correo',
      metaDm: 'anuncios locales · respuesta por mensaje',
      metaChat: 'anuncios locales · respuesta en el chat',
      cats: 'Categorías',
      textPlaceholder: 'Título | precio | lugar | descripción',
      replySubject: 'Respuesta: {title}',
      addSubject: 'Nuevo anuncio: {cat}',
      toastReply: 'Respuesta enviada para «{title}».',
      toastAdd: 'Nuevo anuncio enviado.',
      toastEdit: 'Anuncio guardado.',
      errReply: 'No se pudo enviar la respuesta.',
      errReplyEmpty: 'Escribe una respuesta.',
      errAdd: 'No se pudo enviar el anuncio.',
      errEdit: 'No se pudo guardar el anuncio.',
      errEmpty: 'Escribe un título.',
      errUntil: 'Elige una fecha dentro de un mes.',
      replyPlaceholder: 'Tu mensaje',
      brandSub: 'NotesList',
      fallback: 'NotesList',
      replyBodyTitle: 'Respuesta de clasificados',
      addBodyTitle: 'Nuevo clasificado',
      labelListing: 'Anuncio',
      labelTitle: 'Título',
      labelPrice: 'Precio',
      labelLocation: 'Lugar',
      labelDescription: 'Descripción',
      labelUntil: 'Hasta',
      untilHint: 'Máx. 1 mes',
      untilUntil: 'hasta {date}',
      labelTo: 'Para',
      labelText: 'Texto',
    },
  };

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(';').forEach((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        config[trimmed.toLowerCase()] = '';
        return;
      }
      config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim();
    });
    return config;
  }

  function isOff(value) {
    return /^(0|off|no|false|hide|none)$/i.test(String(value || '').trim());
  }

  function isOn(value) {
    return /^(1|on|yes|true|brand|notespro)$/i.test(String(value || '').trim());
  }

  function resolveLang(explicit) {
    const raw = explicit
      || (typeof window !== 'undefined' && (
        window.APP_BOOT?.extraConfigs?.language
        || window.APP_BOOT?.language
        || document.documentElement?.lang
      ))
      || 'en';
    if (!raw || raw === 'browser') {
      const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      return String(nav).split('-')[0].toLowerCase();
    }
    return String(raw).split('-')[0].toLowerCase();
  }

  function t(key, vars, lang) {
    const code = resolveLang(lang);
    const dict = STRINGS[code] || STRINGS.en;
    const val = dict[key] ?? STRINGS.en[key] ?? key;
    return String(val).replace(/\{(\w+)\}/g, (_, name) => (
      vars && vars[name] != null ? String(vars[name]) : ''
    ));
  }

  function categoryLabel(name, lang) {
    const slug = slugify(name);
    const map = CAT_I18N[resolveLang(lang)] || CAT_I18N.en;
    return map[slug] || name;
  }

  function resolveVia(cfg) {
    const raw = String(cfg.via || cfg.send || cfg.channel || 'mail').trim().toLowerCase();
    if (raw === 'dm' || raw === 'private' || raw === 'message') return 'dm';
    if (raw === 'chat' || raw === 'group' || raw === 'workspace') return 'chat';
    return 'mail';
  }

  function parseToList(cfg) {
    const raw = String(cfg.to || cfg.user || cfg.an || '').trim();
    if (!raw) return [];
    return raw.split(/[,+\s]+/).map((part) => part.trim()).filter(Boolean);
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'ads';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toIsoDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayLocal() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function addCalendarMonths(date, months) {
    const year = date.getFullYear();
    const month = date.getMonth() + months;
    const day = date.getDate();
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last));
  }

  function parseIsoDate(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  function dateRangeBounds() {
    const minDate = todayLocal();
    const maxDate = addCalendarMonths(minDate, 1);
    return { min: toIsoDate(minDate), max: toIsoDate(maxDate) };
  }

  function looksLikeUntilToken(text) {
    return /^(until|bis|hasta|fino|jusqu['’]?au)\s*:?\s*\d{4}-\d{2}-\d{2}$/i.test(String(text || '').trim());
  }

  function parseUntilToken(text) {
    const match = String(text || '').trim().match(/(\d{4}-\d{2}-\d{2})/);
    if (!match) return '';
    return parseIsoDate(match[1]) ? match[1] : '';
  }

  function isExpiredUntil(until) {
    const date = parseIsoDate(until);
    if (!date) return false;
    return toIsoDate(date) < toIsoDate(todayLocal());
  }

  function isUntilInRange(until) {
    const date = parseIsoDate(until);
    if (!date) return false;
    const bounds = dateRangeBounds();
    const iso = toIsoDate(date);
    return iso >= bounds.min && iso <= bounds.max;
  }

  function looksLikeImageSrc(text) {
    const raw = String(text || '').trim();
    if (!raw || /\s/.test(raw)) return false;
    if (/^javascript:/i.test(raw) || /^data:/i.test(raw)) return false;
    if (/!\[[^\]]*\]\(([^)\s]+)\)/.test(raw)) return true;
    if (/^(media\/|\/media\/)/i.test(raw)) return true;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(raw)) return true;
    if (/^https?:\/\//i.test(raw)) return true;
    return false;
  }

  function extractImage(note) {
    const text = String(note || '');
    const md = text.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
    if (md) {
      return { src: md[1], note: text.replace(md[0], '').replace(/\s+/g, ' ').trim() };
    }
    const url = text.match(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i);
    if (url) {
      return { src: url[0], note: text.replace(url[0], '').replace(/\s+/g, ' ').trim() };
    }
    const token = text.match(/https?:\/\/\S+/i);
    if (token && looksLikeImageSrc(token[0])) {
      return { src: token[0], note: text.replace(token[0], '').replace(/\s+/g, ' ').trim() };
    }
    const lone = text.trim();
    if (looksLikeImageSrc(lone)) {
      return { src: lone, note: '' };
    }
    return { src: '', note: text.trim() };
  }

  function resolveMediaHref(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href) || /^data:/i.test(href)) return href;
    const appBase = (typeof window !== 'undefined' && window.APP_BASE)
      ? String(window.APP_BASE).replace(/\/$/, '')
      : '';
    let path = String(href).replace(/\\/g, '/');
    if (/^media\//i.test(path)) {
      return appBase ? `${appBase}/${path}` : `/${path}`;
    }
    if (path.startsWith('/')) {
      return appBase && !path.startsWith(`${appBase}/`) ? `${appBase}${path}` : path;
    }
    return appBase ? `${appBase}/${path}` : `/${path}`;
  }

  function encodeSpec(spec) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
    } catch (_) {
      return '';
    }
  }

  function decodeSpec(raw) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(String(raw || '')))));
    } catch (_) {
      return null;
    }
  }

  function parseListing(parts, category, index) {
    const title = String(parts[0] || '').trim();
    if (!title) return null;
    const price = String(parts[1] || '').trim();
    const location = String(parts[2] || '').trim();
    const restParts = parts.slice(3).map((part) => String(part || '').trim());
    let until = '';
    const leftover = [];
    restParts.forEach((part) => {
      if (!part) return;
      if (!until && looksLikeUntilToken(part)) {
        until = parseUntilToken(part);
        return;
      }
      leftover.push(part);
    });
    const last = leftover[leftover.length - 1] || '';
    let description = '';
    let image = '';
    if (leftover.length >= 2 && looksLikeImageSrc(last)) {
      image = last;
      description = leftover.slice(0, -1).join(' | ').replace(/\s+/g, ' ').trim();
    } else {
      const extracted = extractImage(leftover.join(' | '));
      description = extracted.note;
      image = extracted.src;
    }
    return {
      index,
      title,
      price,
      location,
      description,
      image,
      until,
      category,
      categorySlug: slugify(category),
    };
  }

  function parseBoard(source, cfg, options = {}) {
    const lang = resolveLang(options.locale || cfg.lang);
    const sections = [];
    let current = { title: '', items: [] };
    String(source || '').replace(/\r\n/g, '\n').split('\n').forEach((line, lineNo) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^#+\s+/.test(trimmed)) {
        if (current.items.length || current.title) sections.push(current);
        current = { title: trimmed.replace(/^#+\s+/, '').trim(), items: [] };
        return;
      }
      const row = trimmed.replace(/^[-*•]\s+/, '');
      const parts = row.split('|').map((part) => part.trim());
      const item = parseListing(parts, current.title || 'for sale', 0);
      if (item && !isExpiredUntil(item.until)) {
        item.sourceLineNo = lineNo;
        item.rawLine = trimmed;
        current.items.push(item);
      }
    });
    if (current.items.length || current.title) sections.push(current);
    if (!sections.length) {
      const sample = parseListing(['Sample ad', '0', 'Nearby', 'Replace this listing in markdown'], 'for sale', 0);
      if (sample) sample.ephemeral = true;
      sections.push({
        title: 'for sale',
        items: [sample].filter(Boolean),
      });
    }
    let index = 0;
    const items = [];
    sections.forEach((section) => {
      const cat = section.title || 'ads';
      (section.items || []).forEach((item) => {
        item.index = index;
        item.category = cat;
        item.categorySlug = slugify(cat);
        items.push(item);
        index += 1;
      });
    });
    const categories = sections
      .map((section) => section.title)
      .filter(Boolean);
    const via = resolveVia(cfg);
    const metaKey = via === 'dm' ? 'metaDm' : (via === 'chat' ? 'metaChat' : 'metaMail');
    return {
      title: String(cfg.title || '').trim(),
      city: String(cfg.city || cfg.place || cfg.area || '').trim(),
      showHeader: !isOff(cfg.header),
      showBrand: isOn(cfg.brand),
      to: parseToList(cfg),
      via,
      msg: String(cfg.msg || cfg.message || cfg.text || '').trim(),
      currency: String(cfg.currency || cfg.curr || '').trim(),
      lang,
      meta: t(metaKey, null, lang),
      categories: categories.length ? categories : DEFAULT_CATS.slice(),
      sections,
      items,
      currentUser: String(options.currentUser || '').trim(),
      canEdit: Boolean(options.canEdit),
    };
  }

  function displayPrice(price, currency) {
    const text = String(price || '').trim();
    if (!text || text === '—' || /^free$/i.test(text)) return text || '';
    if (/[A-Za-z$€£¥]/.test(text)) return text;
    const cur = String(currency || '').trim();
    return cur ? `${text} ${cur}` : text;
  }

  function formatReplyText(spec, item, extras = {}) {
    const lang = spec?.lang;
    const pageTitle = extras.pageTitle || 'page';
    const board = spec?.title || spec?.city || t('fallback', null, lang);
    const price = displayPrice(item.price, spec?.currency);
    const userText = String(extras.text || extras.message || '').trim();
    const custom = String(spec?.msg || '').trim();
    if (custom && /\{(title|ad|listing|text|message)\}/i.test(custom)) {
      const filled = custom
        .replace(/\{shop\}/gi, board)
        .replace(/\{board\}/gi, board)
        .replace(/\{page\}/gi, pageTitle)
        .replace(/\{title\}/gi, item.title || '')
        .replace(/\{ad\}/gi, item.title || '')
        .replace(/\{listing\}/gi, item.title || '')
        .replace(/\{price\}/gi, price)
        .replace(/\{place\}/gi, item.location || '')
        .replace(/\{location\}/gi, item.location || '')
        .replace(/\{cat\}/gi, item.category || '')
        .replace(/\{note\}/gi, item.description || '')
        .replace(/\{text\}/gi, userText)
        .replace(/\{message\}/gi, userText);
      if (userText && !/\{(text|message)\}/i.test(custom)) {
        return `${filled}\n\n${userText}`;
      }
      return filled;
    }
    const lines = [
      `${t('replyBodyTitle', null, lang)} — ${board} (${pageTitle})`,
      item.category ? `${t('category', null, lang)}: ${item.category}` : '',
      `${t('labelListing', null, lang)}: ${item.title || ''}`,
      price ? `${t('labelPrice', null, lang)}: ${price}` : '',
      item.location ? `${t('labelLocation', null, lang)}: ${item.location}` : '',
      item.until ? `${t('labelUntil', null, lang)}: ${item.until}` : '',
      item.description ? `\n${item.description}` : '',
      userText ? `\n${t('labelText', null, lang)}:\n${userText}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  function listingLineFromFields(fields = {}) {
    const title = String(fields.title || '').trim();
    if (!title) return '';
    const price = String(fields.price || '').replace(/\|/g, '/').trim();
    const location = String(fields.location || '').replace(/\|/g, '/').trim();
    const description = String(fields.description || '').replace(/\r\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    const until = parseUntilToken(fields.until);
    const image = String(fields.image || '').trim();
    const parts = [title, price, location, description];
    if (until) parts.push(`until:${until}`);
    if (image) parts.push(image);
    return parts.join(' | ');
  }

  function listingLineFromAddText(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';
    if (raw.includes('|')) {
      return raw.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    }
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    return listingLineFromFields({
      title: lines[0] || '',
      description: lines.slice(1).join(' '),
    });
  }

  function insertListingIntoBody(content, category, listingLine) {
    const line = String(listingLine || '').trim();
    if (!line) return String(content || '');
    const lines = String(content || '').replace(/\r\n/g, '\n').replace(/^\n/, '').replace(/\s+$/, '').split('\n');
    const cat = String(category || '').trim();
    if (!cat) {
      return `${lines.filter((row, i) => row || i < lines.length - 1).join('\n')}\n${line}`;
    }
    const catLc = cat.toLowerCase();
    let headingIdx = -1;
    let nextHeading = lines.length;
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].trim().match(/^#+\s+(.+)$/);
      if (!match) continue;
      if (headingIdx >= 0) {
        nextHeading = i;
        break;
      }
      if (match[1].trim().toLowerCase() === catLc) headingIdx = i;
    }
    if (headingIdx < 0) {
      const needsBlank = lines.length && lines[lines.length - 1];
      return [...lines, ...(needsBlank ? [''] : []), `# ${cat}`, line].join('\n');
    }
    let insertAt = nextHeading;
    while (insertAt > headingIdx + 1 && !String(lines[insertAt - 1] || '').trim()) insertAt -= 1;
    return [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)].join('\n');
  }

  function replaceListingInBody(content, item, listingLine, category) {
    const line = String(listingLine || '').trim();
    if (!line) return String(content || '');
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const lineNo = Number(item?.sourceLineNo);
    const newCat = String(category || item?.category || '').trim();
    const oldCat = String(item?.category || '').trim();
    if (!Number.isFinite(lineNo) || lineNo < 0 || lineNo >= lines.length) {
      return insertListingIntoBody(content, newCat, line);
    }
    if (newCat && oldCat && newCat.toLowerCase() !== oldCat.toLowerCase()) {
      const without = [...lines.slice(0, lineNo), ...lines.slice(lineNo + 1)].join('\n');
      return insertListingIntoBody(without, newCat, line);
    }
    const indent = String(lines[lineNo] || '').match(/^\s*/)[0];
    lines[lineNo] = `${indent}${line}`;
    return lines.join('\n');
  }

  function formatAddText(spec, payload, extras = {}) {
    const lang = spec?.lang;
    const pageTitle = extras.pageTitle || 'page';
    const board = spec?.title || spec?.city || t('fallback', null, lang);
    const to = Array.isArray(spec?.to) ? spec.to.join(', ') : String(payload?.to || '');
    return [
      `${t('addBodyTitle', null, lang)} — ${board} (${pageTitle})`,
      to ? `${t('labelTo', null, lang)}: ${to}` : '',
      payload?.category ? `${t('category', null, lang)}: ${payload.category}` : '',
      payload?.title ? `${t('labelTitle', null, lang)}: ${payload.title}` : '',
      payload?.price ? `${t('labelPrice', null, lang)}: ${payload.price}` : '',
      payload?.location ? `${t('labelLocation', null, lang)}: ${payload.location}` : '',
      payload?.until ? `${t('labelUntil', null, lang)}: ${payload.until}` : '',
      payload?.description ? `${t('labelDescription', null, lang)}:\n${payload.description}` : '',
      !payload?.title && payload?.text ? `${t('labelText', null, lang)}:\n${payload.text}` : '',
    ].filter((row, i, arr) => row || i === arr.length - 1).join('\n');
  }

  function renderListingRow(item, spec) {
    const lang = spec?.lang;
    const thumb = item.image
      ? `<img class="cl-thumb" src="${escapeHtml(resolveMediaHref(item.image))}" alt="" loading="lazy">`
      : '<span class="cl-thumb cl-thumb--empty" aria-hidden="true"></span>';
    const price = displayPrice(item.price, spec?.currency);
    const hood = item.location ? `<span class="cl-hood">(${escapeHtml(item.location)})</span>` : '';
    const until = item.until
      ? `<span class="cl-until">${escapeHtml(t('untilUntil', { date: item.until }, lang))}</span>`
      : '';
    return [
      `<li class="cl-row" data-cl-item="${item.index}" data-cl-cat="${escapeHtml(item.categorySlug)}">`,
      `<button type="button" class="cl-row-btn" data-cl-open="${item.index}">`,
      thumb,
      `<span class="cl-row-body">`,
      `<span class="cl-row-title">${escapeHtml(item.title)}</span>`,
      price ? `<span class="cl-price">${escapeHtml(price)}</span>` : '',
      hood,
      until,
      `</span>`,
      `</button>`,
      `</li>`,
    ].join('');
  }

  function renderPosting(item, spec) {
    const lang = spec.lang;
    if (!item) {
      return `<article class="cl-posting" hidden><p class="cl-empty">${escapeHtml(t('select', null, lang))}</p></article>`;
    }
    const price = displayPrice(item.price, spec.currency);
    const img = item.image
      ? `<img class="cl-posting-img" src="${escapeHtml(resolveMediaHref(item.image))}" alt="">`
      : '';
    return [
      `<article class="cl-posting" hidden data-cl-posting="${item.index}">`,
      `<button type="button" class="cl-back" data-cl-back>${escapeHtml(t('back', null, lang))}</button>`,
      `<p class="cl-posting-cat">${escapeHtml(categoryLabel(item.category || '', lang))}</p>`,
      `<p class="cl-posting-title">${escapeHtml(item.title)}</p>`,
      `<p class="cl-posting-meta">`,
      price ? `<span>${escapeHtml(price)}</span>` : '',
      item.location ? `<span>${escapeHtml(item.location)}</span>` : '',
      item.until ? `<span>${escapeHtml(t('untilUntil', { date: item.until }, lang))}</span>` : '',
      `</p>`,
      img,
      item.description ? `<p class="cl-posting-body">${escapeHtml(item.description)}</p>` : '',
      `<div class="cl-posting-actions">`,
      `<button type="button" class="cl-reply-btn" data-cl-reply="${item.index}" aria-expanded="false">${escapeHtml(t('reply', null, lang))}</button>`,
      spec.canEdit && !item.ephemeral
        ? `<button type="button" class="cl-edit-btn" data-cl-edit="${item.index}" aria-expanded="false">${escapeHtml(t('edit', null, lang))}</button>`
        : '',
      `</div>`,
      renderReplyForm(spec),
      spec.canEdit && !item.ephemeral ? renderEditForm(spec, item) : '',
      `</article>`,
    ].join('');
  }

  function renderReplyForm(spec) {
    const lang = spec.lang;
    return [
      `<form class="cl-reply-form" data-cl-reply-form hidden>`,
      `<label class="cl-add-field">${escapeHtml(t('to', null, lang))} `,
      `<input type="text" class="cl-reply-to" data-cl-reply-to value="all" placeholder="${escapeHtml(t('toPlaceholder', null, lang))}" autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-text-field">${escapeHtml(t('text', null, lang))} `,
      `<textarea class="cl-reply-text" data-cl-reply-text rows="4" placeholder="${escapeHtml(t('replyPlaceholder', null, lang))}"></textarea>`,
      `</label>`,
      `<div class="cl-add-actions">`,
      `<button type="submit" class="cl-add-send" data-cl-reply-send>${escapeHtml(t('send', null, lang))}</button>`,
      `<button type="button" class="cl-add-cancel" data-cl-reply-cancel>${escapeHtml(t('cancel', null, lang))}</button>`,
      `</div>`,
      `</form>`,
    ].join('');
  }

  function renderEditForm(spec, item) {
    const lang = spec.lang;
    const listId = `cl-edit-cat-list-${item.index}`;
    const bounds = dateRangeBounds();
    const until = item.until && isUntilInRange(item.until) ? item.until : bounds.max;
    const options = spec.categories.map((name) => (
      `<option value="${escapeHtml(name)}">${escapeHtml(categoryLabel(name, lang))}</option>`
    )).join('');
    return [
      `<form class="cl-add-form cl-edit-form" data-cl-edit-form hidden>`,
      `<label class="cl-add-field">${escapeHtml(t('category', null, lang))}`,
      `<input type="text" class="cl-add-cat" data-cl-edit-cat list="${escapeHtml(listId)}" value="${escapeHtml(item.category || '')}" autocomplete="off">`,
      `</label>`,
      `<datalist id="${escapeHtml(listId)}">${options}</datalist>`,
      `<label class="cl-add-field">${escapeHtml(t('labelTitle', null, lang))}`,
      `<input type="text" class="cl-add-title" data-cl-edit-title value="${escapeHtml(item.title || '')}" required autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelPrice', null, lang))}`,
      `<input type="text" class="cl-add-price" data-cl-edit-price value="${escapeHtml(item.price || '')}" autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelLocation', null, lang))}`,
      `<input type="text" class="cl-add-location" data-cl-edit-location value="${escapeHtml(item.location || '')}" autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelUntil', null, lang))}`,
      `<input type="date" class="cl-add-until" data-cl-edit-until min="${escapeHtml(bounds.min)}" max="${escapeHtml(bounds.max)}" value="${escapeHtml(until)}" required>`,
      `<span class="cl-until-hint">${escapeHtml(t('untilHint', null, lang))}</span>`,
      `</label>`,
      `<label class="cl-add-text-field">${escapeHtml(t('labelDescription', null, lang))}`,
      `<textarea class="cl-add-desc" data-cl-edit-desc rows="3">${escapeHtml(item.description || '')}</textarea>`,
      `</label>`,
      `<div class="cl-add-actions">`,
      `<button type="submit" class="cl-add-send" data-cl-edit-send>${escapeHtml(t('save', null, lang))}</button>`,
      `<button type="button" class="cl-add-cancel" data-cl-edit-cancel>${escapeHtml(t('cancel', null, lang))}</button>`,
      `</div>`,
      `</form>`,
    ].join('');
  }

  function renderHeader(spec) {
    if (!spec.showHeader) return '';
    const lang = spec.lang;
    const bits = [];
    if (spec.showBrand) {
      bits.push(`<div class="cl-brand"><span class="cl-brand-name">notespro</span> <span class="cl-brand-sub">${escapeHtml(t('brandSub', null, lang))}</span></div>`);
    } else if (spec.title) {
      bits.push(`<div class="cl-title">${escapeHtml(spec.title)}</div>`);
    }
    if (spec.city) bits.push(`<div class="cl-city">${escapeHtml(spec.city)}</div>`);
    if (spec.meta) bits.push(`<p class="cl-meta">${escapeHtml(spec.meta)}</p>`);
    if (!bits.length) return '';
    return `<header class="cl-header">${bits.join('')}</header>`;
  }

  function renderAddForm(spec, index) {
    const lang = spec.lang;
    const listId = `cl-cat-list-${index}`;
    const defaultTo = (spec.to && spec.to[0]) || spec.currentUser || '';
    const defaultCat = spec.categories[0] || '';
    const bounds = dateRangeBounds();
    const options = spec.categories.map((name) => (
      `<option value="${escapeHtml(name)}">${escapeHtml(categoryLabel(name, lang))}</option>`
    )).join('');
    return [
      `<button type="button" class="cl-add-btn" data-cl-add>${escapeHtml(t('add', null, lang))}</button>`,
      `<form class="cl-add-form" data-cl-add-form hidden>`,
      `<label class="cl-add-field" data-cl-add-to-field>${escapeHtml(t('to', null, lang))}`,
      `<input type="text" class="cl-add-to" data-cl-add-to value="${escapeHtml(defaultTo)}" autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('category', null, lang))}`,
      `<input type="text" class="cl-add-cat" data-cl-add-cat list="${escapeHtml(listId)}" value="${escapeHtml(defaultCat)}" autocomplete="off">`,
      `</label>`,
      `<datalist id="${escapeHtml(listId)}">${options}</datalist>`,
      `<label class="cl-add-field">${escapeHtml(t('labelTitle', null, lang))}`,
      `<input type="text" class="cl-add-title" data-cl-add-title required autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelPrice', null, lang))}`,
      `<input type="text" class="cl-add-price" data-cl-add-price autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelLocation', null, lang))}`,
      `<input type="text" class="cl-add-location" data-cl-add-location autocomplete="off">`,
      `</label>`,
      `<label class="cl-add-field">${escapeHtml(t('labelUntil', null, lang))}`,
      `<input type="date" class="cl-add-until" data-cl-add-until min="${escapeHtml(bounds.min)}" max="${escapeHtml(bounds.max)}" value="${escapeHtml(bounds.max)}" required>`,
      `<span class="cl-until-hint">${escapeHtml(t('untilHint', null, lang))}</span>`,
      `</label>`,
      `<label class="cl-add-text-field">${escapeHtml(t('labelDescription', null, lang))}`,
      `<textarea class="cl-add-desc" data-cl-add-desc rows="3"></textarea>`,
      `</label>`,
      `<div class="cl-add-actions">`,
      `<button type="submit" class="cl-add-send" data-cl-add-send>${escapeHtml(t('send', null, lang))}</button>`,
      `<button type="button" class="cl-add-cancel" data-cl-add-cancel>${escapeHtml(t('cancel', null, lang))}</button>`,
      `</div>`,
      `</form>`,
    ].join('');
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const spec = parseBoard(source, cfg, options);
    const lang = spec.lang;
    const index = Number.isFinite(options.clIndex) ? options.clIndex : 0;
    const counts = {};
    spec.items.forEach((item) => {
      counts[item.categorySlug] = (counts[item.categorySlug] || 0) + 1;
    });
    const catNav = [
      `<button type="button" class="cl-cat is-active" data-cl-cat="">${escapeHtml(t('all', null, lang))} <span>${spec.items.length}</span></button>`,
      ...spec.categories.map((name) => {
        const slug = slugify(name);
        const n = counts[slug] || 0;
        return `<button type="button" class="cl-cat" data-cl-cat="${escapeHtml(slug)}">${escapeHtml(categoryLabel(name, lang))} <span>${n}</span></button>`;
      }),
    ].join('');
    const rows = spec.items.map((item) => renderListingRow(item, spec)).join('');
    const postings = spec.items.map((item) => renderPosting(item, spec)).join('');
    return [
      `<div class="cl-block" data-cl-index="${index}" data-cl-spec="${escapeHtml(encodeSpec(spec))}">`,
      renderHeader(spec),
      `<div class="cl-toolbar">`,
      `<label class="cl-search-field">${escapeHtml(t('search', null, lang))} `,
      `<input type="search" class="cl-search" data-cl-search placeholder="${escapeHtml(t('searchPlaceholder', null, lang))}" autocomplete="off">`,
      `</label>`,
      renderAddForm(spec, index),
      `</div>`,
      `<div class="cl-layout">`,
      `<nav class="cl-cats" aria-label="${escapeHtml(t('cats', null, lang))}">${catNav}</nav>`,
      `<div class="cl-main">`,
      `<ul class="cl-results">${rows || `<li class="cl-empty">${escapeHtml(t('empty', null, lang))}</li>`}</ul>`,
      `<p class="cl-none" hidden>${escapeHtml(t('none', null, lang))}</p>`,
      postings,
      `</div>`,
      `</div>`,
      `</div>`,
    ].join('');
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const hay = [item.title, item.price, item.location, item.description, item.category, item.until]
      .join(' ')
      .toLowerCase();
    return hay.includes(query);
  }

  function applyFilter(el) {
    const cat = String(el.dataset.clFilter || '');
    const query = String(el.dataset.clQuery || '').trim().toLowerCase();
    const spec = decodeSpec(el.dataset.clSpec);
    let shown = 0;
    el.querySelectorAll('.cl-row').forEach((row) => {
      const itemCat = row.dataset.clCat || '';
      const idx = parseInt(row.dataset.clItem, 10);
      const item = spec?.items?.[idx];
      const ok = (!cat || itemCat === cat) && matchesQuery(item || {}, query);
      row.hidden = !ok;
      if (ok) shown += 1;
    });
    if (el.classList.contains('is-posting')) return;
    const none = el.querySelector('.cl-none');
    const list = el.querySelector('.cl-results');
    if (none) none.hidden = shown > 0;
    if (list) list.hidden = false;
  }

  function hideEditForms(el) {
    el.querySelectorAll('[data-cl-edit-form]').forEach((node) => { node.hidden = true; });
    el.querySelectorAll('[data-cl-edit]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function hideReplyForms(el) {
    el.querySelectorAll('[data-cl-reply-form]').forEach((node) => { node.hidden = true; });
    el.querySelectorAll('[data-cl-reply]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
    hideEditForms(el);
  }

  function showList(el) {
    el.classList.remove('is-posting');
    hideReplyForms(el);
    el.querySelectorAll('.cl-posting').forEach((node) => { node.hidden = true; });
    const list = el.querySelector('.cl-results');
    if (list) list.hidden = false;
    applyFilter(el);
  }

  function showPosting(el, index) {
    el.classList.add('is-posting');
    hideReplyForms(el);
    const form = el.querySelector('[data-cl-add-form]');
    if (form) form.hidden = true;
    const list = el.querySelector('.cl-results');
    const none = el.querySelector('.cl-none');
    if (list) list.hidden = true;
    if (none) none.hidden = true;
    el.querySelectorAll('.cl-posting').forEach((node) => {
      node.hidden = String(node.dataset.clPosting) !== String(index);
    });
  }

  function applyUntilBounds(input) {
    if (!input) return;
    const bounds = dateRangeBounds();
    input.min = bounds.min;
    input.max = bounds.max;
    if (!input.value || !isUntilInRange(input.value)) input.value = bounds.max;
  }

  function resetAddForm(form) {
    if (!form) return;
    const title = form.querySelector('[data-cl-add-title]');
    const price = form.querySelector('[data-cl-add-price]');
    const location = form.querySelector('[data-cl-add-location]');
    const desc = form.querySelector('[data-cl-add-desc]');
    if (title) title.value = '';
    if (price) price.value = '';
    if (location) location.value = '';
    if (desc) desc.value = '';
    applyUntilBounds(form.querySelector('[data-cl-add-until]'));
  }

  function hydrateBlock(el, hooks = {}) {
    if (!el || el.dataset.clHydrated === '1') return;
    const spec = decodeSpec(el.dataset.clSpec);
    if (!spec) return;
    el.dataset.clHydrated = '1';
    el.dataset.clFilter = '';
    el.dataset.clQuery = '';

    const search = el.querySelector('[data-cl-search]');
    search?.addEventListener('click', (event) => event.stopPropagation());
    search?.addEventListener('keydown', (event) => event.stopPropagation());
    search?.addEventListener('input', () => {
      el.dataset.clQuery = search.value || '';
      showList(el);
    });

    const form = el.querySelector('[data-cl-add-form]');
    form?.addEventListener('click', (event) => {
      event.stopPropagation();
      const cancel = event.target.closest('[data-cl-add-cancel]');
      if (cancel && form.contains(cancel)) {
        event.preventDefault();
        form.hidden = true;
      }
    });
    form?.addEventListener('keydown', (event) => event.stopPropagation());
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sendBtn = el.querySelector('[data-cl-add-send]');
      void Promise.resolve(hooks.onAdd?.({
        spec,
        el,
        btn: sendBtn,
        to: el.querySelector('[data-cl-add-to]')?.value || '',
        category: el.querySelector('[data-cl-add-cat]')?.value || '',
        title: el.querySelector('[data-cl-add-title]')?.value || '',
        price: el.querySelector('[data-cl-add-price]')?.value || '',
        location: el.querySelector('[data-cl-add-location]')?.value || '',
        description: el.querySelector('[data-cl-add-desc]')?.value || '',
        until: el.querySelector('[data-cl-add-until]')?.value || '',
      })).then((ok) => {
        if (!ok) return;
        resetAddForm(form);
        form.hidden = true;
      });
    });

    el.querySelectorAll('[data-cl-reply-form]').forEach((replyForm) => {
      replyForm.addEventListener('click', (event) => {
        event.stopPropagation();
        const cancel = event.target.closest('[data-cl-reply-cancel]');
        if (cancel && replyForm.contains(cancel)) {
          event.preventDefault();
          replyForm.hidden = true;
          replyForm.closest('.cl-posting')?.querySelector('[data-cl-reply]')?.setAttribute('aria-expanded', 'false');
        }
      });
      replyForm.addEventListener('keydown', (event) => event.stopPropagation());
      replyForm.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const posting = replyForm.closest('.cl-posting');
        const item = spec.items[parseInt(posting?.dataset?.clPosting, 10)];
        if (!item) return;
        const sendBtn = replyForm.querySelector('[data-cl-reply-send]');
        void Promise.resolve(hooks.onReply?.({
          spec,
          item,
          el,
          btn: sendBtn,
          to: replyForm.querySelector('[data-cl-reply-to]')?.value || '',
          text: replyForm.querySelector('[data-cl-reply-text]')?.value || '',
        })).then((ok) => {
          if (!ok) return;
          replyForm.hidden = true;
          const ta = replyForm.querySelector('[data-cl-reply-text]');
          if (ta) ta.value = '';
          posting?.querySelector('[data-cl-reply]')?.setAttribute('aria-expanded', 'false');
        });
      });
    });

    el.querySelectorAll('[data-cl-edit-form]').forEach((editForm) => {
      editForm.addEventListener('click', (event) => {
        event.stopPropagation();
        const cancel = event.target.closest('[data-cl-edit-cancel]');
        if (cancel && editForm.contains(cancel)) {
          event.preventDefault();
          editForm.hidden = true;
          editForm.closest('.cl-posting')?.querySelector('[data-cl-edit]')?.setAttribute('aria-expanded', 'false');
        }
      });
      editForm.addEventListener('keydown', (event) => event.stopPropagation());
      editForm.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const posting = editForm.closest('.cl-posting');
        const item = spec.items[parseInt(posting?.dataset?.clPosting, 10)];
        if (!item) return;
        const sendBtn = editForm.querySelector('[data-cl-edit-send]');
        void Promise.resolve(hooks.onEdit?.({
          spec,
          item,
          el,
          btn: sendBtn,
          category: editForm.querySelector('[data-cl-edit-cat]')?.value || '',
          title: editForm.querySelector('[data-cl-edit-title]')?.value || '',
          price: editForm.querySelector('[data-cl-edit-price]')?.value || '',
          location: editForm.querySelector('[data-cl-edit-location]')?.value || '',
          description: editForm.querySelector('[data-cl-edit-desc]')?.value || '',
          until: editForm.querySelector('[data-cl-edit-until]')?.value || '',
        })).then((ok) => {
          if (!ok) return;
          editForm.hidden = true;
          posting?.querySelector('[data-cl-edit]')?.setAttribute('aria-expanded', 'false');
        });
      });
    });

    el.addEventListener('click', (event) => {
      const addBtn = event.target.closest('.cl-add-btn');
      if (addBtn && el.contains(addBtn)) {
        event.preventDefault();
        event.stopPropagation();
        if (form) {
          form.hidden = !form.hidden;
          if (!form.hidden) {
            showList(el);
            applyUntilBounds(form.querySelector('[data-cl-add-until]'));
            el.querySelector('[data-cl-add-title]')?.focus();
          }
        }
        return;
      }
      const catBtn = event.target.closest('[data-cl-cat]');
      if (catBtn && el.contains(catBtn) && catBtn.matches('.cl-cat')) {
        event.preventDefault();
        event.stopPropagation();
        el.dataset.clFilter = catBtn.dataset.clCat || '';
        el.querySelectorAll('.cl-cat').forEach((btn) => {
          btn.classList.toggle('is-active', btn === catBtn);
        });
        showList(el);
        return;
      }
      const back = event.target.closest('[data-cl-back]');
      if (back && el.contains(back)) {
        event.preventDefault();
        event.stopPropagation();
        showList(el);
        return;
      }
      const openBtn = event.target.closest('[data-cl-open]');
      if (openBtn && el.contains(openBtn)) {
        event.preventDefault();
        event.stopPropagation();
        showPosting(el, openBtn.dataset.clOpen);
        return;
      }
      const replyBtn = event.target.closest('[data-cl-reply]');
      if (replyBtn && el.contains(replyBtn) && !replyBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const posting = replyBtn.closest('.cl-posting');
        const replyForm = posting?.querySelector('[data-cl-reply-form]');
        if (!replyForm) return;
        const open = replyForm.hidden;
        hideReplyForms(el);
        if (open) {
          replyForm.hidden = false;
          replyBtn.setAttribute('aria-expanded', 'true');
          const toInput = replyForm.querySelector('[data-cl-reply-to]');
          void Promise.resolve(hooks.fillReplyTo?.(toInput)).finally(() => {
            replyForm.querySelector('[data-cl-reply-text]')?.focus();
          });
        }
        return;
      }
      const editBtn = event.target.closest('[data-cl-edit]');
      if (editBtn && el.contains(editBtn) && !editBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const posting = editBtn.closest('.cl-posting');
        const editForm = posting?.querySelector('[data-cl-edit-form]');
        if (!editForm) return;
        const open = editForm.hidden;
        hideReplyForms(el);
        if (open) {
          editForm.hidden = false;
          editBtn.setAttribute('aria-expanded', 'true');
          applyUntilBounds(editForm.querySelector('[data-cl-edit-until]'));
          editForm.querySelector('[data-cl-edit-title]')?.focus();
        }
      }
    });
  }

  function hydrate(root, hooks = {}) {
    (root || document).querySelectorAll('.cl-block[data-cl-spec]').forEach((el) => {
      hydrateBlock(el, hooks);
    });
  }

  return {
    FENCE_RE,
    parseFenceAttrs,
    parseBoard,
    parseToList,
    t,
    formatReplyText,
    formatAddText,
    listingLineFromFields,
    listingLineFromAddText,
    insertListingIntoBody,
    replaceListingInBody,
    isUntilInRange,
    dateRangeBounds,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
