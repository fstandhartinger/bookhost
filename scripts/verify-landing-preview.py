#!/usr/bin/env python3
"""Read-only local layout check; mock every checkout/analytics request.
Usage: python3 scripts/verify-landing-preview.py OUTPUT_DIR
Uses the job's installed Playwright Chromium. Never provisions a workspace.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4387'
CHROME = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')

async def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    evidence = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME or p.chromium.executable_path)
        try:
            for device, width, height in [('desktop', 1440, 900), ('phone', 390, 844)]:
                for theme in ['light', 'dark']:
                    context = await browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, device_scale_factor=2 if device == 'phone' else 1, is_mobile=device == 'phone', has_touch=device == 'phone')
                    page = await context.new_page()
                    beacons = []
                    async def track(route):
                        beacons.append(route.request.post_data_json)
                        await route.fulfill(status=204)
                    await page.route('**/api/track', track)
                    await page.route('**/api/checkout', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"Local QA: no real checkout created"}'))
                    response = await page.goto(BASE, wait_until='networkidle')
                    await page.wait_for_timeout(500)
                    assert response.status == 200
                    geometry = await page.evaluate('''() => {
                      const image = document.querySelector('img[src*="demo-onboarding"]');
                      const rect = image.getBoundingClientRect();
                      return {viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, screenshotTop: rect.top, screenshotHeight: rect.height, visibleFraction: Math.max(0, Math.min(rect.height, innerHeight - rect.top)) / rect.height};
                    }''')
                    assert geometry['documentWidth'] <= width, geometry
                    if device == 'desktop':
                        assert geometry['visibleFraction'] >= .40, geometry
                    await page.screenshot(path=str(out / f'bookhost-{device}-{theme}-fold.png'))
                    # Chrome otherwise omits offscreen content-visibility:auto
                    # sections from full-page screenshots. Paint them for capture.
                    await page.add_style_tag(content='.defer { content-visibility: visible !important; }')
                    await page.evaluate('document.fonts.ready')
                    await page.evaluate('''async () => {
                      const images = [...document.images];
                      images.forEach(image => image.loading = 'eager');
                      await Promise.all(images.map(image => image.decode().catch(() => {})));
                    }''')
                    await page.wait_for_timeout(500)
                    assert await page.evaluate('document.documentElement.scrollWidth') <= width
                    await page.screenshot(path=str(out / f'bookhost-{device}-{theme}-full.png'), full_page=True)
                    visible_text = await page.locator('main').inner_text()
                    assert visible_text.count('20 drafts during the trial; 300 drafts per calendar month') == 1
                    assert visible_text.index('AI that shows') < visible_text.index('From sign-up') < visible_text.index('A home for your') < visible_text.index('Keep BookStack') < visible_text.index('Before you move in')
                    # No secrets, emails or account fields entered. Verify client
                    # click instrumentation against intercepted local requests.
                    await page.locator('[data-trial-position="hero"]').click()
                    await page.wait_for_timeout(100)
                    assert await page.locator('main p[role=alert]').inner_text() == 'Local QA: no real checkout created'
                    await page.locator('[data-trial-position="pricing_teaser"]').click()
                    await page.wait_for_timeout(100)
                    await page.locator('[data-trial-position="footer"]').click()
                    await page.wait_for_url('**/pricing')
                    await page.locator('[data-trial-position="nav"]').click()
                    await page.wait_for_timeout(100)
                    labels = [x['position'] for x in beacons if x.get('name') == 'checkout_start']
                    assert labels == ['hero', 'pricing_teaser', 'footer', 'nav'], labels
                    assert await page.locator('html').get_attribute('data-theme') in [None, theme]
                    evidence.append({'device': device, 'theme': theme, 'status': response.status, **geometry, 'trialPositions': labels, 'visibleDraftQuotaCount': 1, 'fullPagePaintOverride': '.defer content-visibility: visible (screenshot only)'})
                    await context.close()
        finally:
            await browser.close()
    print(json.dumps(evidence, indent=2))

asyncio.run(main())
