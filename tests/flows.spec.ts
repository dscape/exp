import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Entrar no clube/i }),
  ).toBeVisible();
  await page.getByPlaceholder("o teu email").fill("pedro.caramez@colegioefanor.pt");
  await page.getByPlaceholder("••••••••").fill("password");
  await page.getByRole("button", { name: /Entrar no clube/i }).click();
  await expect(page.getByRole("heading", { name: "Mural" })).toBeVisible();
}

test.describe("full desktop flows", () => {
  test.use({
    viewport: { width: 1280, height: 860 },
    isMobile: false,
    hasTouch: false,
  });

  test("request access consent and success flow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Pedir acesso/i }).click();
    await expect(
      page.getByRole("heading", { name: "Pedir acesso" }),
    ).toBeVisible();
    await page.getByPlaceholder("Nome completo").fill("Aluno Teste");
    await page.getByPlaceholder(/DD\/MM\/AAAA/).fill("01 / 01 / 2015");
    await page.getByPlaceholder("email@exemplo.pt").fill("parent@example.test");
    await page.getByPlaceholder("9XX XXX XXX").fill("910000999");
    await page.getByPlaceholder("mínimo 8 caracteres").fill("password123");
    await page.getByPlaceholder("repete a palavra-passe").fill("password123");
    await page.getByText(/Autorizo a/).click();
    await page.getByRole("button", { name: "Enviar pedido" }).click();
    await expect(
      page.getByRole("heading", { name: "Pedido enviado!" }),
    ).toBeVisible();
  });

  test("mural compose, markdown help, WhatsApp share and remove", async ({
    page,
    context,
  }) => {
    await login(page);
    await page.getByRole("button", { name: /Novo post-it/i }).click();
    await expect(page.getByText("Markdown básico")).toBeHidden();
    await page.getByRole("button", { name: "i", exact: true }).click();
    await expect(page.getByText("Markdown básico")).toBeVisible();
    await page.getByPlaceholder(/Convocatória/).fill("Teste do mural");
    await page
      .getByPlaceholder(/Escreve o aviso/)
      .fill("**Aviso** criado em teste");
    await page.getByRole("button", { name: /Afixar no mural/i }).click();
    const post = page.locator("article").filter({ hasText: "Teste do mural" });
    await expect(post).toBeVisible();
    await post.hover();
    const popupPromise = context.waitForEvent("page").catch(() => null);
    await post.getByLabel("Partilhar no WhatsApp").click();
    const popup = await popupPromise;
    if (popup) await popup.close();
    await expect(page.getByText("Link de WhatsApp aberto")).toBeVisible();
    await post.getByRole("button", { name: "×" }).click();
    await expect(post).toHaveCount(0);
  });

  test("events filters, create modal, recommendation, registrations and event states", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Eventos" }).click();
    await expect(page.getByText(/Provas e/)).toBeVisible();

    await page.locator("select").first().selectOption("2026/27");
    await expect(
      page.getByText("Abertura de Época · Torneio Rápidas Efanor"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Abertura de Época · Torneio Rápidas Efanor/i })
      .click();
    await page.goBack();
    await expect(page.locator("select").first()).toHaveValue("2026/27");
    await expect(
      page.getByText("Abertura de Época · Torneio Rápidas Efanor"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Abertura de Época · Torneio Rápidas Efanor/i })
      .click();
    await page.getByRole("button", { name: /Voltar aos eventos/i }).click();
    await expect(page.locator("select").first()).toHaveValue("2026/27");
    await page.getByRole("button", { name: /Novo evento/i }).click();
    await page
      .getByPlaceholder(/Open Internacional/)
      .fill("Evento Teste Playwright");
    await page.getByPlaceholder("Cidade").fill("Porto");
    await page.getByPlaceholder(/20–21 JUN/).fill("1–2 JUL");
    await page
      .getByPlaceholder(/chess-results/)
      .fill("https://chess-results.com/tnr999999.aspx?lan=10");
    await expect(page.getByText(/modo best-effort/i)).toBeVisible();
    await page.getByPlaceholder(/17 JUN/).fill("30 JUN");
    await page.getByRole("button", { name: /Adicionar evento/i }).click();
    await expect(page.getByText("Evento criado")).toBeVisible();
    await expect(page.getByText("Evento Teste Playwright")).toBeVisible();

    await page
      .getByRole("button", { name: /Evento Teste Playwright/i })
      .click();
    await expect(
      page.getByRole("heading", { name: "Evento Teste Playwright" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Recomendar a alunos/i }).click();
    await expect(
      page.getByRole("button", { name: /Recomendado a alunos/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Gerir inscrições/i }).click();
    await expect(
      page.getByText("As inscrições são feitas PELO CLUBE"),
    ).toBeVisible();
    await page
      .locator("button")
      .filter({ hasText: "Inscrever" })
      .first()
      .click();
    await expect(
      page.locator("button").filter({ hasText: "Inscrito ✓" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: /Voltar aos eventos/i }).click();
    await page.locator("select").first().selectOption("2025/26");
    await page
      .getByRole("button", { name: /Open Internacional do Porto 2026/i })
      .click();
    await expect(page.getByText("Próximos emparelhamentos")).toBeVisible();
    await expect(page.getByText("Classificação ao vivo")).toBeVisible();
    await page.getByRole("button", { name: /Voltar aos eventos/i }).click();
    await page.getByRole("button", { name: "Concluídos" }).click();
    await page
      .getByRole("button", { name: /3.º Torneio Clip Chess Club/i })
      .click();
    await expect(page.getByText("Classificação final")).toBeVisible();
    await page
      .getByRole("button", { name: /\+ medalha/i })
      .first()
      .click();
    await expect(page.getByText("Medalha extra")).toBeVisible();
    await page.getByPlaceholder(/1.º Sub-12/).fill("1.º Escalão Teste");
    await page.getByRole("button", { name: /Atribuir medalha/i }).click();
    await expect(page.getByText("Medalha atribuída")).toBeVisible();
  });

  test("ratings, player profile, PGN download, game annotations and trophies", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Ratings FIDE" }).click();
    await expect(page.getByRole("button", { name: /MEDALHAS/i })).toBeVisible();
    await page.getByPlaceholder("Procurar atleta…").fill("Sofia");
    await page
      .getByRole("button", { name: /Sofia Valente/i })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Sofia Valente" }),
    ).toBeVisible();
    await expect(page.getByText("Evolução do rating")).toBeVisible();
    await expect(page.getByRole("button", { name: /Download/i })).toBeVisible();
    await page.getByRole("button", { name: /Upload/i }).click();
    await expect(page.getByText("Upload PGN")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/sofia-valente.pgn");
    await page.getByRole("button", { name: /Carregar PGN/i }).click();
    await expect(page.getByText(/partida\(s\) PGN carregada/)).toBeVisible();
    await page.getByRole("button", { name: /Sofia Valente – Maria Silva/i }).first().click();
    await expect(page.getByText(/D37/)).toBeVisible();
    await page.getByRole("button", { name: "d4" }).click();
    await page
      .getByPlaceholder(/Escreve a tua análise/)
      .fill("Anotação criada em teste");
    await page.getByRole("button", { name: /Guardar anotação/i }).click();
    await expect(page.getByText("Anotação guardada")).toBeVisible();

    await page.getByRole("button", { name: "Troféus" }).click();
    await expect(
      page.locator("h2", { hasText: "Sala de Troféus" }),
    ).toBeVisible();
    await page.locator("select").selectOption("2025/26");
    await expect(page.getByText("Pódio do clube")).toBeVisible();
  });

  test("management profile completeness, edit modal, manual password reset and role actions", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Gestão" }).click();
    await expect(page.getByText(/perfil\(is\) incompleto/i)).toBeVisible();
    const hugoRow = page
      .locator(".table-row")
      .filter({ hasText: "Hugo Antunes" });
    await expect(hugoRow.getByText(/Incompleto/)).toBeVisible();
    await hugoRow.getByRole("button", { name: /Alterar/i }).click();
    await expect(page.getByText("Editar conta")).toBeVisible();
    const modal = page.locator(".modal");
    await modal.locator("input").nth(2).fill("1999999");
    await modal.locator("input").nth(3).fill("1980-01-01");
    await modal.locator("input").nth(4).fill("910000123");
    await page.getByRole("button", { name: /Gerar/i }).click();
    await page.getByRole("button", { name: /Guardar alterações/i }).click();
    await expect(page.getByText(/Conta atualizada/)).toBeVisible();

    const sofiaRow = page
      .locator(".table-row")
      .filter({ hasText: "Sofia Valente" });
    await sofiaRow.getByRole("button", { name: /Palavra-passe/i }).click();
    await expect(page.getByText("Palavra-passe reposta")).toBeVisible();
    await expect(
      page.getByText(/NOVA PALAVRA-PASSE TEMPORÁRIA/i),
    ).toBeVisible();
    await page.getByRole("button", { name: /Gerar outra/i }).click();
    await page.getByRole("button", { name: /Concluir/i }).click();

    const pendingRow = page
      .locator(".table-row")
      .filter({ hasText: "Tomás Almeida" });
    await pendingRow.getByRole("button", { name: /Ativar/i }).click();
    await expect(pendingRow.getByText("Ativo")).toBeVisible();
  });
});

test.describe("responsive smoke in Chrome", () => {
  test("core navigation renders on mobile and tablet breakpoints", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Eventos" }).click();
    await expect(page.getByText(/Provas e/)).toBeVisible();
    await page.getByRole("button", { name: "Ratings FIDE" }).click();
    await expect(page.getByRole("button", { name: /MEDALHAS/i })).toBeVisible();
  });
});
