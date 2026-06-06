(function () {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  const appBase = (window.APP_BASE || '').replace(/\/$/, '');

  let workspaceId = window.APP_BOOT?.workspaceId || null;
  let currentPageId = window.APP_BOOT?.pageId || null;

  function getWorkspaceId() {
    const fromSelect = document.getElementById('workspace-select')?.value;
    return fromSelect || workspaceId;
  }

  function syncWorkspaceIdFromDom() {
    const wsId = getWorkspaceId();
    if (wsId) workspaceId = wsId;
    return workspaceId;
  }
  let currentUserId = window.APP_BOOT.userId|| null;
  let currentUserName = window.APP_BOOT.username|| null;

  let currentPage = null;

  let easyMDE = null;
  let autosaveTimer = null;
  let isEditing = false;
  let currentEditor = null; // Speichert den Editor-Kontext für den Callback

  function apiUrl(url) {
    return appBase + '/' + String(url).replace(/^\/+/, '');
  }

  function setStatus(text) {
    const el = document.getElementById('save-status');
    if (el) el.textContent = text;
  }

  async function api(url, method = 'GET', data = null, isForm = false) {
    const options = {
      method,
      headers: isForm
        ? { 'X-CSRFToken': csrfToken }
        : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken }
    };
    if (data) options.body = isForm ? data : JSON.stringify(data);

    let response;
    try {
      response = await fetch(apiUrl(url), options);
    } catch (netErr) {
      const error = new Error(
        'Cannot reach the server. Start it with: python manage.py runserver'
      );
      error.network = true;
      throw error;
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      let message = text;
      if (contentType.includes('application/json')) {
        try {
          const err = JSON.parse(text);
          message = err.message || err.error || err.detail || message;
        } catch (_) { /* keep text */ }
      }
      if (response.status === 404) message = message || 'Not found';
      if (response.status === 403) message = message || 'Access denied';
      const error = new Error(message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (!text) return {};
    if (!contentType.includes('application/json')) {
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Session expired or invalid response — please refresh and log in again.');
      }
      throw new Error('Unexpected server response');
    }
    return JSON.parse(text);
  }

  function slugifyHeading(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  }

  function extractHeadings(markdown) {
    const lines = markdown.split('\n');
    const headings = [];
    lines.forEach(line => {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        headings.push({ level: m[1].length, text: m[2].trim(), id: slugifyHeading(m[2].trim()) });
      }
    });
    return headings;
  }

  function extractTags(markdown) {
    const set = new Set();
    const hashtagMatches = markdown.match(/(^|\s)#([a-zA-Z0-9_-]+)/g) || [];
    hashtagMatches.forEach(m => {
      const tag = m.trim().replace(/^#/, '').replace(/^.*\s#/, '');
      if (tag) set.add(tag);
    });
    const explicitMatches = [...markdown.matchAll(/\[tag:([^\]]+)\]/gi)];
    explicitMatches.forEach(m => {
      const tag = (m[1] || '').trim();
      if (tag) set.add(tag);
    });
    return [...set];
  }

  function buildTagsHtml(tags) {
    if (!tags.length) return '';
    return `<div class="md-tags">${tags.map(tag => `<span class="md-tag">#${tag}</span>`).join('')}</div>`;
  }

  function parseMarkdownImages(plainText) {
    const imageRegex = /!\[(.*?)\]\((.*?)\)(?:\{(.*?)\})?/g;

    const renderedText = plainText.replace(imageRegex, (match, alt, src, attributes) => {
        let width = 'auto';  // Standard: Originalgröße
        let align = 'left';  // Standard: Linksbündig

        if (attributes) {
            // Sucht gezielt nach width=... und align=... innerhalb der Klammer
            const wMatch = attributes.match(/width=([\d%px]+)/);
            const aMatch = attributes.match(/align=(\w+)/);
            
            if (wMatch) width = wMatch[1];
            if (aMatch) align = aMatch[1];
            if (aMatch == null )
               return `<img src="${src}" alt="${alt}" style="width: ${width}; max-width: 100%; height: auto;">`;
            else   
              return `<div style="text-align: ${align}; margin: 10px 0;">
                        <img src="${src}" alt="${alt}" style="width: ${width}; max-width: 100%; height: auto;">
                    </div>`;
        }
        else {
            return `<img src="${src}" alt="${alt}">`;
        }
    });

    return renderedText;

  }

  function parseSheetBlocks (plainText) {


    const regex = /```sheet\n([\s\S]*?)\n```/g;
    
    function formatCell(cell) {
      if (!isNaN(cell) && cell !== "") {
          return Number(cell).toFixed(2);
      }
      return String(cell ?? "");
    }


    function formatSheetBlocks(plainText) {
    // Regex sucht nach Blöcken zwischen ```sheet und ```
      return plainText.replace(/```sheet\s*([\s\S]*?)\s*```/g, (match, content) => {
        const lines = content.split('\n');
        let dataRows = [];
        let configRows = [];
        lines.forEach(line => {
          const trimmedLine = line.trim(); 
          let config = {};
          let configContent = '';
          // Zeilen, die mit ` beginnen, werden als Config geparst
          if (trimmedLine.startsWith('`')) {
              // Extrahiere Inhalt zwischen Backticks: `key=val; key2=val2;`
              const tabCount = trimmedLine.split("\t").length - 1;
              configContent = trimmedLine.replace(/`/g, '')
              
              configContent.split(';').forEach(pair => {
                  const [key, val] = pair.split('=').map(s => s.trim());
                  if (key && val) {
                      config[key] = val;
                    }
                  });
              configRows.push(config);
          } else if (trimmedLine !== "") {
              // Alles andere sind Datenzeilen
              dataRows.push(trimmedLine);
          }
      });

        // Hier kannst du entscheiden, wie der Block ersetzt werden soll
        // Beispiel: Rückgabe als HTML-Tabelle oder transformierter Text
        return transformToHTMLTable(configRows, dataRows);
      });
    }

    function transformToHTMLTable(configRows, rows) {
        const config = configRows[0]||{};
        // Beispielhafte Verarbeitung der geparsten Daten
        const align = config.align || '';
        const style = config.style || 'normal';
        const fontSize =  config["font-size"] || 'medium';
                              // font-size: xx-small;
                              // font-size: x-small;
                              // font-size: small;
                              // font-size: medium;
                              // font-size: large;
                              // font-size: x-large;
                              // font-size: xx-large;
                              // font-size: xxx-large;
                              // font-size: smaller;
                              // font-size: larger
        const frLen =  config.frLen || 2;
        let html = "";
        let c,r = 0;
        html += `<table align="${align}"; style="text-align: ${align}; font-size: ${fontSize}">`;
        let grid = rows.map(line => line.split('\t').map(c => c.trim()));
        rows.forEach(row => {
            html += "<tr>";
            c = 0;
                        // Normale Textzeile: Erhalte ein <br> am Ende (ausser es ist die allerletzte Zeile)
            row = row.replace(/\t \t/g, '\t&emsp;\t');
            row.split('\t').forEach(cell => {
              if (cell.startsWith('=')) {
                try {
                  let formula = cell.substring(1);
                  
                  // 1. Spezialeigenschaft: SUM_ABOVE
                  if (formula.trim() === "SUM_ABOVE") {
                    let total = 0;
                    for (let prevR = 0; prevR < r; prevR++) {
                      let val = parseFloat(grid[prevR][c]);
                      if (!isNaN(val)) total += val;
                    }
                    cell = total;
                  } 
                  // 2. Relative Referenzen: c[y,x]
                  else {
                    let fracLen = frLen;
                    formula = formula.replace(/\.(\d+)$/, (match, digits) => {
                      fracLen = parseInt(digits);
                      return ""; // Entfernt .2 aus der Formel für die Berechnung
                    });
                    formula = formula.replace(/c\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g, function(_, y, x) {
                      let targetR = r + parseInt(y);
                      let targetC = c + parseInt(x);
                      let val = parseFloat(grid[targetR][targetC]);
                      return isNaN(val) ? 0 : val;
                    });
                    const mathScope = `
                      const sqrt = Math.sqrt;
                      const sqr = (n) => Math.pow(n, 2);
                      const abs = Math.abs;
                      const round = Math.round;
                      const pow  = Math.pow;
                      const ln   = Math.log;       // In JS ist Math.log der natürliche Logarithmus
                      const log  = Math.log10;     // Üblicherweise meint log den Zehnerlogarithmus
                      const PI   = Math.PI;
                      const E    = Math.E;
                      const exp   = Math.exp;   // e^x
                      const ceil  = Math.ceil;  // Aufrunden
                      const floor = Math.floor; // Abrunden
                      return ${formula};
                    `;
                    result = new Function(mathScope)();
                    if (fracLen !== null && !isNaN(result)) {
                      cell = result.toFixed(fracLen);
                    } else {
                      cell = result;
                    }
                  }
                  grid[r][c] = cell; // Ergebnis für spätere Zeilen speichern
                } catch (e) {
                  cell = '<span style="color:red">#ERR!</span>';
                }
              }
              html += `<td>${cell}</td>`;
              c++;
            });
            html += "</tr>";
            r++;
        });
        html += "</table>";

        return html;
    }

    return formatSheetBlocks(plainText);

    return plainText.replace(regex, function(match, content) {
      const lines = content.trim().split('\n');
      let grid = lines.map(line => line.split('\t').map(c => c.trim()));
      let tableHtml = '<table class="spreadsheet-table"><tbody>';

      for (let r = 0; r < grid.length; r++) {
          tableHtml += '<tr>';
          for (let c = 0; c < grid[r].length; c++) {
              let cell = grid[r][c];

              if (cell.startsWith('=')) {
                  try {
                      let formula = cell.substring(1);

                      // 1. Spezialeigenschaft: SUM_ABOVE
                      if (formula.trim() === "SUM_ABOVE") {
                          let total = 0;
                          for (let prevR = 0; prevR < r; prevR++) {
                              let val = parseFloat(grid[prevR][c]);
                              if (!isNaN(val)) total += val;
                          }
                          cell = total;
                      } 
                      // 2. Relative Referenzen: c[y,x]
                      else {
                          formula = formula.replace(/c\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g, function(_, y, x) {
                              let targetR = r + parseInt(y);
                              let targetC = c + parseInt(x);
                              let val = parseFloat(grid[targetR][targetC]);
                              return isNaN(val) ? 0 : val;
                          });
                          cell = new Function(`return ${formula}`)();
                      }
                      
                      grid[r][c] = cell; // Ergebnis für spätere Zeilen speichern
                  } catch (e) {
                      cell = '<span style="color:red">#ERR!</span>';
                  }
              }
              if (r === 0)
                tableHtml += `<th>${cell}</th>`;
              else
                tableHtml += `<td>${cell}</td>`;
          }
          tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      return tableHtml;
    });
  }

  function replaceSheetBlocksDiv(markdown) {
    return markdown.replace(/\[sheet:([^\]]+)\]/gi, (_, name) => {
      const clean = (name || '').trim();
      return `
<div class="sheet-block">
  <div class="sheet-block-title">Sheet</div>
  <div class="sheet-block-name">${clean}</div>
</div>`;
    });
  }

  function convertSheetToMd(text) {
    // Regex sucht nach Inhalten zwischen ```sheet und ``` (global, über Zeilen hinweg)
    return text.replace(/```sheet\s*([\s\S]*?)```/g, (match, content) => {
      const lines = content.trim().split('\n');
      if (lines.length === 0) return "";

      // 1. Spalten bei jedem Tabulator (\t) trennen und in Pipes (|) einbetten
      const mdRows = lines.map(line => `| ${line.split('\t').join(' | ')} |`);

      // 2. Trennlinie basierend auf der Spaltenanzahl der ersten Zeile erstellen
      const colCount = lines[0].split('\t').length;
      const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;

      // 3. Trennlinie direkt nach dem Header einfügen
      mdRows.splice(1, 0, separator);

      return mdRows.join('\n').toString();
    });
  }

function formatTextWithMarkup(rawText) {
    // 1. Text an den Zeilenumbrüchen in ein Array aus einzelnen Zeilen aufteilen
    const lines = rawText.split('\n');
    
    // 2. Jede Zeile einzeln verarbeiten
    const processedLines = lines.map((line, index) => {
        const trimmedLine = line.trim();
      
        // Prüfen, ob die Zeile mit '#' beginnt (Markdown-Überschrift)
        if (trimmedLine.startsWith('#')) {
            // Zeile bleibt wie sie ist (wird nicht mit <br> am Ende versehen)
            return line; 
        } else {

            return line + (index < lines.length - 1 ? '<br>' : '');
        }
    });
    
    // 3. Alle Zeilen wieder zu einem einzigen String zusammenfügen
    return processedLines.join('\n');
}

  function preprocessMarkdown(markdown) {
    let md = markdown;
    const tags = extractTags(md);
    // md = formatTextWithMarkup(md)
    md = parseSheetBlocks(md)
    md = parseMarkdownImages(md)
    return { markdown: md, tagsHtml: buildTagsHtml(tags) };
  }




  function renderPreview() {
    const preview = document.getElementById('preview-content');
    if (!preview) return;
    const raw = easyMDE ? (easyMDE.value() || '') : '';

    const hasToc = /\[toc\]/i.test(raw);
    const hasHeader = /^#{1,6}\s+/m.test(raw);
    const floatingToc = document.getElementById('floating-toc');

    if (floatingToc) {
      floatingToc.style.display = (!hasToc && !hasHeader) ? 'none' : '';
    }

    const processed = preprocessMarkdown(raw);
    preview.innerHTML = marked.parse(processed.markdown) + processed.tagsHtml;
    preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { h.id = slugifyHeading(h.textContent); });
    buildFloatingToc();
  }

  function buildFloatingToc() {
    const preview = document.getElementById('preview-content');
    const list = document.getElementById('floating-toc-list');
    if (!preview || !list) return;

    const headings = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (!headings.length) {
      list.innerHTML = '<div class="text-muted small">No headings</div>';
      return;
    }

    headings.forEach((h, index) => {
      if (!h.id) h.id = slugifyHeading(h.textContent) || `heading-${index + 1}`;
    });

    list.innerHTML = headings.map(h => {
      const level = Number(h.tagName.substring(1));
      return `<a href="#${h.id}" class="toc-link toc-level-${level}" data-target="${h.id}">${h.textContent}</a>`;
    }).join('');

    list.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = this.dataset.target;
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    bindTocSpy();
  }

  function bindTocSpy() {
    const preview = document.getElementById('preview-content');
    if (!preview) return;

    const links = [...document.querySelectorAll('#floating-toc-list .toc-link')];
    const headings = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (!links.length || !headings.length) return;

    function updateActiveToc() {
      let activeId = headings[0].id;
      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        if (rect.top - previewRect.top <= 80) activeId = h.id;
      }
      links.forEach(link => { link.classList.toggle('active', link.dataset.target === activeId); });
    }

    preview.onscroll = updateActiveToc;
    updateActiveToc();
  }

  function switchMode(mode) {
    const markdownWrap = document.getElementById('markdown-wrap');
    const previewWrap = document.getElementById('preview-wrap');
    if (markdownWrap) markdownWrap.classList.add('hidden');
    if (previewWrap) previewWrap.classList.add('hidden');

    if (!isEditing) mode = 'preview';

    if (mode === 'markdown') {
      if (markdownWrap) markdownWrap.classList.remove('hidden');
      if (easyMDE) {
        setTimeout(() => {
          easyMDE.codemirror.refresh();
          const toolbar = document.querySelector('#markdown-wrap .editor-toolbar');
          const cm = document.querySelector('#markdown-wrap .CodeMirror');
          if (toolbar) toolbar.style.display = '';
          if (cm) cm.style.display = '';
        }, 50);
      }
    } else {
      if (previewWrap) previewWrap.classList.remove('hidden');
      renderPreview();
    }

    const modeSelect = document.getElementById('editor-mode');
    if (modeSelect) modeSelect.value = mode === 'markdown' && isEditing ? 'markdown' : 'preview';
  }

  function setEditing(editing) {
    isEditing = editing;
    document.body.classList.toggle('editing', editing);
    const btn = document.getElementById('edit-toggle');
    if (btn) btn.textContent = editing ? 'Preview' : 'Edit';
    if (editing) switchMode('markdown');
    else {
      renderPreview();
      switchMode('preview');
    }
  }




  function syncAppShellLayout() {
    const shell = document.querySelector('.app-shell');
    const left = document.getElementById('left-panel');
    if (!shell) return;
    shell.classList.toggle('sidebar-collapsed', left?.classList.contains('collapsed') ?? false);
  }

  function toggleLeftPanel() {
    const panel = document.getElementById('left-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');
    syncAppShellLayout();
  }

  function toggleRightPanel() {
    const panel = document.getElementById('right-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');
  }


  const textColorPicker = document.getElementById('text-color-picker');
  const bgColorPicker = document.getElementById('bg-color-picker');
  let currentCM; // Speichert die CodeMirror-Instanz

  function initEditors() {
    easyMDE = new EasyMDE({
      element: document.getElementById('markdown-editor'),
      spellChecker: false,
      // status: false,
      status: ["autosave", "lines", "words", "cursor"],
      autosave: { enabled: false },
      indentWithTabs: true,
      forceSync: true,
      sideBySideFullscreen: false,
      minHeight: 'calc(100vh - 240px)',
      toolbar: [
        'heading',
        'code', 
        'bold', 'italic','heading','|',
        'quote','unordered-list','ordered-list','|',
        'link','image','table','horizontal-rule','|',
        'preview','side-by-side','fullscreen','|',
        {
            name: "add-tag",
            action: (editor) => {
                const cm = editor.codemirror;
                const selectedText = cm.getSelection() || "tag";
                cm.replaceSelection(`#${selectedText.replace(/\s+/g, '')} `);
            },
            className: "fa fa-hashtag",
            title: "Als Tag markieren",
        },
        "|", 
        {
          name: "line-break",
          action: (editor) => {
            const cm = editor.codemirror;
            cm.replaceSelection("<br>\n");
            cm.focus();
          },
          className: "fa fa-level-down fa-rotate-90", // Icon das wie ein Return-Pfeil aussieht
          title: "Zeilenumbruch (br)",
        },
        {
          name: "indent",
          action: (editor) => {
            const cm = editor.codemirror;
            cm.execCommand("indentMore"); // CodeMirror Standard-Befehl
          },
          className: "fa fa-indent",
          title: "Einrücken",
        },
        {
          name: "outdent",
          action: (editor) => {
            const cm = editor.codemirror;
            cm.execCommand("indentLess"); // CodeMirror Standard-Befehl
          },
          className: "fa fa-outdent",
          title: "Ausrücken",
        },
        "|", 
        {
          name: "text-color",
          action: (editor) => {
            currentCM = editor.codemirror;
            textColorPicker.click();
          },
          className: "fa fa-font", // Icon für Textfarbe
          title: "Text Color",
        },
        {
          name: "bg-color",
          action: (editor) => {
            currentCM = editor.codemirror;
            bgColorPicker.click();
          },
          className: "fa fa-paint-brush", // Icon für Hintergrund
          title: "BackGround Color",
        },
        {
          name: "remove-all-formats",
          action: (editor) => {
            const cm = editor.codemirror;
            let text, range;
            
            // 1. Bereich bestimmen (Markierung oder ganze Zeile)
            if (cm.somethingSelected()) {
              text = cm.getSelection();
            } else {
              const cursor = cm.getCursor();
              const lineNum = cursor.line;
              text = cm.getLine(lineNum);
              range = {
                from: { line: lineNum, ch: 0 },
                to: { line: lineNum, ch: text.length }
              };
            }
            
            // 2. Aggressive Bereinigung (Regex mehrmals anwenden für verschachtelte Tags)
            let cleaned = text;
            
            // Entfernt alle HTML-Tags (span, div, etc.)
            cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, "");
            
            // Entfernt Markdown (Fett, Kursiv, etc.)
            cleaned = cleaned.replace(/(\*\*|__|\*|_|~~|`)/g, "");
            
            // 3. Text im Editor ersetzen
            if (cm.somethingSelected()) {
                    // "around" sorgt dafür, dass die neue Auswahl die alte ersetzt
                    cm.replaceSelection(cleaned, "around");
                } else {
                    cm.replaceRange(cleaned, range.from, range.to);
                }

                // 4. Fokus erzwingen (Wichtig, damit der nächste Klick sofort geht!)
                cm.focus();
            },
            className: "fa fa-eraser",
            title: "Formatierung komplett entfernen",
          },
          '|',
          {
              name: "export-pdf",
              action: (editor) => {
                  // Get rendered HTML from the editor
                  const htmlContent = editor.options.previewRender(editor.value());
                  
                  // Create temp container for html2pdf
                  const element = document.createElement('div');
                  element.innerHTML = htmlContent;

                  html2pdf().set({
                    margin: [20, 10, 20, 10],
                    filename: currentPage.title,
                    html2canvas: {
                      scale: 2,   // ✅ high resolution
                      useCORS: true
                    },
                    jsPDF: {
                      unit: 'mm',
                      format: 'a4',
                      orientation: 'portrait'
                    }
                  }).from(element).toPdf().get('pdf').then(function (pdf) {
                    
                    // ✅ add page numbers
                    const totalPages = pdf.internal.getNumberOfPages();

                    for (let i = 1; i <= totalPages; i++) {
                      pdf.setPage(i);

                      pdf.setFontSize(10);
                      pdf.setTextColor(100);

                      pdf.text(
                        `${i} / ${totalPages}`, 
                        105,          // center horizontally (A4 = 210mm)
                        290,          // bottom position
                        { align: 'center' }
                      );
                    }

                  }).save();


                  // Trigger download using html2pdf library
                  // html2pdf().from(element).save('document.pdf');
              },
              className: "fa fa-file-pdf-o", // FontAwesome icon class
              title: "Export to PDF",        // Tooltip text
          },
          '|', 'guide', '|',
        ],
        previewRender: function(plainText) {
          md = preprocessMarkdown(plainText)
          return this.parent.markdown(md.markdown);
    }
    });

    easyMDE.codemirror.setOption("extraKeys", {
        "Tab": function(cm) {
            const cursor = cm.getCursor();
            const line = cm.getLine(cursor.line);

            // If cursor is at end of line → insert real tab
            if (cursor.ch === line.length) {
                cm.replaceSelection("\t");
            } else {
                // Otherwise indent normally
                cm.execCommand("defaultTab");
            }
        },
        "Shift-Tab": "indentLess"
    });

    easyMDE.codemirror.on('change', () => { if (isEditing) scheduleSave(); });

    setTimeout(() => { if (easyMDE) easyMDE.codemirror.refresh(); }, 200);
  }

  async function saveTree(nodeId)
  {
    var v = $('#tree').jstree(true).get_json('#', {flat:true}); // Hol dir den flachen Baum
    const openedNodes = [];
    $('#tree').find(".jstree-open").each(function () {
      openedNodes.push(this.id);
    });
    const state = {
      workspace: workspaceId, // Ihr Workspace-ID
      opened: openedNodes,
      selected: nodeId,
      // csrfmiddlewaretoken: '{{ csrf_token }}'
    };
    console.log("saveTree",workspaceId, nodeId, state);
    url= `api/workspaces/${workspaceId}/saveTree/`
    console.log(apiUrl(url))
    await api(url, 'POST', state, false);
  }


  async function updateUserSettings(settingsDelta = {}) {
    try {
      syncWorkspaceIdFromDom();
      if (!workspaceId) return false;

      const payload = {
        last_workspace_id: Number(workspaceId),
        last_page_id: currentPageId,
        ...settingsDelta,
      };
      const url = `api/workspaces/${workspaceId}/updateUserSettings/`;
      await api(url, 'POST', payload, false);
      return true;
    } catch (err) {
      console.warn('updateUserSettings failed:', err);
      if (err.network) {
        setStatus('Server offline — last page not saved');
      }
      return false;
    }
  }
  
  function isTreeFolder(node) {
    if (!node) return false;
    if (node.id === '#') return true;
    if (node.type === 'folder') return true;
    if (node.original?.type === 'folder') return true;
    return node.original?.data?.is_folder === true;
  }

  function parsePageId(id) {
    if (id === null || id === undefined || id === '' || id === '#') return null;
    const n = parseInt(String(id), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function firstPageNodeId(tree) {
    if (!tree) return null;
    const nodes = tree.get_json('#', { flat: true });
    for (const n of nodes) {
      const node = tree.get_node(n.id);
      if (node && !isTreeFolder(node)) {
        const pageId = parsePageId(n.id);
        if (pageId) return pageId;
      }
    }
    return null;
  }

  function bindTreeEvents() {
    const $tree = $('#tree');

    $tree.off('select_node.jstree').on('select_node.jstree', function (e, data) {
      const node = data.node;
      if (!node || isTreeFolder(node)) return;
      const pageId = parsePageId(node.id);
      if (!pageId) return;
      loadPage(pageId);
    });

    $tree.off('rename_node.jstree').on('rename_node.jstree', function (e, data) {
      api(`api/pages/${data.node.id}/update/`, 'POST', { title: data.text }).then(p => {
        const titleInput = document.getElementById('page-title');
        const titlePreview = document.getElementById('page-title-preview');
        const slugEl = document.getElementById('page-slug');
        if (String(currentPageId) === String(p.id)) {
          if (titleInput) titleInput.value = p.title;
          if (titlePreview) titlePreview.textContent = p.title;
          if (slugEl) slugEl.textContent = p.slug;
        }
      });
    });

    $tree.off('move_node.jstree').on('move_node.jstree', function (e, data) {
      api('api/pages/reorder/', 'POST', { id: data.node.id, parent: data.parent, position: data.position })
        .then(() => setStatus('Tree updated'));
    });
  }

  function selectTreeNode(id) {
    const pageId = parsePageId(id);
    if (!pageId) return false;
    const tree = $('#tree').jstree(true);
    if (!tree) return false;
    const nodeId = String(pageId);
    const node = tree.get_node(nodeId);
    if (!node || isTreeFolder(node)) return false;
    tree.select_node(nodeId);
    return true;
  }

  async function loadTree(selectId = null) {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return Promise.resolve();
    const data = await api(`api/workspaces/${workspaceId}/tree/`);
    const existing = $('#tree').jstree(true);
    const target = selectId || currentPageId;

    return new Promise((resolve) => {
      const finish = () => {
        const tree = $('#tree').jstree(true);
        if (target && selectTreeNode(target)) {
          resolve();
          return;
        }
        const fallbackId = firstPageNodeId(tree);
        if (fallbackId) {
          selectTreeNode(fallbackId);
        } else {
          currentPageId = null;
          currentPage = null;
          switchMode('preview');
        }
        resolve();
      };

      if (existing) {
        $('#tree').one('refresh.jstree', finish);
        existing.settings.core.data = data;
        existing.refresh();
        return;
      }

      $('#tree').one('ready.jstree', finish);
      $('#tree').jstree({
        core: { data, check_callback: true },
        plugins: ['dnd', 'search', 'types', 'contextmenu'],
        types: { folder: { icon: 'jstree-folder' }, page: { icon: 'jstree-file' } },
        contextmenu: {
          items: function (node) {
            return {
              createPage: { label: 'Create page', action: () => createNode(false, node.id) },
              createFolder: { label: 'Create folder', action: () => createNode(true, node.id) },
              rename: { label: 'Rename', action: () => $('#tree').jstree(true).edit(node) },
              deleteItem: { label: 'Delete', action: () => deletePage(node.id) }
            };
          }
        }
      });
    });
  }

  async function loadPage(id) {
    const pageId = parsePageId(id);
    if (!pageId) {
      setStatus('Select a page');
      return;
    }

    try {
      setStatus('Loading...');
      currentPage = await api(`api/pages/${pageId}/`);
      currentPageId = currentPage.id;

      const titleInput = document.getElementById('page-title');
      const titlePreview = document.getElementById('page-title-preview');
      const slugEl = document.getElementById('page-slug');

      if (titleInput) titleInput.value = currentPage.title || '';
      if (titlePreview) titlePreview.textContent = currentPage.title || 'Untitled';
      if (slugEl) slugEl.textContent = currentPage.slug || '';

      if (easyMDE) easyMDE.value(currentPage.markdown_content || '');

      if (isEditing) switchMode('markdown');
      else switchMode('preview');

      await updateUserSettings();
      setStatus('Loaded');
    } catch (err) {
      console.error('loadPage failed:', err);
      const msg = err.message || 'Failed to load page';
      setStatus(msg.length > 80 ? 'Failed to load page' : msg);
      if (err.status === 404) {
        currentPageId = null;
        currentPage = null;
      }
    }
  }

  async function savePage() {
    if (!currentPageId || !currentPage) return;

    setStatus('Saving...');

    const titleInput = document.getElementById('page-title');
    const titlePreview = document.getElementById('page-title-preview');
    const slugEl = document.getElementById('page-slug');

    const payload = {
      title: titleInput ? titleInput.value : (currentPage.title || 'Untitled'),
      editor_mode: 'markdown',
      markdown_content: easyMDE ? easyMDE.value() : ''
    };

    currentPage = await api(`api/pages/${currentPageId}/update/`, 'POST', payload);

    if (slugEl) slugEl.textContent = currentPage.slug || '';
    if (titlePreview) titlePreview.textContent = currentPage.title || 'Untitled';

    const tree = $('#tree').jstree(true);
    if (tree && currentPageId) tree.rename_node(String(currentPageId), currentPage.title);

    setStatus('Saved');
  }

  function scheduleSave() {
    if (!currentPageId || !isEditing) return;
    clearTimeout(autosaveTimer);
    setStatus('Typing...');
    autosaveTimer = setTimeout(savePage, 700);
  }

  async function createNode(isFolder, parentId = null) {
    const page = await api('api/pages/create/', 'POST', {
      workspace: workspaceId,
      title: isFolder ? 'New Folder' : 'New Page',
      parent: parentId || '#',
      is_folder: isFolder
    });

    await loadTree(page.id);
    await updateUserSettings();
    if (!isFolder) 
      await loadPage(page.id);
  }

  async function deletePage(id = currentPageId) {
    if (!id || !confirm('Delete this item?')) return;

    await api(`api/pages/${id}/delete/`, 'POST', {});
    currentPage = null;
    currentPageId = null;

    const titleInput = document.getElementById('page-title');
    const titlePreview = document.getElementById('page-title-preview');
    const slugEl = document.getElementById('page-slug');

    if (titleInput) titleInput.value = '';
    if (titlePreview) titlePreview.textContent = '';
    if (slugEl) slugEl.textContent = '';
    if (easyMDE) easyMDE.value('');

    await loadTree();
    await updateUserSettings();
    setStatus('Deleted');
  }

  async function loadFiles() {
    const files = await api(`api/workspaces/${workspaceId}/files/`);
    const list = document.getElementById('file-list');
    if (!list) return;

    list.innerHTML = files.map(f => `
      <div class="file-item">
        <div>${f.original_name}</div>
        <div>
          <a href="${f.furl}" target="_blank">Open</a>
          <button class="btn btn-sm btn-outline-light insert-file" data-url="${f.furl}">Insert</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.insert-file').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        if (easyMDE) {
          // Prüfen, ob die URL auf eine gängige Bildendung endet
          const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
          const fileName = url.split('/').pop(); 
          const cleanName = fileName.replace(/_[A-Za-z0-9]+(?=\.[a-z0-9]+$)/i, '');
          const markdownLink = isImage 
            ? `![image](${url})\n` 
            : `[${cleanName}](${url})\n`;

          easyMDE.codemirror.replaceSelection(markdownLink);
          scheduleSave();
        }
      });
    });
  }

  async function handleFiles(fileList) {
    for (const file of fileList) {
      const data = new FormData();
      data.append('workspace', workspaceId);
      data.append('file', file);
      await api('api/uploads/', 'POST', data, true);
    }
    setStatus('Upload complete');
    await loadFiles();
  }

  function bindUi() {
    bindTreeEvents();
    document.getElementById('page-title')?.addEventListener('change', savePage);
    document.getElementById('editor-mode')?.addEventListener('change', e => switchMode(e.target.value));
    document.getElementById('create-page')?.addEventListener('click', () => createNode(false));
    document.getElementById('create-folder')?.addEventListener('click', () => createNode(true));
    document.getElementById('delete-page')?.addEventListener('click', () => deletePage());

    document.getElementById('workspace-select')?.addEventListener('change', async e => {
      const select = document.getElementById('workspace-select');
      const newOption = document.createElement('option');
      const selectedOption = select.options[select.selectedIndex];
      const optionText = selectedOption.text;
      
      const renameBtn = document.getElementById('ws-rename-btn');
      const deleteBtn = document.getElementById('ws-delete-btn');
      
      // Wenn KEIN Doppelpunkt im Text ist, ist es dein eigener Workspace
      if (!optionText.includes(':')) {
          if (renameBtn) renameBtn.classList.remove('d-none');
          if (deleteBtn) deleteBtn.classList.remove('d-none');
      } else {
          // Es ist ein geteilter Workspace -> Optionen ausblenden
          if (renameBtn) renameBtn.classList.add('d-none');
          if (deleteBtn) deleteBtn.classList.add('d-none');
      }
      workspaceId = e.target.value;
      currentPageId = null;
      currentPage = null;
      await loadTree();
      await updateUserSettings();
      await loadFiles();
      // switchWorkspace(workspaceId)
      switchMode('preview');
    });

    document.getElementById('new-workspace')?.addEventListener('click', async () => {
      const name = prompt('Workspace name');
      if (!name) return;

      const ws = await api('api/workspaces/', 'POST', { name });
      const select = document.getElementById('workspace-select');
      if (!select) return;

      const option = document.createElement('option');
      option.value = ws.id;
      option.textContent = ws.name;
      select.appendChild(option);
      select.value = ws.id;

      workspaceId = ws.id;
      currentPageId = null;
      currentPage = null;
      // await loadTree();
      // await updateUserSettings();
      // await loadFiles();
    });

    // CREATE: Add Workspace
// CREATE: Add Workspace
    document.getElementById('ws-add-btn').addEventListener('click', async (e) => {
        e.preventDefault(); // Stop any unintended form submissions
        const name = prompt('Enter new workspace name:');
        if (name && name.trim() !== '') {
            result = await api('api/workspaces/create/','POST', { name: name.trim() })
            const select = document.getElementById('workspace-select');
            
            // 1. Create new HTML option element
            const newOption = document.createElement('option');
            newOption.value = result.id; // Uses the ID sent back by your Django view
            newOption.text = name.trim();
            newOption.selected = true; // Automatically select the newly created item
            
            // 2. Append to dropdown list
            select.appendChild(newOption);
            
            // 3. Dispatch change event to let your system know the active workspace switched
            select.dispatchEvent(new Event('change'));
            renameBox.classList.add('d-none');
        }
        else
          renameBox.classList.add('d-none');
    });
    const renameBox = document.getElementById('ws-rename-box');
    document.getElementById('ws-rename-btn').addEventListener('click',async () => {
      const workspaceSelect = document.getElementById('workspace-select');
      const selectedOption = workspaceSelect.options[workspaceSelect.selectedIndex];
      if (!selectedOption) return;
      
      const renameInput = document.getElementById('ws-rename-input');
      renameInput.value = selectedOption.text;
      renameBox.classList.remove('d-none');
    });
    const cancelBtn = document.getElementById('ws-cancel-btn');
    // const workspaceModal = document.getElementById('workspace-modal'); // Dein Modal-Container

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            renameBox.classList.add('d-none');
            // Option A: Wenn du ein Bootstrap-Modal nutzt
            // const modalInstance = bootstrap.Modal.getInstance(workspaceModal);
            // if (modalInstance) modalInstance.hide();

            // Option B: Reines Vanilla JS (Klasse zum Verstecken entfernen/hinzufügen)
            // workspaceModal.classList.add('hidden');
            
            // Option C: Eventuell das Formular zurücksetzen
            // const wsForm = document.getElementById('workspace-form');
            // if (wsForm) wsForm.reset();
            
            console.log("Workspace-Aktion wurde abgebrochen.");
        });
    }
        // UPDATE: Save New Name
    document.getElementById('ws-save-btn').addEventListener('click', async () => {
        const workspaceSelect = document.getElementById('workspace-select');
        const renameInput = document.getElementById('ws-rename-input');
        const renameBox = document.getElementById('ws-rename-box');
        const workspaceId = workspaceSelect.value;
        const newName = renameInput.value.trim();
        if (newName && workspaceId) {
            api(`api/workspaces/${workspaceId}/update/`,'POST', { name: newName });
            workspaceSelect.options[workspaceSelect.selectedIndex].text = newName;
            renameInput.value = '';
            renameBox.classList.add('d-none'); 
        } else {
            renameBox.classList.add('d-none');
        } 
    });

    async function handleDelete(select, selectedOption, workspace_id) { 
      
        if (confirm(`Are you sure you want to delete "${selectedOption.text}"?`)) {
            try {
                await api(`api/workspaces/${workspaceId}/delete/`, 'POST', false);
                select.remove(select.selectedIndex);
            } catch (error) {
                console.error(error);
            }
        }
        else {
          renameBox.classList.add('d-none');
        }
    }

// DELETE: Remove Workspace
  document.getElementById('ws-delete-btn').addEventListener('click', () => {
    const select = document.getElementById('workspace-select');
    const workspaceId = select.value;
    const selectedOption = select.options[select.selectedIndex];
    if (!workspaceId) return;
    handleDelete(select, selectedOption, workspaceId);
    // if (confirm(`Are you sure you want to delete "${selectedOption.text}"?`)) {
    //     await api(`api/workspaces/${workspaceId}/delete/`,'POST', false)
    //     .then(data => {
    //       //     // Remove option block from DOM structures directly
    //           select.remove(select.selectedIndex);
              
    //       //     // Automatically switch layout view to the next remaining workspace option
    //           select.dispatchEvent(new Event('change'));
    //     });
    // }
  });



    const userListContainer = document.getElementById('worksheet-users');
    const searchInput = document.getElementById('user-search-input');
    const resultsDropdown = document.getElementById('search-results-dropdown');
    const spinnerContainer = document.getElementById('search-spinner-container');
    let searchTimer;

    if (!searchInput) return;

    searchInput.addEventListener('input', function() {
        const query = this.value.trim();
        
        if (query.length < 2) {
            resultsDropdown.classList.add('d-none');
            spinnerContainer.classList.add('d-none'); // Verstecken bei zu kurzem Text
            return;
        }

        // Zeige den Spinner sofort an, während der User tippt
        spinnerContainer.classList.remove('d-none');

        // Debounce: Verhindert zu viele API-Anfragen kurz hintereinander
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            fetch(apiUrl(`/api/users/search/?q=${encodeURIComponent(query)}`))
                .then(res => res.json())
                .then(data => {
                    // Verstecke den Spinner, sobald Daten da sind
                    spinnerContainer.classList.add('d-none');
                    resultsDropdown.innerHTML = '';
                    
                    if (data.status === 'success' && data.users.length > 0) {
                        data.users.forEach(user => {
                            const li = document.createElement('li');
                            li.className = 'list-group-item list-group-item-action py-1 px-2 border-0';
                            li.style.cursor = 'pointer';
                            li.style.fontSize = '0.85rem';
                            li.innerHTML = `➕ <strong>${user.username}</strong> <small class="text-muted">(${user.email || 'Keine E-Mail'})</small>`;
                            
                            li.addEventListener('click', () => {
                                addMemberToWorkspace(user.username);
                                resultsDropdown.classList.add('d-none');
                                searchInput.value = '';
                            });
                            
                            resultsDropdown.appendChild(li);
                        });
                        resultsDropdown.classList.remove('d-none');
                    } else {
                        resultsDropdown.innerHTML = '<li class="list-group-item text-muted py-1 px-2 border-0 small">Keine Benutzer gefunden</li>';
                        resultsDropdown.classList.remove('d-none');
                    }
                })
                .catch(err => {
                    // Wichtig: Auch bei einem Netzwerkfehler den Spinner wieder ausschalten
                    spinnerContainer.classList.add('d-none');
                    console.error('Suchfehler:', err);
                });
        }, 300); // Wartet 300ms nach dem letzten Tastendruck
    });


    // Schliesse das Such-Dropdown, wenn man ausserhalb klickt
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDropdown.contains(e.target)) {
            resultsDropdown.classList.add('d-none');
        }
    });

    // 2. MITGLIED HINZUFÜGEN: Sendet Daten an die View
    function addMemberToWorkspace(username) {
        const workspaceId = document.getElementById('workspace-select')?.value;
        if (!workspaceId) return;

        fetch(apiUrl('/api/workspaces/add-user/'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
            },
            body: JSON.stringify({ username: username, workspace_id: workspaceId })
        })
        .then(res => res.json())
        .then(result => {
            if (result.status === 'success') {
                // Füge das neue Mitglied ohne Seiten-Reload visuell zur Liste hinzu
                appendUserRow(member.id, member.username, member.is_owner, member.role);
                showToast(`${result.username} added.`, 'success');
            } else {
                showToast(result.message || 'Error adding member.', 'danger');
            }
        })
        .catch(() => showToast('action failed.', 'danger'));
    }

      const select = document.getElementById('workspace-select');

      // Main function to load and render members
      function loadWorkspaceMembers(workspaceId) {
        if (!workspaceId) return;

        fetch(apiUrl(`/api/workspaces/${workspaceId}/members/`))
        .then(res => res.json())
        // .then(
        //   res => 
        //     // if (res.ok)
        //     res.json()
        //   )
        .then(data => {
            if (data.status === 'success') {
                window.isCurrentUserOwner = data.is_current_user_owner;

                // 1. Hole den Edit-Toggle Button aus dem DOM
                const editToggle = document.getElementById('edit-toggle');
                
                // 2. Finde die Rolle des aktuell eingeloggten Benutzers in der Antwortliste
                // (Der Server liefert das Feld 'role' für jedes Mitglied mit)
               
                const currentUserMembership = data.members.find(m => m.id === currentUserId);
                const currentUserRole = currentUserMembership ? currentUserMembership.role : 'read';

                // 3. Logik zum Ein- und Ausblenden:
                // Wenn der User der Besitzer ist ODER die Rolle 'write' (Schreiben) hat -> Zeigen
                // Wenn er nur 'read' (Nur Lesen) hat -> Ausblenden
                if (window.isCurrentUserOwner || currentUserRole === 'write') {
                    if (editToggle) editToggle.classList.remove('d-none');
                } else {
                    if (editToggle) editToggle.classList.add('d-none');
                }

                // Danach wird deine Liste wie gewohnt gezeichnet
                const userListContainer = document.getElementById('worksheet-users');
                userListContainer.innerHTML = '';
                data.members.forEach(member => {
                    appendUserRow(member.id, member.username, member.is_owner, member.role);
                });
                updateBadgeCount();
                const inviteBox = document.getElementById('invite-email-box');
                if (inviteBox) {
                    if (data.is_current_user_owner) inviteBox.classList.remove('d-none');
                    else inviteBox.classList.add('d-none');
                }
                populateMailRecipients(data.members);
            }
        });
      }
      // Dynamic row generation builder helper (Updated to support ownership flag)
      function appendUserRow(id, name, isOwner, role) {
          const userListContainer = document.getElementById('worksheet-users');
          if (!userListContainer) return;

          const li = document.createElement('li');
          li.className = 'list-group-item d-flex justify-content-between align-items-center px-2 py-2 border-0 rounded-2 mb-1 user-row-hover';
          li.dataset.userId = id;
          
          const initials = name.split(/[\s._-]+/).map(n => n).join('').toUpperCase().substring(0, 2) || name.toUpperCase();
          const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#6f42c1'];
          const avatarColor = colors[name.charCodeAt(0) % colors.length];

          let actionHTML = '';
          let badgeHTML = '';

          if (isOwner || role === 'owner') {
              badgeHTML = `<span class="badge bg-warning text-dark ms-1" style="font-size: 0.65rem;">Owner</span>`;
              actionHTML = `<span class="text-muted small" title="Workspace Owner">🔒</span>`;
          } else {
              // Erzeuge ein interaktives Badge mit einer ID/Klasse zum späteren Auswählen
              const badgeClass = role === 'write' ? 'bg-info' : 'bg-secondary';
              const badgeText = role === 'write' ? 'write' : 'only read access';
              const pointerStyle = window.isCurrentUserOwner ? 'cursor: pointer;' : '';
              const titleText = window.isCurrentUserOwner ? 'click to change the role' : 'your role';

              badgeHTML = `<span class="badge ${badgeClass} text-white ms-1 role-toggle-badge" style="font-size: 0.65rem; ${pointerStyle}" title="${titleText}">${badgeText}</span>`;

              if (window.isCurrentUserOwner) {
                  actionHTML = `<button class="btn btn-sm btn-link text-danger p-0 border-0 remove-user-btn" style="text-decoration: none;" title="Mitglied entfernen">✕</button>`;
              }
          }

          li.innerHTML = `
              <div class="d-flex align-items-center gap-2">
                  <div class="avatar-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm" 
                      style="background-color: ${avatarColor}; width: 28px; height: 28px; border-radius: 50%; font-size: 0.75rem;">
                      ${initials}
                  </div>
                  <div class="d-flex flex-column">
                      <div class="d-flex align-items-center gap-1">
                          <span class="fw-semibold text-dark mb-0" style="font-size: 0.85rem;">${name}</span>
                          <span class="badge-container">${badgeHTML}</span>
                      </div>
                  </div>
              </div>
              <div>${actionHTML}</div>
          `;
          const removeButton = li.querySelector('.remove-user-btn');
          if (removeButton) {
            removeButton.addEventListener('click', () => {
              const workspaceId = document.getElementById('workspace-select').value;
              fetch(apiUrl('/api/workspaces/remove-user/'), {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
                  },
                  body: JSON.stringify({ user_id: id, workspace_id: workspaceId })
              }).then(res => {
                  if (res.ok) {
                      li.remove();
                      updateBadgeCount();
                  }
              });
            });
          }
          if (window.isCurrentUserOwner && role !== 'owner' && !isOwner) {
              const badgeElement = li.querySelector('.role-toggle-badge');
              if (badgeElement) {
                  badgeElement.addEventListener('click', function() {
                      const workspaceId = document.getElementById('workspace-select').value;
                      
                      fetch(apiUrl('/api/workspaces/change-role/'), {
                          method: 'POST',
                          headers: {
                              'Content-Type': 'application/json',
                              'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
                          },
                          body: JSON.stringify({ 
                              user_id: id, 
                              workspace_id: workspaceId 
                          })
                      })
                      .then(res => {
                          if (!res.ok) throw new Error('Netzwerkfehler');
                          return res.json();
                      })
                      .then(result => {
                          if (result.status === 'success') {
                              // Aktualisiere das Badge-Design direkt live im DOM
                              if (result.role === 'write') {
                                  this.className = 'badge bg-info text-white ms-1 role-toggle-badge';
                                  this.textContent = 'write';
                              } else {
                                  this.className = 'badge bg-secondary text-white ms-1 role-toggle-badge';
                                  this.textContent = 'only read';
                              }

                              const editToggle = document.getElementById('edit-toggle');
                              if (editToggle) {
                                  if (result.role === 'write' || window.isCurrentUserOwner) {
                                      editToggle.classList.remove('d-none');
                                  } else {
                                      editToggle.classList.add('d-none');
                                  }
                              }
                              showToast(result.message, 'success');


                          } else {
                              showToast(result.message, 'danger');
                          }
                      })
                      .catch(() => showToast('Rollenwechsel fehlgeschlagen.', 'danger'));
                  });
              }
          }


          // [Hier bleibt dein bestehender Event-Listener für den remove-user-btn...]
          userListContainer.appendChild(li);
      }

      function updateBadgeCount() {
          const countBadge = document.getElementById('user-count');
          if (countBadge) {
              countBadge.textContent = userListContainer.children.length;
          }
      }

      // RUN ON LOAD: Fetch data immediately for the selected item
      if (select && select.value) {
          loadWorkspaceMembers(select.value);
      }

      // RUN ON CHANGE: Fetch dynamic updates if the dropdown selection changes
      if (select) {
          select.addEventListener('change', function() {
              loadWorkspaceMembers(this.value);
          });
      }


 
    const inviteInput = document.getElementById('invite-username');
    const datalist = document.getElementById('user-suggestions');
    let debounceTimer;

    if (inviteInput && datalist) {
        inviteInput.addEventListener('input', function() {
            const query = this.value.trim();
            
            // Zurücksetzen, wenn das Feld geleert wird oder zu kurz ist
            if (query.length < 2) {
                datalist.innerHTML = '';
                return;
            }

            // Debounce: Wartet 300ms nach dem letzten Tastendruck, bevor gefetcht wird
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetch(apiUrl(`/api/users/search/?q=${encodeURIComponent(query)}`))
                    .then(res => res.json())
                    .then(data => {
                        datalist.innerHTML = ''; // Alte Vorschläge löschen
                        
                        if (data.status === 'success') {
                            data.users.forEach(user => {
                                const option = document.createElement('option');
                                option.value = user.username; // Wird im Input eingetragen
                                datalist.appendChild(option);
                            });
                        }
                    })
                    .catch(err => console.error('Error fetching user suggestions:', err));
            }, 300);
        });
    }

    let to = null;
    
    document.getElementById('toggle-left')?.addEventListener('click', toggleLeftPanel);
    document.getElementById('toggle-right')?.addEventListener('click', toggleRightPanel);
    document.getElementById('tree-search')?.addEventListener('keyup', function () {
      if (to) 
        clearTimeout(to);
      to = setTimeout(() => $('#tree').jstree(true).search(this.value), 200);
    });

    document.getElementById('file-input')?.addEventListener('change', async e => {
      await handleFiles(e.target.files);
      e.target.value = '';
    });

    const dz = document.getElementById('dropzone');
    ['dragenter','dragover'].forEach(ev => {
      dz?.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.add('active');
      });
    });

    ['dragleave','drop'].forEach(ev => {
      dz?.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.remove('active');
      });
    });

    dz?.addEventListener('drop', async e => {
      await handleFiles(e.dataTransfer.files);
    });

    document.getElementById('edit-toggle')?.addEventListener('click', () => {
      setEditing(!isEditing);
    });
  }

  initEditors();
  bindUi();
  setEditing(false);
  syncWorkspaceIdFromDom();
  loadTree(currentPageId).then(() => {
    if (!currentPageId) switchMode('preview');
  });
  loadFiles();
  syncAppShellLayout();
  initChatAndMail();


  document.getElementById('toc-toggle').addEventListener('click', function() {
    const toc = document.querySelector('.floating-toc');
    toc.classList.toggle('active');
    
    // Optional: Text ändern
    this.textContent = toc.classList.contains('active') ? 'close' : 'content';
  });

  async function saveState() {
      const tree = $('#tree').jstree(true);
      const openedNodes = [];
      $('#tree').find(".jstree-open").each(function () {
        openedNodes.push(this.id);
      });
      // var selected = $('#tree').get_selected();
      // const state = {
      //   workspace: workspaceId, // Ihr Workspace-ID
      //   opened: openedNodes,
      //   selected: selected,

      //     // csrfmiddlewaretoken: '{{ csrf_token }}'
      // };
      // await api('api/save-tree-state/', 'POST', data, true);
  }

  document.addEventListener('paste', function (event) {
   const items = (event.clipboardData || event.originalEvent.clipboardData).items;
      for (let index in items) {
          const item = items[index];
          if (item.kind === 'file') {
              const blob = item.getAsFile();
              const formData = new FormData();
              formData.append('image', blob, 'screenshot.png');
              formData.append('workspace', workspaceId);
              // await api('api/uploads/', 'POST', formData, true)
              // const ws = await api('api/workspaces/', 'POST', { name });// Send to your Django view
              api(`api/upload_pasted_image/`, 'POST', formData, true)
              .then(data => {
                  // 3. HIER kannst du auf deine Django-Felder wie data.success zugreifen
                  if (data.success) {
                    //   console.log('Gespeichert unter:', data.url);
                    //   const imgHtml = `<img src="${data.url}" alt="Pasted Image" style="max-width: 100%;">`;
                    // // 1. Hole die aktuelle Auswahl (Selection)
                      const selection = window.getSelection();
                      if (!selection.rangeCount) return;

                      // 2. Erstelle ein neues Range-Objekt
                      const range = selection.getRangeAt(0);
                      range.deleteContents(); // Löscht markierten Text, falls vorhanden

                      const linkName = data.file.original_name || 'screenshot';
                      const mdLink = `![${linkName}](${data.file.mediaName}){width=100%}`;

                      const cm = easyMDE.codemirror; 
                      

                      const doc = cm.getDoc();
                      const cursor = doc.getCursor(); // Aktuelle Position
                      doc.replaceRange(mdLink, cursor);
                      
                      // 3. Fokus zurück auf den Editor setzen
                      cm.focus();
                  } 
                  else {
                      console.error('Django meldet Fehler:', data.error);
                  }

            })
            .catch(error => {
                console.error('Error:', error);
            });
          }
      }
  });


  function togglePanel(header) {
      const body = header.nextElementSibling;

      body.classList.toggle("collapsed");
      header.classList.toggle("collapsed");
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', function () {
            togglePanel(header);
        });
    });
  });



    // 2. Event-Listener optimieren
  function handleColorInput(e, styleType) {
      if (!currentCM) return;

      const color = e.target.value;
      const selection = currentCM.getSelection() || "Text";
      
      // HTML einfügen
      currentCM.replaceSelection(`<span style="${styleType}:${color}">${selection}</span>`);
      
      // WICHTIG: Fokus zurück zum Editor
      currentCM.focus();
      
      // WICHTIG: Wert zurücksetzen, damit dasselbe Farbfeld 
      // beim nächsten Mal wieder ein "input"-Event auslöst
      e.target.value = "#000000"; 
  }
  // Listener für Textfarbe
  document.getElementById('text-color-picker').addEventListener('input', (e) => {
      handleColorInput(e, 'color');
  });

  document.getElementById('bg-color-picker').addEventListener('input', (e) => {
      handleColorInput(e, 'background-color');
  });


  function switchWorkspace(workspaceId) {
      $('#tree').jstree(true).settings.core.data.url = api(`api/get-tree/${workspaceId}/`);
      $('#tree').jstree(true).refresh();
  }

  function downloadPDF() {
      // Get the rendered HTML from the editor
      const htmlContent = easyMDE.options.previewRender(easyMDE.value());

      // Create a temporary container for rendering
      const element = document.createElement('div');
      element.innerHTML = htmlContent;

      html2pdf().from(element).save('document.pdf');
  }

  function showToast(message, type = 'success') {
      const toastEl = document.getElementById('action-toast');
      const toastMessage = document.getElementById('toast-message');
      if (!toastEl || !toastMessage) return;

      toastEl.classList.remove('bg-success', 'bg-danger');
      toastEl.classList.add(type === 'success' ? 'bg-success' : 'bg-danger');
      toastMessage.textContent = message;

      const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
      toast.show();
  }

  // ——— Chat & mail ———
  let chatPollTimer = null;
  let lastChatId = 0;
  let mailBox = 'inbox';

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  function populateMailRecipients(members) {
    const sel = document.getElementById('mail-compose-recipients');
    const hint = document.getElementById('mail-recipients-hint');
    if (!sel) return;
    sel.innerHTML = '';
    (members || []).filter(m => m.id !== currentUserId).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.username + (m.is_owner ? ' (owner)' : '');
      sel.appendChild(opt);
    });
    if (hint) {
      if (!sel.options.length) {
        hint.textContent = 'You are the only member — mail goes to your own inbox.';
        hint.classList.remove('d-none');
      } else {
        hint.textContent = 'Leave empty to mail all other members.';
        hint.classList.remove('d-none');
      }
    }
  }

  function renderChatMessages(messages, appendOnly = false) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    if (!appendOnly) box.innerHTML = '';
    messages.forEach(msg => {
      if (msg.id > lastChatId) lastChatId = msg.id;
      const mine = msg.sender_id === currentUserId;
      const el = document.createElement('div');
      el.className = 'chat-bubble ' + (mine ? 'mine' : 'theirs');
      el.dataset.id = msg.id;
      const time = new Date(msg.created_at).toLocaleString();
      el.innerHTML = `<div class="meta">${escapeHtml(msg.sender)} · ${time}</div>${escapeHtml(msg.body)}`;
      if (!appendOnly || !box.querySelector(`[data-id="${msg.id}"]`)) {
        box.appendChild(el);
      }
    });
    box.scrollTop = box.scrollHeight;
  }

  async function loadChat(full = false) {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;
    try {
      const chatUrl = lastChatId && !full
        ? `api/workspaces/${workspaceId}/chat/?after=${lastChatId}`
        : `api/workspaces/${workspaceId}/chat/`;
      const data = await api(chatUrl);
      if (data.status === 'success' && data.messages.length) {
        renderChatMessages(data.messages, !full && lastChatId > 0);
      }
    } catch (e) {
      console.warn('chat load', e);
    }
  }

  function startChatPolling() {
    stopChatPolling();
    lastChatId = 0;
    loadChat(true);
    chatPollTimer = setInterval(() => loadChat(false), 4000);
  }

  function stopChatPolling() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
  }

  async function loadMailList() {
    syncWorkspaceIdFromDom();
    if (!workspaceId || mailBox === 'compose') return;
    const list = document.getElementById('mail-list');
    if (!list) return;
    const box = mailBox === 'sent' ? 'sent' : 'inbox';
    try {
      const data = await api(`api/workspaces/${workspaceId}/mail/?box=${box}`);
      list.innerHTML = '';
      const badge = document.getElementById('mail-unread-badge');
      if (badge) {
        if (data.unread_count > 0) {
          badge.textContent = data.unread_count;
          badge.classList.remove('d-none');
        } else {
          badge.classList.add('d-none');
        }
      }
      if (!data.messages.length) {
        list.innerHTML = '<p class="small text-muted">No messages.</p>';
        return;
      }
      data.messages.forEach(m => {
        const item = document.createElement('div');
        item.className = 'mail-item' + (m.read === false && box === 'inbox' ? ' unread' : '');
        item.innerHTML = `<strong>${escapeHtml(m.subject)}</strong><br><span class="small text-muted">${escapeHtml(m.sender)} · ${new Date(m.created_at).toLocaleString()}</span>`;
        item.addEventListener('click', () => openMailRead(m));
        list.appendChild(item);
      });
    } catch (e) {
      list.innerHTML = `<p class="small text-danger">${escapeHtml(e.message)}</p>`;
    }
  }

  function showMailView(view) {
    document.getElementById('mail-list-view')?.classList.toggle('d-none', view !== 'list');
    document.getElementById('mail-read-view')?.classList.toggle('d-none', view !== 'read');
    document.getElementById('mail-compose-view')?.classList.toggle('d-none', view !== 'compose');
  }

  async function openMailRead(m) {
    showMailView('read');
    document.getElementById('mail-read-subject').textContent = m.subject;
    document.getElementById('mail-read-meta').textContent = `${m.sender} · ${new Date(m.created_at).toLocaleString()}`;
    document.getElementById('mail-read-body').textContent = m.body;
    if (mailBox === 'inbox' && !m.read) {
      try {
        await api(`api/workspaces/${workspaceId}/mail/${m.id}/read/`, 'POST', {});
        loadMailList();
      } catch (_) { /* ignore */ }
    }
  }

  function initChatAndMail() {
    document.querySelectorAll('[data-comm-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-comm-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.commTab;
        document.getElementById('comm-chat-pane')?.classList.toggle('d-none', tab !== 'chat');
        document.getElementById('comm-mail-pane')?.classList.toggle('d-none', tab !== 'mail');
        if (tab === 'chat') startChatPolling();
        else stopChatPolling();
        if (tab === 'mail') loadMailList();
      });
    });

    document.querySelectorAll('[data-mail-box]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mail-box]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mailBox = btn.dataset.mailBox;
        if (mailBox === 'compose') showMailView('compose');
        else { showMailView('list'); loadMailList(); }
      });
    });

    document.getElementById('mail-back-btn')?.addEventListener('click', () => {
      showMailView('list');
      loadMailList();
    });

    document.getElementById('chat-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const body = input?.value.trim();
      if (!body) return;
      syncWorkspaceIdFromDom();
      try {
        await api(`api/workspaces/${workspaceId}/chat/send/`, 'POST', { body });
        input.value = '';
        await loadChat(false);
      } catch (err) {
        showToast(err.message || 'Could not send message.', 'danger');
      }
    });

    document.getElementById('mail-send-btn')?.addEventListener('click', async () => {
      syncWorkspaceIdFromDom();
      const subject = document.getElementById('mail-compose-subject')?.value.trim();
      const body = document.getElementById('mail-compose-body')?.value.trim();
      const sel = document.getElementById('mail-compose-recipients');
      const recipient_ids = sel ? [...sel.selectedOptions].map(o => parseInt(o.value, 10)) : [];
      if (!subject || !body) {
        showToast('Subject and body required.', 'danger');
        return;
      }
      try {
        await api(`api/workspaces/${workspaceId}/mail/send/`, 'POST', { subject, body, recipient_ids });
        showToast('Mail sent.', 'success');
        document.getElementById('mail-compose-subject').value = '';
        document.getElementById('mail-compose-body').value = '';
        mailBox = 'sent';
        document.querySelectorAll('[data-mail-box]').forEach(b => {
          b.classList.toggle('active', b.dataset.mailBox === 'sent');
        });
        showMailView('list');
        loadMailList();
      } catch (err) {
        showToast(err.message || 'Could not send mail.', 'danger');
      }
    });

    document.getElementById('invite-email-btn')?.addEventListener('click', async () => {
      syncWorkspaceIdFromDom();
      const email = document.getElementById('invite-email-input')?.value.trim();
      const role = document.getElementById('invite-email-role')?.value || 'read';
      if (!email) {
        showToast('Enter an email address.', 'danger');
        return;
      }
      try {
        const result = await api(`api/workspaces/${workspaceId}/invite-email/`, 'POST', { email, role });
        showToast(result.message || 'Invitation sent.', 'success');
        document.getElementById('invite-email-input').value = '';
        if (result.added_existing_user) {
          document.getElementById('workspace-select')?.dispatchEvent(new Event('change'));
        }
      } catch (err) {
        showToast(err.message || 'Invite failed.', 'danger');
      }
    });

    const wsSelect = document.getElementById('workspace-select');
    if (wsSelect) {
      wsSelect.addEventListener('change', () => {
        lastChatId = 0;
        if (document.querySelector('[data-comm-tab].active')?.dataset.commTab === 'chat') {
          startChatPolling();
        }
        if (document.querySelector('[data-comm-tab].active')?.dataset.commTab === 'mail') {
          loadMailList();
        }
      });
    }

    startChatPolling();
  }

})()
