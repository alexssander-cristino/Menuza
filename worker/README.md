# Worker TripoSR do Menuza

Este serviço consulta a fila do Menuza, gera um GLB usando TripoSR na GPU local e envia o arquivo ao **Neon Object Storage**. Se o notebook estiver desligado, as solicitações aguardam na fila.

## Requisitos

- Windows 10/11, Python 3.10 ou 3.11 e Git.
- NVIDIA RTX 3050 com driver atualizado.
- Projeto Neon do Menuza com Object Storage habilitado.
- Bucket `menuza-modelos-3d` provisionado na branch de produção com acesso `public_read`.
- A RTX 3050 de notebook com 6 GB deve começar com resolução 192. Feche aplicativos que usam GPU durante a geração.

## Instalação

Na raiz do repositório:

    cd worker
    py -3.11 -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    git clone https://github.com/VAST-AI-Research/TripoSR.git

Instale o PyTorch com CUDA compatível com o driver pelo seletor oficial https://pytorch.org/get-started/locally/ e siga as instruções do TripoSR em https://github.com/VAST-AI-Research/TripoSR. Instale também as dependências do TripoSR:

    cd TripoSR
    pip install -r requirements.txt
    cd ..

## Credenciais do Neon

O bucket de modelos usa o Neon Object Storage da branch de produção. As credenciais S3 são específicas da branch.

1. Na raiz do projeto Menuza (não dentro de `worker`), execute:

       neon env pull

2. Abra o `.env.local` gerado na raiz e copie os valores de `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` e `AWS_REGION`.
3. Crie `worker/.env` a partir do exemplo e cole esses quatro valores. Mantenha `NEON_STORAGE_BUCKET=menuza-modelos-3d`.
4. Configure `TRIPOSR_WORKER_TOKEN` com o mesmo segredo definido na Vercel.

O bucket é público somente para leitura dos modelos GLB. O worker usa as credenciais privadas do Neon para fazer uploads. Nunca envie `worker/.env` ou `.env.local` ao GitHub.

## Executar

    .\.venv\Scripts\Activate.ps1
    python triposr-worker.py

Mantenha o notebook ligado e na tomada durante a geração. Desligado, os pedidos ficam na fila. O worker não é iniciado automaticamente pelo Windows.

## Fluxo

1. O restaurante cadastra um produto com uma foto JPG.
2. Em **Painel > Cardápio**, clica em **Gerar modelo 3D**.
3. A API do Menuza adiciona o trabalho à fila no Neon Postgres.
4. O worker local busca o trabalho e executa o TripoSR na GPU NVIDIA.
5. O worker converte a malha para GLB e envia para `menuza-modelos-3d/products/<produto>/<job>.glb` no Neon Object Storage.
6. O worker informa a URL pública ao Menuza; a API salva a URL e o status no produto.

## Ajustes para RTX 3050 6 GB

O worker usa `TRIPOSR_MC_RESOLUTION=192` por padrão para reduzir o consumo de VRAM. Se a geração funcionar com folga, teste 256. O limite padrão de execução por tarefa é 900 segundos (`GENERATION_TIMEOUT_SECONDS`).

No Windows, se a instalação do TripoSR precisar compilar `torchmcubes`, use Visual Studio 2022 com a carga **Desenvolvimento para desktop com C++**, MSVC v143 e Windows 11 SDK.

Para validar a GPU no ambiente virtual:

    python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'indisponível')"
    python -c "import torchmcubes; print('torchmcubes: OK')"

## Limitações

- TripoSR estima a geometria a partir de uma única foto; não recupera a forma real nem combina múltiplas vistas.
- A qualidade depende da foto, iluminação e recorte do alimento.
- A geração ocorre no computador que mantém o worker ligado; se ele estiver desligado, os pedidos permanecem na fila.
- A URL GLB é pública para leitura porque o visualizador 3D/AR do cardápio precisa carregá-la diretamente no navegador.
