update users
set email = 'pedro.caramez@colegioefanor.pt', updated_at = now()
where lower(email) = 'pedro.caramez@exadrezporto.pt';

update mural_posts
set published_at = date '2026-06-16'
where id = '70313030-3030-3030-3030-303030303030'::uuid;

update mural_posts
set
  body_markdown = 'Novos alunos: encomendar KIT COMPLETO pelo [formulário](https://forms.office.com/pages/responsepage.aspx?id=nM9rUTV8pEmIMX014EtXcu_59eOEAmpEmm18FEi8AlxUOE9YMEZKU0ZLMDZSWExIUUU3UEI1SEhKNC4u&origin=lprLink&route=shorturl). Quem já frequenta pode pedir peças avulso.',
  published_at = date '2026-06-10'
where id = '70323030-3030-3030-3030-303030303030'::uuid;
