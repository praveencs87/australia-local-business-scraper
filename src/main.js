import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

try {
    const input = await Actor.getInput();
    const { 
        keyword = 'plumber', 
        location = 'sydney', 
        maxLeads = 100,
        proxyConfiguration 
    } = input || {};

    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration || { 
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'] // Residential recommended for YellowPages
    });

    log.info(`Searching YellowPages Australia for "${keyword}" in "${location}"`);
    await Actor.charge({ eventName: 'apify-actor-start', count: 1 });

    let extractedCount = 0;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency: 5,
        navigationTimeoutSecs: 90,
        browserPoolOptions: {
            useFingerprints: true,
        },
        async requestHandler({ page, request, log, enqueueLinks }) {
            log.info(`Parsing listing page: ${request.url}`);
            
            // Wait for Cloudflare to pass and the main content to load
            await page.waitForSelector('.search-results-page, .listing, .result-item, h1', { timeout: 30000 }).catch(() => log.warning('Timeout waiting for initial DOM, might be Cloudflare block.'));

            // Check if Cloudflare blocked us
            const cfTitle = await page.title();
            if (cfTitle.includes('Attention Required') || cfTitle.includes('Just a moment')) {
                throw new Error('Blocked by Cloudflare. Retrying with different session...');
            }

            // In YellowPages Australia, data is often stored in a large JSON object in a script tag or in standard class names.
            // Let's try to parse the DOM for typical elements.
            const businessItems = await page.$$('.listing, .box, .search-contact-card, .listing-summary');
            
            for (const item of businessItems) {
                if (extractedCount >= maxLeads) break;

                const nameElement = await item.$('.listing-name, h2, h3');
                if (!nameElement) continue;
                const businessName = (await nameElement.innerText()).trim();

                const categoryElement = await item.$('.listing-heading, .category, .industry');
                const category = categoryElement ? (await categoryElement.innerText()).trim() : '';

                const addressElement = await item.$('.listing-address, .address');
                const address = addressElement ? (await addressElement.innerText()).trim() : '';

                // Click to reveal phone numbers if hidden
                const showNumberBtn = await item.$('.call-button, .show-number, button:has-text("Show number")');
                if (showNumberBtn) {
                    try {
                        await showNumberBtn.click();
                        await page.waitForTimeout(500);
                    } catch (e) {}
                }

                const phoneElement = await item.$('.contact-phone, .phone, a[href^="tel:"]');
                const phone = phoneElement ? (await phoneElement.innerText()).trim() : '';

                const websiteElement = await item.$('.contact-url, .website, a.contact-button[href^="http"]');
                const website = websiteElement ? await websiteElement.getAttribute('href') : '';
                
                const urlElement = await item.$('.listing-name, a.listing-name');
                const listingUrl = urlElement ? await urlElement.getAttribute('href') : '';
                const fullListingUrl = listingUrl && !listingUrl.startsWith('http') ? new URL(listingUrl, 'https://www.yellowpages.com.au').toString() : listingUrl;

                if (businessName) {
                    const record = {
                        businessName,
                        category,
                        address,
                        phone,
                        website,
                        listingUrl: fullListingUrl || request.url,
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
                const hasNextPage = await page.$('a.next, .pagination-next, a:has-text("Next")');
                if (hasNextPage) {
                    const nextUrl = await hasNextPage.getAttribute('href');
                    if (nextUrl) {
                        const absoluteUrl = new URL(nextUrl, 'https://www.yellowpages.com.au').toString();
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

    // We target YellowPages Australia
    const startUrl = `https://www.yellowpages.com.au/search/listings?clue=${encodeURIComponent(keyword)}&locationClue=${encodeURIComponent(location)}`;
    
    await crawler.addRequests([{
        url: startUrl,
        userData: { isListingPage: true }
    }]);

    await crawler.run();

    log.info(`🎉 Done! Extracted ${extractedCount} Australian business leads.`);

} catch (error) {
    console.error('CRASH:', error);
    throw error;
} finally {
    await Actor.exit();
}
