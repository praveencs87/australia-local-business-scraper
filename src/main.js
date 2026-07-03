import { armKillSwitch, disarmKillSwitch } from './utils/timeoutManager.js';
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

try {
    const input = await Actor.getInput();
    const { 
        keyword = 'plumber', 
        location = 'Sydney', 
        maxLeads = 100,
        proxyConfiguration 
    } = input || {};

    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration || { 
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'AU'
    });

    log.info(`Searching local.com.au for "${keyword}" in "${location}"`);
    
    await Actor.charge({ eventName: 'apify-actor-start', count: 1 });

    let extractedCount = 0;
    let isSearchSubmitted = false;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency: 2,
        navigationTimeoutSecs: 90,
        browserPoolOptions: {
            useFingerprints: true,
        },
        async requestHandler({ page, request, log, enqueueLinks }) {
            log.info(`Parsing page: ${request.url}`);
            
            const title = await page.title();
            if (title.includes('Just a moment') || title.includes('Access Denied') || title.includes('Attention Required')) {
                throw new Error('Blocked by WAF. Retrying with residential proxy...');
            }

            if (request.url === 'https://www.local.com.au/' && !isSearchSubmitted) {
                log.info('Filling out the search form on local.com.au homepage...');
                // The form uses inputs with class 'search-input'
                await page.waitForSelector('input[name="q"], input[placeholder*="What"]', { timeout: 30000 });
                const whatInputs = await page.$$('input[name="q"], input[placeholder*="What"]');
                if (whatInputs.length > 0) await whatInputs[0].fill(keyword);
                
                const whereInputs = await page.$$('input[name="l"], input[placeholder*="Where"]');
                if (whereInputs.length > 0) await whereInputs[0].fill(location);
                
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                    page.click('button[type="submit"], input[type="submit"], .search-btn, button.btn-primary')
                ]).catch(() => log.warning('Navigation wait timed out, continuing...'));
                
                log.info(`Redirected to search results: ${page.url()}`);
                isSearchSubmitted = true;
            }

            // Results page parsing
            await page.waitForSelector('.business-listing, .listing, .result, .search-result, .card', { timeout: 30000 }).catch(() => log.warning('Timeout waiting for DOM.'));
            
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
            await page.waitForTimeout(2000);

            const items = await page.$$('.business-listing, .listing, .result, .search-result, .card');
            
            for (const item of items) {
                if (extractedCount >= maxLeads) break;

                const nameElement = await item.$('h2, .title, .business-name, .name, a[itemprop="url"]');
                if (!nameElement) continue;
                const businessName = (await nameElement.innerText()).trim();

                const addressElement = await item.$('.address, .location, [itemprop="address"]');
                const address = addressElement ? (await addressElement.innerText()).trim().replace(/\s+/g, ' ') : '';

                // Category
                const catElement = await item.$('.category, .industry, [itemprop="applicationCategory"]');
                const industry = catElement ? (await catElement.innerText()).trim() : keyword;

                // Phones
                const phoneElement = await item.$('a[href^="tel:"], .phone, .contact-number, [itemprop="telephone"], .btn-call');
                let phone = '';
                if (phoneElement) {
                    const href = await phoneElement.getAttribute('href');
                    if (href && href.startsWith('tel:')) {
                        phone = href.replace('tel:', '').trim();
                    } else {
                        phone = (await phoneElement.innerText()).trim();
                    }
                }
                
                // Website
                const websiteElement = await item.$('.website a, a.website-link, .btn-website');
                const website = websiteElement ? await websiteElement.getAttribute('href') : '';
                
                // URL
                const urlElement = await item.$('h2 a, .business-name a, a.title, a[itemprop="url"]');
                const listingUrl = urlElement ? await urlElement.getAttribute('href') : '';
                const fullListingUrl = listingUrl && !listingUrl.startsWith('http') ? new URL(listingUrl, 'https://www.local.com.au').toString() : listingUrl;

                if (businessName && businessName.length > 1) {
                    const record = {
                        businessName,
                        industry,
                        address,
                        phone,
                        website,
                        listingUrl: fullListingUrl || page.url(),
                        scrapedAt: new Date().toISOString()
                    };

                    await Actor.pushData(record);
                    await Actor.charge({ eventName: 'lead-extracted', count: 1 });
                    extractedCount++;
                    log.info(`✅ Extracted: ${businessName} (${extractedCount}/${maxLeads})`);
                }
            }

            // Pagination
            if (extractedCount < maxLeads) {
                const hasNextPage = await page.$('.pagination a.next, a[rel="next"], .next-page, a:has-text("Next")');
                if (hasNextPage) {
                    const nextUrl = await hasNextPage.getAttribute('href');
                    if (nextUrl) {
                        const absoluteUrl = new URL(nextUrl, 'https://www.local.com.au').toString();
                        log.info(`Enqueuing next page: ${absoluteUrl}`);
                        await enqueueLinks({
                            urls: [absoluteUrl],
                        });
                    }
                }
            }
        },
        async failedRequestHandler({ request, log }) {
            log.error(`Failed request: ${request.url}`);
        }
    });

    await crawler.addRequests([{
        url: 'https://www.local.com.au/'
    }]);

    armKillSwitch(crawler);
    await crawler.run();
    disarmKillSwitch();

    log.info(`🎉 Done! Extracted ${extractedCount} Australian Business leads.`);

} catch (error) {
    console.error('CRASH:', error);
    throw error;
} finally {
    await Actor.exit();
}
