"""Job worker: claims queued jobs from Neon and runs the analysis pipeline.

Run from ai-service/ (alongside `npm run dev` in the project root):

    .venv/bin/python worker.py            # loop forever
    .venv/bin/python worker.py --once     # process at most one job, then exit
"""

from __future__ import annotations

import argparse
import logging
import time

import psycopg

import jobs
from pipeline import run_analysis
from tiles import TileError

log = logging.getLogger("worker")

POLL_INTERVAL_S = 2.0


def process(conn: psycopg.Connection, job: jobs.Job) -> None:
    log.info("job %s: %s started", job.id, job.kind)
    t0 = time.monotonic()
    report = jobs.ProgressWriter(conn, job.id)
    try:
        result = run_analysis(job.kind, job.polygon, report=report)
    except jobs.JobCancelled:
        log.info("job %s: cancelled", job.id)
        return
    except (TileError, ValueError) as exc:
        # Expected, user-facing problems (no imagery, too many tiles, bad polygon).
        log.warning("job %s: %s", job.id, exc)
        jobs.fail(conn, job.id, str(exc))
        return
    except Exception as exc:
        log.exception("job %s: crashed", job.id)
        jobs.fail(conn, job.id, f"Internal error: {exc.__class__.__name__}")
        return

    n = len(result.geojson["features"])
    jobs.complete(conn, job.id, result.geojson, result.stats, f"Found {n} object(s)")
    log.info("job %s: done, %d object(s) in %.1fs", job.id, n, time.monotonic() - t0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process at most one job and exit")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    conn: psycopg.Connection | None = None
    log.info("worker started, polling every %.0fs", POLL_INTERVAL_S)
    while True:
        try:
            if conn is None or conn.closed:
                conn = jobs.connect()
            job = jobs.claim_next(conn)
        except psycopg.OperationalError as exc:
            log.warning("database unavailable (%s); retrying", exc.__class__.__name__)
            conn = None
            time.sleep(POLL_INTERVAL_S * 2)
            continue

        if job:
            process(conn, job)
        elif args.once:
            log.info("no queued jobs")
        if args.once:
            break
        if not job:
            time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
