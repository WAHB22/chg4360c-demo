// The private setup link opened in a tab that already shows "This device is not set up":
// only the fragment changes, so the page must store the key, clean the address bar and load the data.
export default async function ({ step, assert, freshPage }) {
  const page = await freshPage({ key: false });

  await step('without a key the page says it is not set up', async () => {
    await page.getByText('This device is not set up').waitFor();
  });

  await step('tapping the #key link in the same tab sets it up', async () => {
    await page.evaluate(() => { location.hash = 'key=dev-key'; });
    await page.waitForFunction(() => document.getElementById('main') && !document.getElementById('main').hidden, null, { timeout: 10000 });
    await page.getByText('$1,300.00').first().waitFor({ timeout: 10000 });
    assert.ok(!page.url().includes('dev-key'), 'the key is gone from the address bar: ' + page.url());
    assert.equal(await page.evaluate(() => localStorage.getItem('finance-key')), 'dev-key');
  });
}
