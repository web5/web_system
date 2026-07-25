import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 访问变变页
  await page.goto('http://localhost:5173/bianbian', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const createPage = document.querySelector('.create-page');
    const canvasArea = document.querySelector('.canvas-area');
    const topBar = document.querySelector('.top-bar');
    const body = document.body;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      createPage: createPage ? {
        width: createPage.offsetWidth,
        height: createPage.offsetHeight,
        maxWidth: getComputedStyle(createPage).maxWidth,
        padding: getComputedStyle(createPage).padding,
      } : null,
      canvasArea: canvasArea ? {
        width: canvasArea.offsetWidth,
        height: canvasArea.offsetHeight,
        maxWidth: getComputedStyle(canvasArea).maxWidth,
      } : null,
      topBar: topBar ? {
        width: topBar.offsetWidth,
      } : null,
      bodyBg: getComputedStyle(body).backgroundColor,
    };
  });

  console.log('=== /bianbian (PC 1440x900) ===');
  console.log(JSON.stringify(result, null, 2));

  await page.screenshot({ path: '/tmp/bianbian-pc.png', fullPage: false });

  await browser.close();
})();
