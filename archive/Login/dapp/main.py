# main.py
from fastapi import FastAPI
from app.api.routes import assets, auth, dashboard, scans, reports
from app.core.errors import global_exception_handler

app = FastAPI(
    title="Digital Asset Protection Platform",
    version="1.0.0",
)

app.include_router(assets.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(scans.router)
app.include_router(reports.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.add_exception_handler(Exception, global_exception_handler)
