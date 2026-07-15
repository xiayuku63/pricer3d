"""pricer3d — 3D Printing Parts Automated Quoting System."""

import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("PORT", os.getenv("UVICORN_PORT", "5001")))
    reload_ = os.getenv("UVICORN_RELOAD", "true").lower() in {"1", "true", "yes", "on"}

    import uvicorn.config

    uvicorn.run("main:app", host=host, port=port, reload=reload_)
