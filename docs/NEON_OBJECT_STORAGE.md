# Neon Object Storage no Menuza

O Menuza usa o bucket existente `menuza-modelos-3d` do projeto Neon `menuza_prod`. O bucket é `public_read` e continua armazenando os modelos GLB já existentes. As imagens usam prefixos separados:

- `products/<product-id>/` — fotos e galerias de produtos;
- `restaurants/logos/` — logos;
- `restaurants/banners/` — banners promocionais.

O PostgreSQL guarda somente as URLs dos objetos. As imagens novas são convertidas para WebP no navegador antes do envio. O backend faz o upload autenticado para o Neon Object Storage e devolve a URL pública. O fluxo TripoSR baixa a foto da URL e a converte novamente para Base64 apenas para entregar a imagem ao worker, sem alterar a geração dos modelos 3D.

## Variáveis de ambiente

Configure no Vercel e no ambiente local:

- `AWS_ENDPOINT_URL_S3`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `MENUZA_STORAGE_BUCKET=menuza-modelos-3d`

As chaves S3 devem permanecer somente no servidor; nunca use prefixos públicos como `NEXT_PUBLIC_` ou exponha essas variáveis no navegador.

## Sincronizar as variáveis no Windows

Para atualizar as variáveis locais sem sobrescrever as demais configurações e segredos já existentes em `.env.local`:

```powershell
vercel env pull .env.storage.local --environment=development --yes
$keys = '^(AWS_ENDPOINT_URL_S3|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION|MENUZA_STORAGE_BUCKET)='
$storage = Get-Content .env.storage.local | Where-Object { $_ -match $keys }
$local = if (Test-Path .env.local) { Get-Content .env.local | Where-Object { $_ -notmatch $keys } } else { @() }
@($local) + @($storage) | Set-Content .env.local -Encoding utf8
Remove-Item .env.storage.local
```

Depois reinicie o servidor local. O arquivo `.env.local` não deve ser enviado ao Git.

## Compatibilidade e migração

- Fotos antigas que ainda estejam em Base64 no PostgreSQL são migradas para o bucket quando o catálogo é carregado.
- Logo e banner antigos são migrados quando os respectivos dados de identidade visual são consultados.
- Fotos antigas em URLs externas continuam aceitas.
- O SQLite local continua armazenando os dados locais; os bytes das novas imagens ficam no mesmo bucket Neon.
