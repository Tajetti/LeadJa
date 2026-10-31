# LeadJá local

Aplicativo pessoal para macOS que busca negócios no Google Maps, prioriza oportunidades com regras transparentes, acompanha contatos em um CRM local e publica vídeos nas contas sociais conectadas. Não usa IA, não exige uma conta do LeadJá e não depende de Docker na versão desktop.

## Requisitos

- Node.js 24 ou mais recente para desenvolvimento
- macOS Apple Silicon para o aplicativo empacotado

## Executar

```bash
npm start
```

Abra `http://127.0.0.1:4173`. Este comando mantém o modo navegador e usa Docker nas buscas, quando disponível.

## Aplicativo macOS

O GitHub Actions compila o coletor nativo ARM64 e gera o DMG sem depender do Docker. Execute o workflow **Build macOS ARM64** manualmente na aba Actions ou crie uma tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Execuções manuais disponibilizam o DMG em **Artifacts**. Tags `v*` também criam uma GitHub Release com o instalador anexado.

Para executar o desktop em desenvolvimento, primeiro disponibilize o coletor em `resources/bin/google-maps-scraper` e rode:

```bash
npm run desktop
```

O script `npm run build:scraper` compila o coletor, mas requer Go 1.27.1 instalado.

## Testes

```bash
npm test
```

## Dados locais

- No modo navegador: `.leadja/`
- No aplicativo: `~/Library/Application Support/LeadJá/data/`
- Leads, configurações e histórico ficam no SQLite local.
- O LeadJá não possui backend próprio e não envia dados a serviços de IA.
- Ao usar **Publicações**, somente o vídeo, a descrição e as autorizações necessárias são enviados às redes selecionadas. Segredos e tokens ficam protegidos localmente pelo armazenamento seguro do macOS.

## Fluxo

1. Informe o tipo de negócio e a cidade em **Buscar**.
2. O coletor salva os estabelecimentos encontrados no SQLite.
3. O score usa regras configuráveis como ausência de site próprio, poucas avaliações, nota baixa e presença de telefone.
4. Abra um lead para ver o recibo do score, gerar a mensagem e atualizar a etapa.
5. Acompanhe o andamento no quadro **CRM**.

## Publicações sociais

A tela **Publicações** conecta Facebook, Instagram, TikTok e Kwai por meio das APIs oficiais. Cada rede exige que você crie e configure uma aplicação de desenvolvedor antes do primeiro login:

- **Meta:** app Business com Facebook Login, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`.
- **TikTok:** app Desktop com Login Kit, Content Posting API e `video.publish`. Cadastre `http://127.0.0.1:*/oauth/tiktok` como URL de retorno.
- **Kwai:** aplicação Web com `user_info` e `user_video_publish`.
- **Instagram:** além da Meta, configure um bucket público temporário no Supabase Storage. A API do Instagram precisa buscar o vídeo por uma URL pública; o LeadJá envia o arquivo temporário e tenta removê-lo ao final.

Contas, tentativas e resultados por destino aparecem no histórico local. Uma falha em uma rede não apaga a publicação concluída nas outras.

Também é possível importar um CSV pelas telas de leads. Colunas comuns em português e inglês são reconhecidas automaticamente.
