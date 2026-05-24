// tests/e2e/login.spec.ts (CORR-F3 smoke test)
// ----------------------------------------------------------------------------
// Bare-minimum E2E: dev server boots, login page renders an email input
// and a Send OTP button. Real auth flows are tested in CORR-H9 scenarios.
// ----------------------------------------------------------------------------
import { test, expect } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/login');

  // Heading or page title should mention sign-in / login / OTP.
  const heading = page.locator('h1, h2').first();
  await expect(heading).toBeVisible({ timeout: 10_000 });

  // Email input must exist.
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await expect(emailInput).toBeVisible();

  // Some kind of submit / send-otp button.
  const submit = page.getByRole('button').first();
  await expect(submit).toBeVisible();
});
