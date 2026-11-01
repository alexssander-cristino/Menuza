import base64, os, subprocess, tempfile, time
from pathlib import Path
import boto3, requests, trimesh
from dotenv import load_dotenv

load_dotenv()
API = os.environ["MENUZA_API_BASE"].rstrip("/")
TOKEN = os.environ["TRIPOSR_WORKER_TOKEN"]
TRIPOSR = Path(os.environ.get("TRIPOSR_DIR", "./TripoSR")).resolve()
POLL = max(5, int(os.environ.get("POLL_SECONDS", "15")))
HEADERS = {"Authorization": "Bearer " + TOKEN}
R2 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
HTTP = requests.Session()
HTTP.headers.update(HEADERS)

def generate(image: Path, output: Path) -> Path:
    resolution = str(max(128, min(384, int(os.environ.get("TRIPOSR_MC_RESOLUTION", "192")))))
    timeout = max(120, int(os.environ.get("GENERATION_TIMEOUT_SECONDS", "900")))
    subprocess.run(["python", "run.py", str(image), "--output-dir", str(output),
                    "--mc-resolution", resolution], cwd=TRIPOSR, check=True, timeout=timeout)
    candidates = list(output.rglob("mesh.obj")) or list(output.rglob("*.obj"))
    if not candidates:
        raise RuntimeError("TripoSR não produziu uma malha OBJ.")
    mesh = trimesh.load(candidates[0], force="mesh", process=True)
    if mesh.is_empty:
        raise RuntimeError("A malha gerada está vazia.")
    target = output / "product.glb"
    mesh.export(target)
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
            key = "products/" + job["productId"] + "/" + jid + ".glb"
            R2.upload_file(str(glb), os.environ["R2_BUCKET"], key,
                ExtraArgs={"ContentType":"model/gltf-binary",
                           "CacheControl":"public, max-age=31536000, immutable"})
            url = os.environ["R2_PUBLIC_URL"].rstrip("/") + "/" + key
            HTTP.post(API + "/api/3d-worker/complete/" + jid,
                      json={"modelUrl":url}, timeout=30).raise_for_status()
            print("[OK] Modelo publicado:", url)
    except Exception as exc:
        msg = str(exc)[:280] or "Falha desconhecida na geração."
        print("[ERRO]", jid, msg)
        try:
            HTTP.post(API + "/api/3d-worker/fail/" + jid,
                      json={"error":msg}, timeout=20).raise_for_status()
        except Exception as callback:
            print("[ERRO] Callback falhou:", callback)

def main():
    if not (TRIPOSR / "run.py").exists():
        raise SystemExit("TripoSR não encontrado. Configure TRIPOSR_DIR.")
    print("Menuza TripoSR Worker iniciado. Ctrl+C para encerrar.")
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
