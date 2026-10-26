import hmac
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.autodl import ConnectionRequest, RemoteConfig, RemoteError, RemoteStore
from app.config import Settings, load_settings
from app.database import initialize_database
from app.domain import TaskStatus
from app.pointcloud import INPUT_POINTS, MAX_BYTES


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    remote = RemoteStore(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        initialize_database(settings.storage_dir)
        yield

    app = FastAPI(title="Point Cloud Denoising System", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "PUT", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )
    app.state.remote = remote

    @app.exception_handler(RequestValidationError)
    async def safe_validation_error(request: Request, error: RequestValidationError):
        # Pydantic's default validation response echoes input, including invalid secrets.
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "validation",
                    "message": "配置格式无效，请检查主机、端口及输入字段。",
                }
            },
        )

    bearer = HTTPBearer(auto_error=False)

    def require_admin(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        if len(settings.admin_token) < 32:
            raise HTTPException(
                503,
                detail={
                    "code": "admin_not_configured",
                    "message": "请先在本机运行管理员初始化命令并重启后端。",
                },
            )
        if not credentials or not hmac.compare_digest(
            credentials.credentials.encode("utf-8"), settings.admin_token.encode("utf-8")
        ):
            raise HTTPException(401, detail={"code": "unauthorized", "message": "管理员令牌无效。"})
        origin = request.headers.get("origin")
        if origin and origin not in settings.cors_origins:
            raise HTTPException(403, detail={"code": "origin", "message": "该页面来源未获授权。"})

    def remote_operation(operation):
        try:
            return operation()
        except RemoteError as error:
            raise HTTPException(
                409 if error.code == "busy" else 400,
                detail={
                    "code": error.code,
                    "message": error.message,
                },
            ) from None
        except (ValueError, OSError):
            raise HTTPException(
                503,
                detail={
                    "code": "config_storage",
                    "message": "连接配置无法读写，请检查本机存储目录。",
                },
            ) from None

    def admin_snapshot():
        config = remote.read()
        report = remote.report()
        if report:
            report = {
                key: value
                for key, value in report.items()
                if key not in {"config_digest", "checked_epoch"}
            }
        return {
            "config": config.model_dump() if config else None,
            "status": remote.status(),
            "last_check": report,
            "passphrase_configured": bool(settings.ssh_key_passphrase),
        }

    @app.get("/api/admin/autodl", dependencies=[Depends(require_admin)])
    def get_autodl():
        return remote_operation(admin_snapshot)

    @app.put("/api/admin/autodl", dependencies=[Depends(require_admin)])
    def save_autodl(config: RemoteConfig):
        def save():
            remote.save(config)
            return admin_snapshot()

        return remote_operation(save)

    @app.post("/api/admin/autodl/test", dependencies=[Depends(require_admin)])
    def test_autodl(payload: ConnectionRequest | None = None):
        payload = payload or ConnectionRequest()
        remote_operation(lambda: remote.test(payload.password, payload.scope, payload.config))
        return remote_operation(admin_snapshot)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/capabilities")
    def capabilities():
        remote_status = remote.status()
        return {
            "phase": "remote-connection",
            "input": {"extension": ".xyz", "point_count": INPUT_POINTS, "max_bytes": MAX_BYTES},
            "task_statuses": [status.value for status in TaskStatus],
            "algorithm": "PCN continuous probability + PD-LTS",
            "remote_ready": remote_status == "ready",
            "remote_connection": {"status": remote_status},
            "features": {
                "authentication": False,
                "upload": False,
                "denoising": False,
                "remote_connection": True,
            },
        }

    return app


app = create_app()
