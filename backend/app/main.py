from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, load_settings
from app.database import initialize_database
from app.domain import TaskStatus
from app.pointcloud import INPUT_POINTS, MAX_BYTES


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        initialize_database(settings.storage_dir)
        yield

    app = FastAPI(title="Point Cloud Denoising System", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/capabilities")
    def capabilities():
        return {
            "phase": "scaffold",
            "input": {"extension": ".xyz", "point_count": INPUT_POINTS, "max_bytes": MAX_BYTES},
            "task_statuses": [status.value for status in TaskStatus],
            "algorithm": "PCN continuous probability + PD-LTS",
            "remote_ready": False,
            "features": {"authentication": False, "upload": False, "denoising": False},
        }

    return app


app = create_app()
