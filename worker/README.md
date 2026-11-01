# Worker TripoSR do Menuza

Este serviço consulta a fila do Menuza, gera um GLB usando TripoSR na GPU local e envia o arquivo ao Cloudflare R2. Se o notebook estiver desligado, as solicitações aguardam na fila.

## Requisitos

- Windows 10/11, Python 3.10 ou 3.11 e Git.
- NVIDIA RTX 3050 com driver atualizado.
- Conta Cloudflare com R2 configurado.
- A RTX 3050 de notebook pode ter 4 GB ou 6 GB de VRAM. A compatibilidade precisa ser testada; feche aplicativos que usam GPU.

## Instalação

No PowerShell, a partir da raiz do repositório:

    cd worker
    py -3.10 -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    git clone https://github.com/VAST-AI-Research/TripoSR.git

Instale o PyTorch com CUDA compatível com o driver pelo seletor oficial https://pytorch.org/get-started/locally/ e siga as instruções do TripoSR em https://github.com/VAST-AI-Research/TripoSR. Instale também as dependências do TripoSR:

    cd TripoSR
    pip install -r requirements.txt
    cd ..
    Copy-Item .env.example .env
    notepad .env

Preencha o arquivo .env. O token deve ser igual ao segredo TRIPOSR_WORKER_TOKEN da Vercel. Nunca envie esse arquivo ao GitHub.

## R2

Crie um bucket no Cloudflare R2, gere credenciais S3 restritas ao bucket e configure um domínio público de leitura para os GLBs. Preencha todas as variáveis R2 no .env. O worker guarda as credenciais somente localmente.

O plano gratuito do R2 tem limites de armazenamento e operações. O uso dentro dos limites pode ser gratuito, mas excedentes podem gerar cobrança; não existe garantia de custo zero ilimitado.

## Executar

    .\.venv\Scripts\Activate.ps1
    python triposr-worker.py

Mantenha o notebook ligado e na tomada durante a geração. Desligado, os pedidos ficam na fila. O worker não é iniciado automaticamente pelo Windows.

## Limitações

- TripoSR estima a geometria a partir de uma foto; não recupera a forma real nem combina múltiplas vistas.
- A conversão OBJ para GLB pode exigir ajustes de materiais/texturas.
- A integração ainda exige conectar a URL GLB ao visualizador 3D/AR do cardápio e testar em dispositivos reais.
