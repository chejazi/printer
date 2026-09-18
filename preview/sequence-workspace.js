(function sequenceWorkspace() {
  const $ = (selector) => document.querySelector(selector);
  const builtIn = HigherZipHorseSequence;
  let sequence = builtIn;
  let cursor = SequenceCore.createSequenceCursor(sequence.frames.length, loadCursor(sequence.manifest.id));
  let playTimer;
  let importedSourceUrls = [];
  let cancellation = { cancelled: false };
  let printPending = false;
  let printConfigured = false;
  let printWaitTimer;

  function cursorKey(id) { return `receipt-sequence-cursor:${id}`; }
  function loadCursor(id) {
    const value = Number(localStorage.getItem(cursorKey(id)));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }
  function saveCursor() { localStorage.setItem(cursorKey(sequence.manifest.id), String(cursor.currentFrame())); }
  function frameText(index = cursor.currentFrame()) { return sequence.frames[index]; }
  function decorated(value, index) {
    return String(value).replaceAll("{{frame}}", String(index + 1)).replaceAll("{{frameCount}}", String(sequence.frames.length));
  }
  function template() {
    return SequenceCore.composeTemplate($("#sequence-prefix").value, sequence.manifest.id, $("#sequence-suffix").value);
  }
  function resolved(index = cursor.currentFrame()) {
    return SequenceCore.resolveTemplate(decorated(template(), index), sequence, index);
  }
  function setStatus(message, warning = false) {
    $("#sequence-status").textContent = message;
    $("#sequence-status").classList.toggle("warning", warning);
  }
  function setPrintState(state, message, warning = false) {
    $("#sequence-print-status").textContent = `${state.toUpperCase()}: ${message}`;
    $("#sequence-print-status").classList.toggle("warning", warning);
  }
  function updatePrintButton() {
    $("#sequence-print-current").disabled = printPending || !printConfigured;
  }
  function validateComposition() {
    const invalid = [];
    for (let index = 0; index < sequence.frames.length; index += 1) {
      const result = ReceiptFormat.validateReceipt(resolved(index));
      if (!result.valid) invalid.push({ frame: index + 1, warnings: result.warnings });
    }
    $("#sequence-validation").textContent = invalid.length ? `${invalid.length} invalid frames` : "All composed frames valid";
    $("#sequence-validation").classList.toggle("warning", invalid.length > 0);
  }
  function renderStrip() {
    const strip = $("#sequence-strip");
    strip.replaceChildren();
    const current = cursor.currentFrame();
    const first = Math.max(0, Math.min(sequence.frames.length - 7, current - 3));
    for (let index = first; index < Math.min(sequence.frames.length, first + 7); index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(index + 1);
      button.classList.toggle("is-current", index === current);
      button.addEventListener("click", () => setFrame(index));
      strip.append(button);
    }
  }
  function render() {
    const index = cursor.currentFrame();
    $("#sequence-frame").textContent = index + 1;
    $("#sequence-count").textContent = sequence.frames.length;
    $("#sequence-next").textContent = cursor.nextFrame() + 1;
    $("#sequence-output-size").textContent = `${sequence.manifest.width}×${sequence.manifest.height}`;
    $("#sequence-source-size").textContent = (sequence.manifest.source?.originalDimensions || ["local", "local"]).join("×");
    $("#sequence-ascii-preview").textContent = frameText();
    $("#sequence-resolved").textContent = resolved();
    $("#sequence-timeline").max = sequence.frames.length;
    $("#sequence-timeline").value = index + 1;
    $("#sequence-set-frame").max = sequence.frames.length;
    $("#sequence-set-frame").value = index + 1;
    renderStrip();
    saveCursor();
    ReceiptPreviewApp.render();
  }
  function setFrame(index) { cursor.setFrame(index); render(); }
  function stopPlayback() {
    if (playTimer) clearInterval(playTimer);
    playTimer = undefined;
    $("#sequence-play").textContent = "Play";
  }
  function startPlayback() {
    stopPlayback();
    $("#sequence-play").textContent = "Pause";
    playTimer = setInterval(() => {
      if (!$("#sequence-loop").checked && cursor.currentFrame() === sequence.frames.length - 1) { stopPlayback(); return; }
      cursor.advance();
      render();
    }, 1000 / Math.max(1, Number($("#sequence-fps").value) || 8));
  }
  function download(name, content, type = "text/plain") {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  function selectSequence(next) {
    stopPlayback();
    sequence = SequenceCore.validateSequence(next);
    cursor = SequenceCore.createSequenceCursor(sequence.frames.length, loadCursor(sequence.manifest.id));
    $("#sequence-fps").value = sequence.manifest.fps || 12;
    render();
    validateComposition();
  }
  async function loadPrintConfig() {
    try {
      const response = await fetch("/api/print-config");
      const config = await response.json();
      printConfigured = Boolean(config.configured);
      if (printConfigured) {
        setPrintState("ready", `Proxy configured${config.printer ? ` for ${config.printer}` : ""}.`);
      } else {
        setPrintState("ready", config.warning || "Printer proxy is not configured.", true);
      }
    } catch (error) {
      printConfigured = false;
      setPrintState("failed", `Unable to read print proxy configuration: ${error.message}`, true);
    }
    updatePrintButton();
  }
  function openPrintConfirmation() {
    if (printPending || !printConfigured) return;
    const index = cursor.currentFrame();
    $("#sequence-print-confirm-frame").textContent = index + 1;
    $("#sequence-print-confirm-next").textContent = cursor.nextFrame() + 1;
    $("#sequence-print-confirm-copy").textContent = `Send frame ${index + 1} to the configured physical printer? The browser preview will not advance until the server confirms physical completion.`;
    setPrintState("confirming", `Frame ${index + 1}; next frame ${cursor.nextFrame() + 1}.`);
    $("#sequence-print-dialog").showModal();
  }
  async function sendCurrentFrameToPrinter() {
    if (printPending || !printConfigured) return;
    printPending = true;
    updatePrintButton();
    const index = cursor.currentFrame();
    const advanceOnSuccess = $("#sequence-print-advance").checked;
    setPrintState("queued", `Sending frame ${index + 1}; next frame ${cursor.nextFrame() + 1}.`);
    clearTimeout(printWaitTimer);
    printWaitTimer = setTimeout(() => {
      if (printPending) setPrintState("printing/waiting", "Waiting for confirmed physical completion.");
    }, 250);
    try {
      const response = await fetch("/api/print-current-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: decorated(template(), index),
          sequence: sequence.manifest.id,
          frame: index + 1,
          advanceOnSuccess,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Print request failed with ${response.status}`);
      if (advanceOnSuccess && Number.isInteger(body.job?.currentFrame)) {
        cursor.setFrame(body.job.currentFrame - 1);
        render();
      }
      setPrintState("succeeded", `Frame ${index + 1} completed. Current frame is ${cursor.currentFrame() + 1}.`);
    } catch (error) {
      setPrintState("failed", error.message, true);
    } finally {
      clearTimeout(printWaitTimer);
      printPending = false;
      updatePrintButton();
    }
  }

  $("#sequence-first").addEventListener("click", () => setFrame(0));
  $("#sequence-previous").addEventListener("click", () => setFrame(cursor.currentFrame() - 1));
  $("#sequence-next-button").addEventListener("click", () => setFrame(cursor.currentFrame() + 1));
  $("#sequence-last").addEventListener("click", () => setFrame(sequence.frames.length - 1));
  $("#sequence-reset").addEventListener("click", () => { cursor.reset(); render(); });
  $("#sequence-advance").addEventListener("click", () => { cursor.advance(); render(); });
  $("#sequence-random").addEventListener("click", () => setFrame(Math.floor(Math.random() * sequence.frames.length)));
  $("#sequence-set-frame").addEventListener("change", (event) => setFrame(Number(event.target.value) - 1));
  $("#sequence-timeline").addEventListener("input", (event) => setFrame(Number(event.target.value) - 1));
  $("#sequence-play").addEventListener("click", () => playTimer ? stopPlayback() : startPlayback());
  $("#sequence-fps").addEventListener("change", () => { sequence.manifest.fps = Math.max(1, Number($("#sequence-fps").value) || 8); if (playTimer) startPlayback(); });
  [$("#sequence-prefix"), $("#sequence-suffix")].forEach((input) => input.addEventListener("input", () => { render(); validateComposition(); }));
  $("#sequence-insert-token").addEventListener("click", () => {
    const editor = $("#editor");
    ReceiptPreviewApp.replaceRange(editor.selectionStart, editor.selectionStart, SequenceCore.sequenceToken(sequence.manifest.id));
  });
  $("#sequence-copy").addEventListener("click", () => navigator.clipboard.writeText(frameText()));
  $("#sequence-download").addEventListener("click", () => download(`receipt-frame-${cursor.currentFrame() + 1}.txt`, frameText()));
  $("#sequence-export").addEventListener("click", () => download(`${sequence.manifest.id}.json`, SequenceCore.exportSequence(sequence), "application/json"));
  $("#sequence-import-json").addEventListener("click", () => $("#sequence-json-file").click());
  $("#sequence-json-file").addEventListener("change", async (event) => {
    try { selectSequence(SequenceCore.importSequence(await event.target.files[0].text())); setStatus("Sequence imported locally."); }
    catch (error) { setStatus(error.message, true); }
    event.target.value = "";
  });
  $("#sequence-print-current").addEventListener("click", openPrintConfirmation);
  $("#sequence-print-confirm-cancel").addEventListener("click", () => {
    $("#sequence-print-dialog").close();
    if (!printPending) setPrintState("ready", "Print cancelled before sending.");
  });
  $("#sequence-print-form").addEventListener("submit", (event) => {
    event.preventDefault();
    $("#sequence-print-dialog").close();
    sendCurrentFrameToPrinter();
  });

  SequencePalettes.presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    $("#convert-palette-preset").append(option);
  });
  $("#convert-palette-preset").addEventListener("change", (event) => {
    const preset = SequencePalettes.getPalette(event.target.value);
    $("#convert-palette").value = preset.value;
    setStatus(preset.warning || "");
  });
  function selectedImageFiles() {
    return [...$("#sequence-image-files").files, ...$("#sequence-image-directory").files];
  }
  function previewSelectedSource() {
    importedSourceUrls.forEach(URL.revokeObjectURL);
    importedSourceUrls = selectedImageFiles().slice(0, 1).map(URL.createObjectURL);
    if (importedSourceUrls[0]) {
      $("#sequence-source-preview").src = importedSourceUrls[0];
      $("#sequence-source-preview").hidden = false;
      $("#sequence-source-empty").hidden = true;
    }
  }
  $("#sequence-image-files").addEventListener("change", previewSelectedSource);
  $("#sequence-image-directory").addEventListener("change", previewSelectedSource);
  $("#convert-cancel").addEventListener("click", () => { cancellation.cancelled = true; });
  $("#convert-start").addEventListener("click", async () => {
    const files = selectedImageFiles();
    cancellation = { cancelled: false };
    $("#convert-start").disabled = true;
    $("#convert-cancel").disabled = false;
    const numberOr = (selector, fallback) => $(selector).value === "" ? fallback : Number($(selector).value);
    try {
      const firstBitmap = files[0] ? await createImageBitmap(files[0]) : null;
      if (!firstBitmap) throw new Error("Choose image files first.");
      const sourceDimensions = [firstBitmap.width, firstBitmap.height];
      firstBitmap.close();
      const options = {
        width: numberOr("#convert-width", 48), characterAspectCorrection: numberOr("#convert-aspect", 0.5),
        palette: $("#convert-palette").value, invert: $("#convert-invert").checked,
        normalization: $("#convert-normalization").value, brightness: numberOr("#convert-brightness", 0), contrast: numberOr("#convert-contrast", 1),
        threshold: $("#convert-threshold").value === "" ? null : Number($("#convert-threshold").value),
        backgroundCharacter: $("#convert-background").value || " ", horizontalPadding: numberOr("#convert-pad-x", 0), verticalPadding: numberOr("#convert-pad-y", 0), alignment: $("#convert-alignment").value,
        crop: { left: numberOr("#convert-crop-left", 0), top: numberOr("#convert-crop-top", 0), right: numberOr("#convert-crop-right", sourceDimensions[0]), bottom: numberOr("#convert-crop-bottom", sourceDimensions[1]) },
      };
      const result = await ImageSequenceConverter.convertFiles(files, options, cancellation, ({ completed, total, phase }) => {
        $("#convert-progress").max = total; $("#convert-progress").value = completed; $("#convert-status").textContent = `${phase}: ${completed}/${total}`;
      });
      selectSequence({ manifest: {
        id: `local-sequence-${Date.now()}`, name: "Local image sequence", description: "Converted locally in the browser.", fps: numberOr("#convert-fps", 12), frameCount: result.frames.length,
        width: result.width, height: result.height, loop: true, palette: options.palette,
        source: { type: "local-images", originalDimensions: sourceDimensions, crop: options.crop, characterAspectCorrection: options.characterAspectCorrection, normalization: options.normalization, filenames: result.sourceFiles },
      }, frames: result.frames });
      setStatus(`Converted ${result.frames.length} local frames. Source images were not stored.`);
    } catch (error) { setStatus(error.message, true); }
    finally { $("#convert-start").disabled = false; $("#convert-cancel").disabled = true; }
  });

  $("#sequence-fps").value = sequence.manifest.fps;
  ReceiptPreviewApp.registerSequenceContext({
    id: sequence.manifest.id,
    token: () => SequenceCore.sequenceToken(sequence.manifest.id),
    currentFrame: () => cursor.currentFrame() + 1,
    nextFrame: () => cursor.nextFrame() + 1,
    resolve: (source) => SequenceCore.resolveTemplate(decorated(source, cursor.currentFrame()), sequence, cursor.currentFrame()),
    setFrame: (frameNumber) => setFrame(frameNumber - 1),
  });
  render();
  validateComposition();
  loadPrintConfig();
}());
