import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import fs from 'fs';

const crawler = new PlaywrightCrawler({
    proxyConfiguration: new ProxyConfiguration({ proxyUrls: ['http://auto:oCulwYNZWImc3gkSc@proxy.apify.com:8000'] }),
    maxConcurrency: 1,
    browserPoolOptions: { useFingerprints: true },
    async requestHandler({ page, request }) {
        console.log(`Processing ${request.url}`);
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'truelocal.png' });
        const html = await page.content();
        fs.writeFileSync('truelocal.html', html);
        console.log('Saved screenshot and html');
    },
});

crawler.run(['https://www.truelocal.com.au/search/plumber/sydney-nsw']).then(() => console.log('Done'));
