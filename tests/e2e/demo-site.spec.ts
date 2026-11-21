import { expect, test } from '@playwright/test';

test.describe('Site de démo', () => {
  test('recherche → résultats → offre → candidature (sans envoi)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Mots-clés').fill('développeur');
    await page.getByLabel('Ville').selectOption('Lyon');
    await page.getByLabel('CDI').check();
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page).toHaveURL(/results\.html/);
    await expect(page.locator('#results-summary')).toHaveText('1 offre pour « développeur », Lyon, CDI.');

    await page.getByRole('link', { name: 'Développeur·se front-end React' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Développeur·se front-end React');

    await page.getByRole('button', { name: 'Postuler' }).click();
    await page.getByLabel('Nom complet').fill('Camille Test');
    await page.getByLabel('E-mail').fill('camille@example.test');
    await page.getByRole('button', { name: 'Envoyer la candidature' }).click();
    await expect(page.getByRole('status')).toContainText('Rien n’a été envoyé');
  });

  test('« Modifier la recherche » conserve les critères', async ({ page }) => {
    await page.goto('/results.html?q=data&ville=Paris');
    await page.getByRole('link', { name: 'Modifier la recherche' }).click();
    await expect(page.getByLabel('Mots-clés')).toHaveValue('data');
    await expect(page.getByLabel('Ville')).toHaveValue('Paris');
  });
});
