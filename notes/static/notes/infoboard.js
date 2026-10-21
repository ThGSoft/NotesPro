/** Infoboard: an editable bulletin board stored inside a note fence. */
(function (root, factory) {
  const api = factory(root);
  root.NotesProInfoboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sample = JSON.stringify({version: 1, items: [
    {id:'welcome', title:'Welcome to the team board', text:'Announcements, reminders, and useful links in one place. Add a card to share an update with your workspace.', category:'Team', priority:'normal', pinned:true},
    {id:'launch', title:'Project launch', text:'Review the checklist, update your issue status, and share any blockers before our next meeting.', category:'Projects', priority:'important', pinned:false},
    {id:'guide', title:'Useful resources', text:'Keep onboarding guides, documentation, and reference links close at hand.', category:'Resources', priority:'normal', link:'https://thgsoft.online/DjangoNotesPro/'},
  ]}, null, 2);
  function attrs(raw) {
    const cfg = {};
    String(raw || '').split(';').forEach(pair => { const i = pair.indexOf('='); if (i > 0) cfg[pair.slice(0,i).trim().toLowerCase()] = pair.slice(i+1).trim(); });
    return cfg;
  }
  function safeLink(raw) {
    const value = String(raw || '').trim();
    if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    if (/^(https?:\/\/|mailto:)/i.test(value) || /^(\/[^/]|\?|#)/.test(value)) return value;
    return '';
  }
  function parse(source) {
    if (String(source || '').length > 200000) throw Error('Board is too large');
    const data = String(source || '').trim() ? JSON.parse(source) : {version:1,items:[]};
    if (!data || !Array.isArray(data.items)) throw Error('Use a JSON object with an items array');
    if (data.items.length > 200) throw Error('Use at most 200 cards');
    const ids = new Set();
    return {version:1, items:data.items.map((item,i) => {
      if (!item || typeof item !== 'object') throw Error('Invalid card at position ' + (i+1));
      let id = String(item.id || 'card-' + i);
      if (ids.has(id)) id += '-' + i;
      ids.add(id);
      return {id, title:String(item.title || 'Untitled'), text:String(item.text || ''), category:String(item.category || 'General'), priority:['normal','important','urgent'].includes(item.priority) ? item.priority : 'normal', pinned:!!item.pinned, archived:!!item.archived, until:/^\d{4}-\d{2}-\d{2}$/.test(item.until || '') ? item.until : '', link:safeLink(item.link)};
    })};
  }
  function rewriteFence(markdown, index, source) {
    // Validate before replacing; Unicode escapes keep fence markers inside JSON strings safe.
    const encoded = JSON.stringify(parse(source), null, 2).replace(/`/g, '\\u0060');
    let n = 0;
    return String(markdown).replace(/```(?:infoboard|info-board|noticeboard)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (match, cfg) => n++ === index ? '```infoboard' + (cfg ? '{'+cfg+'}' : '') + '\n'+encoded+'\n```' : match);
  }
  function visibleItems(board, options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    return board.items.filter(item => {
      if (!!item.archived !== !!options.archived) return false;
      if (!options.expired && item.until && item.until < options.today) return false;
      if (options.category && item.category !== options.category) return false;
      return !query || [item.title,item.text,item.category].join(' ').toLowerCase().includes(query);
    }).map((item,order)=>({item,order})).sort((a,b)=>Number(b.item.pinned)-Number(a.item.pinned) || a.order-b.order).map(entry=>entry.item);
  }
  function renderBlock(source, raw, options = {}) {
    const cfg = attrs(raw);
    const columns = Math.min(4,Math.max(1,parseInt(cfg.cols,10)||3));
    return '<section class="infoboard-block" data-infoboard-index="'+(Number(options.infoboardIndex)||0)+'" style="--ib-columns:'+columns+'">'
      + '<header class="ib-header"><div><span class="ib-eyebrow">WORKSPACE BULLETIN</span><h3>'+escape(cfg.title || 'Infoboard')+'</h3><p>Updates, reminders, and knowledge worth sharing.</p></div><div class="ib-header-actions"><button type="button" data-ib-action="new" hidden>+ Add card</button>'+(root.NotesProGameFullscreen?.renderButton?.()||'')+'</div></header>'
      + '<div class="ib-tools"><input type="search" data-ib-search aria-label="Search board" placeholder="Search the board…"><select data-ib-category aria-label="Filter category"><option value="">All categories</option></select><label><input type="checkbox" data-ib-archived> Archived</label><label><input type="checkbox" data-ib-expired> Expired</label><span class="ib-count" role="status"></span></div>'
      + '<div class="ib-editor" hidden></div><div class="ib-grid"></div><textarea class="ib-source" hidden>'+escape(source || '')+'</textarea></section>';
  }
  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.ibReady) return;
    el.dataset.ibReady='1';
    const editable = !!options.editable;
    const grid=el.querySelector('.ib-grid'), editor=el.querySelector('.ib-editor'), category=el.querySelector('[data-ib-category]');
    const state = el.querySelector('.ib-count');
    let board;
    try { board=parse(el.querySelector('.ib-source').value); }
    catch (error) { state.textContent='Invalid board data'; grid.innerHTML='<p class="ib-empty">'+escape(error.message)+'. Correct the JSON in Markdown to keep your existing cards.</p>';return; }
    el.querySelector('[data-ib-action=new]').hidden=!editable;
    function today() {const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
    function paint() {
      const selected=category.value;
      category.innerHTML='<option value="">All categories</option>'+[...new Set(board.items.map(item=>item.category))].sort().map(c=>'<option>'+escape(c)+'</option>').join('');
      if ([...category.options].some(o=>o.value===selected)) category.value=selected;
      const cards=visibleItems(board,{query:el.querySelector('[data-ib-search]').value, category:category.value, archived:el.querySelector('[data-ib-archived]').checked, expired:el.querySelector('[data-ib-expired]').checked, today:today()});
      state.textContent=cards.length+(cards.length===1?' card':' cards');
      grid.innerHTML=cards.length?cards.map(item=>'<article class="ib-card ib-card--'+item.priority+'"><div class="ib-card-meta"><span class="ib-category">'+escape(item.category)+'</span><span>'+ (item.pinned?'PINNED':'')+'</span></div><h4>'+escape(item.title)+'</h4><p>'+escape(item.text)+'</p><div class="ib-card-details">'+(item.priority!=='normal'?'<span class="ib-priority">'+escape(item.priority)+'</span>':'')+(item.until?'<time datetime="'+item.until+'">Until '+item.until+'</time>':'')+'</div>'+(item.link?'<a class="ib-link" href="'+escape(item.link)+'" target="_blank" rel="noopener noreferrer">Open link ↗</a>':'')+(editable?'<footer><button type="button" data-ib-action="edit" data-id="'+escape(item.id)+'">Edit</button><button type="button" data-ib-action="pin" data-id="'+escape(item.id)+'">'+(item.pinned?'Unpin':'Pin')+'</button><button type="button" data-ib-action="archive" data-id="'+escape(item.id)+'">'+(item.archived?'Restore':'Archive')+'</button></footer>':'')+'</article>').join(''):'<div class="ib-empty"><strong>No cards to show</strong><p>Try another filter'+(editable?' or add your first announcement.':'.')+'</p></div>';
    }
    function persist() {
      const source=JSON.stringify(board,null,2);
      el.querySelector('.ib-source').value=source;
      options.onChange?.(source);
      paint();
    }
    function close() {editor.hidden=true;editor.replaceChildren();}
    function open(item) {
      const card=item||{title:'',text:'',category:'General',priority:'normal',until:'',link:'',pinned:false};
      editor.innerHTML='<form><div class="ib-editor-heading"><strong>'+(item?'Edit card':'New announcement')+'</strong><button type="button" data-ib-action="cancel" aria-label="Close editor">×</button></div><label>Title<input name="title" required maxlength="160" value="'+escape(card.title)+'"></label><label>Message<textarea name="text" rows="4" maxlength="4000">'+escape(card.text)+'</textarea></label><div class="ib-form-row"><label>Category<input name="category" required maxlength="60" value="'+escape(card.category)+'"></label><label>Priority<select name="priority">'+['normal','important','urgent'].map(p=>'<option'+(card.priority===p?' selected':'')+'>'+p+'</option>').join('')+'</select></label><label>Show until<input name="until" type="date" value="'+escape(card.until)+'"></label></div><label>Link (https://, /path, ?page=…, or #section)<input name="link" maxlength="2000" value="'+escape(card.link)+'"></label><label class="ib-checkbox"><input type="checkbox" name="pinned"'+(card.pinned?' checked':'')+'> Pin to top</label><div class="ib-form-actions"><button type="submit">Save card</button><button type="button" data-ib-action="cancel">Cancel</button><span class="ib-form-error" role="alert"></span></div></form>';
      editor.hidden=false;
      const form=editor.querySelector('form');
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const data=new FormData(form), link=String(data.get('link')||'').trim();
        if (link && !safeLink(link)) {form.querySelector('.ib-form-error').textContent='Use an http(s), mailto, or internal link.';return;}
        if (!String(data.get('title')).trim() || !String(data.get('category')).trim()) return;
        const next={id:item?.id || (root.crypto?.randomUUID?.() || 'card-'+Date.now()+'-'+Math.random().toString(36).slice(2)),title:String(data.get('title')).trim(),text:String(data.get('text')),category:String(data.get('category')).trim(),priority:String(data.get('priority')),until:String(data.get('until')),link,pinned:data.has('pinned'),archived:!!item?.archived};
        if (item) board.items[board.items.indexOf(item)]=next;
        else if (board.items.length>=200) {form.querySelector('.ib-form-error').textContent='Board limit: 200 cards.';return;}
        else board.items.push(next);
        persist();close();
      });
      form.querySelector('[name=title]').focus();
    }
    el.addEventListener('click',event=>{
      const button=event.target.closest('[data-ib-action]');if(!button||!el.contains(button)||!editable)return;
      const action=button.dataset.ibAction;
      if (action==='cancel') {close();return;}
      if (action==='new') {open();return;}
      const item=board.items.find(item=>item.id===button.dataset.id);if(!item)return;
      if(action==='edit')open(item);
      if(action==='pin'){item.pinned=!item.pinned;persist();}
      if(action==='archive'){item.archived=!item.archived;persist();}
    });
    el.querySelector('[data-ib-search]').addEventListener('input',paint);
    for(const selector of ['[data-ib-category]','[data-ib-archived]','[data-ib-expired]'])el.querySelector(selector).addEventListener('change',paint);
    root.NotesProGameFullscreen?.bind?.(el);
    paint();
  }
  return {sample, parse, safeLink, visibleItems, renderBlock, hydrateBlock, rewriteFence, parseFenceAttrs:attrs};
}));
