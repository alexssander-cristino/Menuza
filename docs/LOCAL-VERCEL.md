# Executar o Menuza localmente com Vercel Dev

Execute os comandos na raiz do repositório:

```powershell
vercel dev --listen 3000
```

O arquivo `.env.local` deve ficar na raiz do projeto (ao lado de `package.json`) e conter as variáveis usadas pela API:

```dotenv
DATABASE_URL="postgresql://..."
ADMIN_PASSWORD="sua-senha-administrativa-local"
APP_SECRET="uma-chave-aleatoria-com-pelo-menos-32-caracteres"
# Opcional: configure somente se quiser exigir TOTP no login
# ADMIN_TOTP_SECRET="..."
```

A função de banco carrega explicitamente o `.env.local` quando executada pelo Vercel Dev em ambiente `development`, antes de ler `DATABASE_URL`. Assim, as mesmas variáveis ficam disponíveis também para a autenticação da API. Esse carregamento não ocorre em produção nem em deployments Preview.

O `.env.local` é ignorado pelo Git. Não o envie ao repositório e não compartilhe os valores das credenciais.

Para confirmar que o servidor e o banco estão acessíveis, abra `http://localhost:3000/api/health`. O endpoint deve retornar `ok: true` e `database: "connected"`.

A senha do painel local é exatamente o valor definido em `ADMIN_PASSWORD`. Não existe senha padrão embutida no código.
