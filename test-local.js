import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.local.com.au/');
  
  await page.fill('input[placeholder*="What"]', 'plumber').catch(() => {});
  await page.fill('input[placeholder*="Where"]', 'Sydney').catch(() => {});
  
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"], input[type="submit"]')
    ]);
    console.log('Redirected to:', page.url());
  } catch (e) {
    console.log('Could not submit form:', e.message);
  }
  
  const html = await page.content();
  require('fs').writeFileSync('local-search.html', html);
  await page.screenshot({ path: 'local-search.png' });
  
  await browser.close();
})();
