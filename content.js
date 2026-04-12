const TEXT_LIMIT = 4000;

if (window.top === window && /^https?:/i.test(window.location.href)) {
  window.addEventListener(
    "load",
    () => {
      queueMicrotask(() => {
        chrome.runtime.sendMessage({
          type: "pageContentScan",
          page: collectPageSignals()
        });
      });
    },
    { once: true }
  );
}

function collectPageSignals() {
  const metaDescription =
    document.querySelector('meta[name="description"]')?.content?.trim() ?? "";
  const metaKeywords =
    document.querySelector('meta[name="keywords"]')?.content?.trim() ?? "";
  const heading = document.querySelector("h1")?.textContent?.trim() ?? "";
  const bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();

  return {
    url: window.location.href,
    title: document.title ?? "",
    metaDescription,
    metaKeywords,
    heading,
    textSample: bodyText.slice(0, TEXT_LIMIT)
  };
}
