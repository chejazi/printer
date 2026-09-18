(function previewApp() {
  const $ = (selector) => document.querySelector(selector);
  const editor = $("#editor");
  const receipt = $("#receipt-text");
  const output = $("#generator-output");
  const style = $("#style");
  const dialog = $("#block-dialog");
  const builtInPresets = ReceiptPresets.presets;
  let customPresets = loadCustomPresets();
  let selectedPresetId = builtInPresets[0]?.id;
  const stored = localStorage.getItem("receipt-simulator-text");
  editor.value = stored === null ? ExampleReceipt.text : stored;
  let sequenceContext;
  let receiptPrintConfigured = false;
  let receiptPrintPending = false;
  let receiptPrintConfig = {};
  let receiptPrintWaitTimer;

  function titleCase(value) {
    return value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  }

  ReceiptGenerators.generators.forEach((generator) => {
    const option = document.createElement("option");
    option.value = generator.id;
    option.textContent = generator.label;
    style.append(option);
  });

  BlockLibrary.CATEGORIES.forEach((category) => {
    [$("#block-category"), $("#block-form-category")].forEach((select) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = titleCase(category);
      select.append(option);
    });
  });

  function currentText() {
    return ReceiptFormat.normalizeLineEndings(editor.value);
  }

  function receiptPreview() {
    const template = currentText();
    const dynamic = Boolean(sequenceContext && template.includes(sequenceContext.token()));
    const text = dynamic ? sequenceContext.resolve(template) : template;
    return {
      dynamic,
      template,
      text,
      sequence: dynamic ? sequenceContext.id : undefined,
      frame: dynamic ? sequenceContext.currentFrame() : undefined,
      nextFrame: dynamic ? sequenceContext.nextFrame() : undefined,
    };
  }

  function setReceiptPrintState(state, message, warning = false) {
    const status = $("#receipt-print-status");
    status.textContent = `${state.toUpperCase()}: ${message}`;
    status.classList.toggle("warning", warning);
  }

  function updateReceiptPrintButton() {
    $("#receipt-print-preview").disabled = receiptPrintPending || !receiptPrintConfigured;
  }

  function registerSequenceContext(context) {
    sequenceContext = context;
    render();
  }

  function updateCursor() {
    const cursor = ReceiptFormat.getCursorLocation(editor.value, editor.selectionStart);
    $("#cursor-status").textContent = `Ln ${cursor.line}, Col ${cursor.column} · line width ${cursor.lineWidth}`;
  }

  function focusLine(lineNumber) {
    const lines = editor.value.split(/\r?\n/);
    const start = lines.slice(0, lineNumber - 1).reduce((total, line) => total + line.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + (lines[lineNumber - 1]?.length || 0));
    updateCursor();
  }

  function renderOverflow(result) {
    const first = result.warnings[0];
    const widthStatus = $("#width-status");
    widthStatus.textContent = first ? `OVERFLOW · LINE ${first.line} · ${first.width} COL` : `${result.maxWidth} COL · OK`;
    widthStatus.classList.toggle("is-overflow", Boolean(first));
    $("#overflow-panel").hidden = result.valid;
    const list = $("#overflow-list");
    list.replaceChildren();
    result.warnings.forEach((warning) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Line ${warning.line} · ${warning.width} columns · +${warning.excess}`;
      button.addEventListener("click", () => focusLine(warning.line));
      list.append(button);
    });
  }

  function render() {
    const preview = receiptPreview();
    const result = ReceiptFormat.validateReceipt(preview.text);
    receipt.textContent = result.text;
    $("#line-status").textContent = `${result.lineCount} line${result.lineCount === 1 ? "" : "s"}`;
    $("#validation-status").textContent = result.valid
      ? "Receipt width is valid"
      : `${result.warnings.length} overflowing line${result.warnings.length === 1 ? "" : "s"}`;
    $("#validation-status").classList.toggle("warning", !result.valid);
    receipt.classList.toggle("has-overflow", !result.valid);
    $("#editor").classList.toggle("has-overflow", !result.valid);
    renderOverflow(result);
    localStorage.setItem("receipt-simulator-text", currentText());
    updateCursor();
  }

  async function loadReceiptPrintConfig() {
    try {
      const response = await fetch("/api/print-config");
      receiptPrintConfig = await response.json();
      receiptPrintConfigured = Boolean(receiptPrintConfig.configured);
      if (receiptPrintConfigured) {
        setReceiptPrintState("ready", `Proxy configured${receiptPrintConfig.printer ? ` for ${receiptPrintConfig.printer}` : ""}.`);
      } else {
        setReceiptPrintState("ready", receiptPrintConfig.warning || "Printer proxy is not configured.", true);
      }
    } catch (error) {
      receiptPrintConfigured = false;
      setReceiptPrintState("failed", `Unable to read print proxy configuration: ${error.message}`, true);
    }
    updateReceiptPrintButton();
  }

  function openReceiptPrintConfirmation() {
    if (receiptPrintPending || !receiptPrintConfigured) return;
    const preview = receiptPreview();
    const validation = ReceiptFormat.validateReceipt(preview.text);
    if (!validation.valid) {
      setReceiptPrintState("failed", `Blocked: line ${validation.warnings[0].line} is ${validation.warnings[0].width} columns.`, true);
      return;
    }
    const widths = validation.lines.map((line) => ReceiptFormat.lineWidth(line));
    $("#receipt-print-route").textContent = preview.dynamic ? "/print-sequence" : "/print";
    $("#receipt-print-printer").textContent = receiptPrintConfig.printer || "default";
    $("#receipt-print-lines").textContent = validation.lineCount;
    $("#receipt-print-width").textContent = Math.max(0, ...widths);
    $("#receipt-print-payload").textContent = preview.text;
    $("#receipt-print-frame-row").hidden = !preview.dynamic;
    $("#receipt-print-next-row").hidden = !preview.dynamic;
    $("#receipt-print-advance").disabled = !preview.dynamic;
    $("#receipt-print-advance").checked = true;
    if (preview.dynamic) {
      $("#receipt-print-frame").textContent = preview.frame;
      $("#receipt-print-next").textContent = preview.nextFrame;
    }
    setReceiptPrintState("queued", "Ready for explicit confirmation.");
    $("#receipt-print-dialog").showModal();
  }

  async function sendReceiptPreviewToPrinter() {
    if (receiptPrintPending || !receiptPrintConfigured) return;
    receiptPrintPending = true;
    updateReceiptPrintButton();
    const preview = receiptPreview();
    setReceiptPrintState("queued", "Sending receipt preview to the print proxy.");
    clearTimeout(receiptPrintWaitTimer);
    receiptPrintWaitTimer = setTimeout(() => {
      if (receiptPrintPending) setReceiptPrintState("printing", "Waiting for confirmed physical completion.");
    }, 250);
    try {
      const response = await fetch("/api/print-receipt-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: preview.text,
          template: preview.template,
          sequence: preview.sequence,
          frame: preview.frame,
          advanceOnSuccess: $("#receipt-print-advance").checked,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Print request failed with ${response.status}`);
      if (preview.dynamic && $("#receipt-print-advance").checked && Number.isInteger(body.job?.currentFrame)) {
        sequenceContext.setFrame(body.job.currentFrame);
      }
      setReceiptPrintState("succeeded", `Receipt preview completed via ${body.route}.`);
    } catch (error) {
      const timedOut = /timed out/i.test(error.message);
      setReceiptPrintState(timedOut ? "timed-out" : "failed", error.message, true);
    } finally {
      clearTimeout(receiptPrintWaitTimer);
      receiptPrintPending = false;
      updateReceiptPrintButton();
    }
  }

  function generatorOptions() {
    return {
      seed: $("#seed").value,
      width: Number($("#width").value),
      height: Number($("#height").value),
      complexity: Number($("#complexity").value),
      unicode: $("#unicode").checked,
    };
  }

  function generate() {
    output.textContent = ReceiptGenerators.getGenerator(style.value).generate(generatorOptions());
  }

  function replaceRange(start, end, value) {
    editor.setRangeText(value, start, end, "end");
    editor.focus();
    render();
  }

  function allPresets() {
    return [...builtInPresets, ...customPresets];
  }

  function selectedPreset() {
    return allPresets().find((preset) => preset.id === selectedPresetId);
  }

  function loadCustomPresets() {
    const storedLibrary = localStorage.getItem(BlockLibrary.STORAGE_KEY);
    if (!storedLibrary) return [];
    try { return BlockLibrary.parseLibraryImport(storedLibrary); }
    catch (error) {
      setTimeout(() => { $("#library-status").textContent = `Saved library could not be loaded: ${error.message}`; });
      return [];
    }
  }

  function saveCustomPresets() {
    localStorage.setItem(BlockLibrary.STORAGE_KEY, BlockLibrary.exportLibrary(customPresets));
  }

  function setLibraryStatus(message, isError = false) {
    const status = $("#library-status");
    status.textContent = message;
    status.classList.toggle("warning", isError);
  }

  function renderBlockDetail() {
    const preset = selectedPreset();
    const controls = [$("#block-insert"), $("#block-replace"), $("#block-edit"), $("#block-duplicate"), $("#block-delete"), $("#block-prefix"), $("#block-suffix")];
    controls.forEach((control) => { control.disabled = !preset; });
    if (!preset) {
      $("#block-name").textContent = "Select a block";
      $("#block-badge").textContent = "";
      $("#block-description").textContent = "";
      $("#block-preview").textContent = "";
      return;
    }
    $("#block-name").textContent = preset.name;
    $("#block-badge").textContent = `${preset.builtIn ? "BUILT-IN" : "CUSTOM"} · ${preset.width} COL`;
    $("#block-description").textContent = preset.description || titleCase(preset.category);
    $("#block-preview").textContent = preset.content;
    const warning = $("#block-warning");
    warning.hidden = preset.warnings.length === 0;
    warning.textContent = preset.warnings.length
      ? `Width warning: ${preset.warnings.map((item) => `line ${item.line} is ${item.width} columns`).join(", ")}.`
      : "";
    $("#block-edit").disabled = preset.builtIn;
    $("#block-delete").disabled = preset.builtIn;
  }

  function renderLibrary() {
    const query = $("#block-search").value.trim().toLowerCase();
    const category = $("#block-category").value;
    const matches = allPresets().filter((preset) => {
      const searchable = `${preset.name} ${preset.description}`.toLowerCase();
      return (!query || searchable.includes(query)) && (!category || preset.category === category);
    });
    if (!matches.some((preset) => preset.id === selectedPresetId)) selectedPresetId = matches[0]?.id;
    const list = $("#block-list");
    list.replaceChildren();
    matches.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "block-list-item";
      button.classList.toggle("is-selected", preset.id === selectedPresetId);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(preset.id === selectedPresetId));
      button.innerHTML = `<strong></strong><span></span>`;
      button.querySelector("strong").textContent = preset.name;
      button.querySelector("span").textContent = `${titleCase(preset.category)} · ${preset.builtIn ? "Built-in" : "Custom"}`;
      button.addEventListener("click", () => { selectedPresetId = preset.id; renderLibrary(); });
      list.append(button);
    });
    renderBlockDetail();
  }

  function insertPreset(replaceSelection) {
    const preset = selectedPreset();
    if (!preset) return;
    const end = replaceSelection ? editor.selectionEnd : editor.selectionStart;
    const result = BlockLibrary.insertWithBoundaries(editor.value, editor.selectionStart, end, preset.content);
    editor.value = result.text;
    editor.setSelectionRange(result.selectionStart, result.selectionStart);
    editor.focus();
    render();
  }

  function openBlockDialog({ preset, content, duplicate = false }) {
    $("#block-id").value = preset && !duplicate ? preset.id : "";
    $("#block-form-name").value = preset ? `${preset.name}${duplicate ? " Copy" : ""}` : "";
    $("#block-form-category").value = preset?.category || "headers";
    $("#block-form-description").value = preset?.description || "";
    $("#block-form-content").value = content ?? preset?.content ?? "";
    $("#block-dialog-title").textContent = preset && !duplicate ? "Edit custom block" : "Save custom block";
    updateBlockFormWarning();
    dialog.showModal();
  }

  function updateBlockFormWarning() {
    const warnings = ReceiptFormat.validateReceipt($("#block-form-content").value).warnings;
    const warning = $("#block-form-warning");
    warning.hidden = warnings.length === 0;
    warning.textContent = warnings.length ? warnings.map((item) => `Line ${item.line}: ${item.width} columns`).join(" · ") : "";
  }

  editor.addEventListener("input", render);
  ["click", "keyup", "select"].forEach((event) => editor.addEventListener(event, updateCursor));
  [style, $("#seed"), $("#width"), $("#height"), $("#complexity"), $("#unicode")]
    .forEach((control) => control.addEventListener("input", generate));
  $("#regenerate").addEventListener("click", generate);
  $("#randomize").addEventListener("click", () => {
    $("#seed").value = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
    generate();
  });
  $("#insert").addEventListener("click", () => replaceRange(editor.selectionStart, editor.selectionStart, output.textContent));
  $("#replace").addEventListener("click", () => replaceRange(editor.selectionStart, editor.selectionEnd, output.textContent));
  $("#reset").addEventListener("click", () => { editor.value = ExampleReceipt.text; render(); });
  $("#copy").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(currentText());
    event.currentTarget.textContent = "Copied";
    setTimeout(() => { event.currentTarget.textContent = "Copy text"; }, 1200);
  });
  $("#download").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([currentText()], { type: "text/plain;charset=utf-8" }));
    link.download = "receipt.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $("#print").addEventListener("click", () => window.print());
  $("#receipt-print-preview").addEventListener("click", openReceiptPrintConfirmation);
  $("#receipt-print-confirm-cancel").addEventListener("click", () => {
    $("#receipt-print-dialog").close();
    if (!receiptPrintPending) setReceiptPrintState("ready", "Print cancelled before sending.");
  });
  $("#receipt-print-form").addEventListener("submit", (event) => {
    event.preventDefault();
    $("#receipt-print-dialog").close();
    sendReceiptPreviewToPrinter();
  });

  [$("#block-search"), $("#block-category")].forEach((control) => control.addEventListener("input", renderLibrary));
  $("#block-insert").addEventListener("click", () => insertPreset(false));
  $("#block-replace").addEventListener("click", () => insertPreset(true));
  $("#block-edit").addEventListener("click", () => openBlockDialog({ preset: selectedPreset() }));
  $("#block-duplicate").addEventListener("click", () => openBlockDialog({ preset: selectedPreset(), duplicate: true }));
  $("#block-delete").addEventListener("click", () => {
    const preset = selectedPreset();
    if (!preset || preset.builtIn || !confirm(`Delete custom block “${preset.name}”?`)) return;
    customPresets = BlockLibrary.deleteCustomPreset(customPresets, preset.id);
    selectedPresetId = builtInPresets[0]?.id;
    saveCustomPresets();
    renderLibrary();
    setLibraryStatus(`Deleted ${preset.name}.`);
  });
  function appendPresetTo(targetSelector) {
    const preset = selectedPreset();
    if (!preset) return;
    const target = $(targetSelector);
    target.value = BlockLibrary.insertWithBoundaries(target.value, target.value.length, target.value.length, preset.content).text;
    target.dispatchEvent(new Event("input"));
  }
  $("#block-prefix").addEventListener("click", () => appendPresetTo("#sequence-prefix"));
  $("#block-suffix").addEventListener("click", () => appendPresetTo("#sequence-suffix"));
  $("#save-as-block").addEventListener("click", () => {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (!selected && !confirm("No text is selected. Save the entire receipt as a block?")) return;
    openBlockDialog({ content: selected || editor.value });
  });
  $("#block-form-content").addEventListener("input", updateBlockFormWarning);
  $("#block-dialog-cancel").addEventListener("click", () => dialog.close());
  $("#block-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const existingId = $("#block-id").value;
      const id = existingId || BlockLibrary.createId($("#block-form-name").value, allPresets().map((preset) => preset.id));
      const preset = BlockLibrary.normalizePreset({
        id, name: $("#block-form-name").value, category: $("#block-form-category").value,
        description: $("#block-form-description").value, content: $("#block-form-content").value,
      }, { builtIn: false });
      customPresets = BlockLibrary.upsertCustomPreset(customPresets, preset);
      selectedPresetId = preset.id;
      saveCustomPresets();
      dialog.close();
      renderLibrary();
      setLibraryStatus(`Saved ${preset.name} locally.`);
    } catch (error) { setLibraryStatus(error.message, true); }
  });
  $("#export-library").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([BlockLibrary.exportLibrary(customPresets)], { type: "application/json" }));
    link.download = "receipt-block-library.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setLibraryStatus(`Exported ${customPresets.length} custom block${customPresets.length === 1 ? "" : "s"}.`);
  });
  $("#import-library").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = BlockLibrary.parseLibraryImport(await file.text());
      const builtInIds = new Set(builtInPresets.map((preset) => preset.id));
      const conflict = imported.find((preset) => builtInIds.has(preset.id));
      if (conflict) throw new Error(`Custom preset ID conflicts with built-in preset: ${conflict.id}.`);
      customPresets = imported;
      selectedPresetId = customPresets[0]?.id || builtInPresets[0]?.id;
      saveCustomPresets();
      renderLibrary();
      setLibraryStatus(`Imported ${customPresets.length} custom block${customPresets.length === 1 ? "" : "s"}.`);
    } catch (error) { setLibraryStatus(`Import rejected: ${error.message}`, true); }
    event.target.value = "";
  });

  generate();
  render();
  renderLibrary();
  loadReceiptPrintConfig();
  globalThis.ReceiptPreviewApp = {
    currentText,
    receiptPreview,
    registerSequenceContext,
    render,
    replaceRange,
    selectedPreset,
  };
}());
