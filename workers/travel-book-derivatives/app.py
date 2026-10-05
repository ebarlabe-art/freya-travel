import hashlib
import io
import os
import uuid

import httpx
import pillow_heif
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "travel-book"
MAX_PIXELS = int(os.environ.get("ALB03_MAX_PIXELS", "60000000"))

app = FastAPI(title="Freya Travel Book Derivative Worker", version="1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://ebarlabe-art.github.io"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class ProcessRequest(BaseModel):
    asset_id: uuid.UUID

def service_headers():
    return {"apikey": SERVICE_ROLE, "Authorization": f"Bearer {SERVICE_ROLE}"}

def rpc_headers():
    return {**service_headers(), "Content-Type": "application/json"}

def descriptor(v):
    return {
        "hash": v["content_hash"],
        "width": v["width_px"],
        "height": v["height_px"],
        "path": v["storage_path"],
        "mime": v["mime_type"],
        "ext": v["file_extension"],
        "byte_size": v["byte_size"],
        "orientation": v["orientation"],
    }

def output_path(asset, kind):
    return f'{asset["trip_id"]}/{asset["book_id"]}/{asset["asset_key"]}/{asset["version"]}/v1/{kind}.png'

def png_derivative(image, bound, icc):
    work = image.copy()
    work.thumbnail((bound, bound), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    kwargs = {"format": "PNG", "optimize": True}
    if icc:
        kwargs["icc_profile"] = icc
    work.save(out, **kwargs)
    data = out.getvalue()
    return data, work.width, work.height

async def rpc(client, name, args):
    r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}", headers=rpc_headers(), json=args)
    if r.status_code >= 400:
        detail = r.json() if "application/json" in r.headers.get("content-type", "") else {}
        raise RuntimeError(f"RPC:{detail.get('code','UNKNOWN')}")
    if not r.content:
        return None
    return r.json()

async def storage_read(client, bucket, path):
    r = await client.get(
        f"{SUPABASE_URL}/storage/v1/object/authenticated/{bucket}/{path}",
        headers=service_headers(),
    )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content

async def storage_put_verified(client, path, data):
    r = await client.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers={**service_headers(), "Content-Type": "image/png", "x-upsert": "false"},
        content=data,
    )
    if r.status_code not in (200, 201, 409):
        r.raise_for_status()
    stored = await storage_read(client, BUCKET, path)
    if stored is None or hashlib.sha256(stored).hexdigest() != hashlib.sha256(data).hexdigest():
        raise RuntimeError("STORAGE_ERROR")

@app.get("/health")
async def health():
    return {"ok": True}

async def authenticated_actor(client, authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="UNAUTHENTICATED")
    r = await client.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"apikey": SERVICE_ROLE, "Authorization": authorization},
    )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="UNAUTHENTICATED")
    user = r.json()
    actor_id = user.get("id")
    if not actor_id:
        raise HTTPException(status_code=401, detail="UNAUTHENTICATED")
    return actor_id

@app.post("/process")
async def process(req: ProcessRequest, authorization: str | None = Header(default=None)):
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        actor_id = await authenticated_actor(client, authorization)
        claim = await rpc(client, "alb03_claim_v1", {
            "p_asset_id": str(req.asset_id),
            "p_actor": actor_id,
        })
        job, asset, variants = claim["job"], claim["asset"], claim.get("variants") or []
        original = next((v for v in variants if v["kind"] == "original"), None)
        lease = job["lease_id"]

        async def finish(payload=None, error=None):
            return await rpc(client, "alb03_finish_v1", {
                "p_asset_id": str(req.asset_id),
                "p_actor": actor_id,
                "p_lease_id": lease,
                "p_descriptor": payload,
                "p_error": error,
            })

        try:
            if not original:
                await finish(None, "MASTER_MISSING")
                raise HTTPException(status_code=409, detail="MASTER_MISSING")

            source = await storage_read(client, BUCKET, original["storage_path"])
            if source is None or hashlib.sha256(source).hexdigest() != original["content_hash"]:
                await finish(None, "MASTER_MISSING")
                raise HTTPException(status_code=409, detail="MASTER_MISSING")

            image = Image.open(io.BytesIO(source))
            image.load()
            image = ImageOps.exif_transpose(image)
            if image.width * image.height > MAX_PIXELS:
                await finish(None, "DERIVATIVE_CAPACITY")
                raise HTTPException(status_code=422, detail="DERIVATIVE_CAPACITY")

            icc = image.info.get("icc_profile")
            if image.mode not in ("RGB", "RGBA", "L", "LA"):
                image = image.convert("RGB")

            d = {"original": descriptor(original)}
            for kind, bound in (("preview", 1600), ("thumbnail", 320)):
                data, width, height = png_derivative(image, bound, icc)
                path = output_path(asset, kind)
                digest = hashlib.sha256(data).hexdigest()
                previous = next((v for v in variants if v["kind"] == kind), None)
                if previous and (previous["content_hash"] != digest or previous["storage_path"] != path):
                    await finish(None, "DERIVATIVE_FAILED")
                    raise HTTPException(status_code=409, detail="DERIVATIVE_FAILED")
                await storage_put_verified(client, path, data)
                d[kind] = {
                    "hash": digest,
                    "width": width,
                    "height": height,
                    "path": path,
                    "mime": "image/png",
                    "ext": "png",
                    "byte_size": len(data),
                    "orientation": 1,
                }

            await finish(d)
            return {"asset_id": str(req.asset_id), "status": "ready"}

        except HTTPException:
            raise
        except Exception:
            try:
                await finish(None, "DERIVATIVE_FAILED")
            except Exception:
                pass
            raise HTTPException(status_code=503, detail="DERIVATIVE_FAILED")
