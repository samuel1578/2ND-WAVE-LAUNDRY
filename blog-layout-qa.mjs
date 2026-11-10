export default async function run(page) {
  const targets = [1440, 1280, 1024, 900, 390];
  const results = [];
  await page.addInitScript(() => sessionStorage.setItem("wave-demo-session", "active"));
  for (const width of targets) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3000/admin/content/blog/new", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Create Blog Article" }).waitFor({ state: "visible", timeout: 20000 });
    await page.screenshot({ path: `C:/Games/2ND WAVE/blog-editor-layout-${width}.png`, fullPage: true });
    results.push(await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
        return { left: Math.round(left), right: Math.round(right), top: Math.round(top), bottom: Math.round(bottom), width: Math.round(width), height: Math.round(height) };
      };
      const layout = rect('[class*="editorLayout"]');
      const card = rect('[class*="articleCard"]');
      const side = rect('[aria-label="Article settings"]');
      const body = rect('[aria-label="Article body"]');
      const toolbar = rect('[role="toolbar"]');
      const overlap = card && side && Math.min(card.right, side.right) > Math.max(card.left, side.left);
      return { viewport: innerWidth, theme: document.documentElement.getAttribute('data-theme'), layout, card, sidebar: side, toolbar, editable: body, overlap, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    }));
  }
  return results;
}
