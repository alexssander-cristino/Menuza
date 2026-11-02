import base64, os, subprocess, tempfile, time
from pathlib import Path
from urllib.parse import quote

import boto3
import requests
import trimesh
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv()

API = os.environ["MENUZA_API_BASE"].rstrip("/")
TOKEN = os.environ["TRIPOSR_WORKER_TOKEN"]
TRIPOSR = Path(os.environ.get("TRIPOSR_DIR", "./TripoSR")).resolve()
POLL = max(5, int(os.environ.get("POLL_SECONDS", "15")))
BUCKET = os.environ.get("NEON_STORAGE_BUCKET", "menuza-modelos-3d")
ENDPOINT = os.environ["AWS_ENDPOINT_URL_S3"].rstrip("/")
REGION = os.environ.get("AWS_REGION", "us-east-2")
HEADERS = {"Authorization": "Bearer " + TOKEN}

# Neon Object Storage é compatível com S3 e exige path-style addressing.
STORAGE = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    region_name=REGION,
    config=Config(s3={"addressing_style": "path"}),
)
HTTP = requests.Session()
HTTP.headers.update(HEADERS)


def generate(image: Path, output: Path) -> Path:
    resolution = str(max(128, min(384, int(os.environ.get("TRIPOSR_MC_RESOLUTION", "192")))))
    timeout = max(120, int(os.environ.get("GENERATION_TIMEOUT_SECONDS", "900")))
    subprocess.run(
        ["python", "run.py", str(image), "--output-dir", str(output), "--mc-resolution", resolution],
        cwd=TRIPOSR,
        check=True,
        timeout=timeout,
    )
    candidates = list(output.rglob("mesh.obj")) or list(output.rglob("*.obj"))
    if not candidates:
        raise RuntimeError("TripoSR não produziu uma malha OBJ.")
    mesh = trimesh.load(candidates[0], force="mesh", process=True)
    if mesh.is_empty:
        raise RuntimeError("A malha gerada está vazia.")
    target = output / "product.glb"
    mesh.export(target)
    if not target.is_file() or target.stat().st_size < 1024:
        raise RuntimeError("O arquivo GLB gerado está vazio ou incompleto.")
    return target


def process(job):
    jid = job["id"]
    try:
        image_data = str(job.get("imageData") or "")
        if not image_data.startswith("data:image/") or "," not in image_data:
            raise RuntimeError("A foto do produto está ausente ou em formato inválido.")
        raw = base64.b64decode(image_data.split(",", 1)[1], validate=True)
        if len(raw) > 12 * 1024 * 1024:
            raise RuntimeError("A imagem excede o limite de 12 MB.")

        with tempfile.TemporaryDirectory(prefix="menuza-3d-") as tmp:
            root = Path(tmp)
            source = root / "source.jpg"
            source.write_bytes(raw)
            glb = generate(source, root / "out")

            key = f"products/{job['productId']}/{jid}.glb"
            STORAGE.upload_file(
                str(glb),
                BUCKET,
                key,
                ExtraArgs={
                    "ContentType": "model/gltf-binary",
                    "CacheControl": "public, max-age=31536000, immutable",
                },
            )
            # O bucket Neon é public_read; esta URL pode ser consumida pelo viewer/AR.
            url = f"{ENDPOINT}/{quote(BUCKET, safe='')}/{quote(key, safe='/')}"
            HTTP.post(
                API + "/api/3d-worker/complete/" + jid,
                json={"modelUrl": url},
                timeout=30,
            ).raise_for_status()
            print("[OK] Modelo publicado no Neon Object Storage:", url)
    except Exception as exc:
        msg = str(exc)[:280] or "Falha desconhecida na geração."
        print("[ERRO]", jid, msg)
        try:
            HTTP.post(
                API + "/api/3d-worker/fail/" + jid,
                json={"error": msg},
                timeout=20,
            ).raise_for_status()
        except Exception as callback:
            print("[ERRO] Callback falhou:", callback)


def main():
    required = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT_URL_S3")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            "Credenciais do Neon Object Storage ausentes: "
            + ", ".join(missing)
            + ". Execute 'neon env pull' na raiz do projeto e copie AWS_* para worker/.env."
        )
    if not (TRIPOSR / "run.py").exists():
        raise SystemExit("TripoSR não encontrado. Configure TRIPOSR_DIR.")
    print(f"Menuza TripoSR Worker iniciado. Neon bucket: {BUCKET}. Ctrl+C para encerrar.")
    while True:
        try:
            response = HTTP.get(API + "/api/3d-worker/next", timeout=30)
            response.raise_for_status()
            job = response.json().get("job")
            if job:
                print("Processando produto:", job["productId"])
                process(job)
            else:
                time.sleep(POLL)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print("[AVISO] API indisponível:", exc)
            time.sleep(POLL)


if __name__ == "__main__":
    main()
