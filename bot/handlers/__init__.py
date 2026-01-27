from . import admins, chapters, deploy, flow_control, ingest, logs, manhwa, settings, start, webapp

ROUTERS = [
    start.router,
    manhwa.router,
    chapters.router,
    settings.router,
    deploy.router,
    admins.router,
    logs.router,
    flow_control.router,
    webapp.router,
    ingest.router,
]

