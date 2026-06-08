"""`python -m admin` → uvicorn 으로 FastAPI 띄우기."""

import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "admin.app:app",
        host=os.environ.get("ADMIN_HOST", "127.0.0.1"),
        port=int(os.environ.get("ADMIN_PORT", "8765")),
        reload=os.environ.get("ADMIN_RELOAD", "1") == "1",
    )
