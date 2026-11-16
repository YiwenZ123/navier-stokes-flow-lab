(() => {
  const frame = document.querySelector("iframe.explicit-presets-frame");
  if (!frame) return;
  window.addEventListener("message", event => {
    // The frame has an opaque sandbox origin; verify its Window identity.
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== "cfd-explicit-height" || typeof data.height !== "number"
      || !Number.isFinite(data.height) || data.height < 120 || data.height > 10064) return;
    const height = `${Math.ceil(data.height)}px`;
    if (frame.style.height !== height) frame.style.height = height;
  });
})();
