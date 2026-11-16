const navigation = document.querySelector("[data-section-tabs]");

if (navigation) {
  const links = Array.from(navigation.querySelectorAll('a[href^="#"]'));
  const panels = links.map(link => document.querySelector(link.hash));
  const initialIndex = links.findIndex(link => link.hash === location.hash);
  let selectedIndex = initialIndex >= 0 ? initialIndex : 0;

  function selectPanel(index, updateHistory = false) {
    selectedIndex = index;
    links.forEach((link, position) => {
      const active = position === index;
      link.setAttribute("aria-selected", String(active));
      link.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
    if (updateHistory) history.pushState(null, "", links[index].hash);
  }

  navigation.setAttribute("role", "tablist");
  links.forEach((link, index) => {
    link.id = "view-tab-" + panels[index].id;
    link.setAttribute("role", "tab");
    link.setAttribute("aria-controls", panels[index].id);
    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", link.id);
    link.addEventListener("click", event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectPanel(index, true);
    });
    link.addEventListener("keydown", event => {
      const last = links.length - 1;
      let nextIndex;
      switch (event.key) {
        case "ArrowRight": nextIndex = (selectedIndex + 1) % links.length; break;
        case "ArrowLeft": nextIndex = (selectedIndex + last) % links.length; break;
        case "Home": nextIndex = 0; break;
        case "End": nextIndex = last; break;
        default: return;
      }
      event.preventDefault();
      selectPanel(nextIndex, true);
      links[nextIndex].focus();
    });
  });
  window.addEventListener("popstate", () => {
    const index = links.findIndex(link => link.hash === location.hash);
    selectPanel(index >= 0 ? index : 0);
  });
  selectPanel(selectedIndex);
}
