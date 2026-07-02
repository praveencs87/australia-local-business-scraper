import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://www.truelocal.com.au/search/plumber/sydney-nsw');
  const html = await page.content();
  console.log(html.substring(0, 1000));
  await browser.close();
})();
