"""Job queue on the Neon `jobs` table (schema owned by Drizzle in ../db).

The worker only reads and updates rows; it never creates or alters tables.
Claiming uses `FOR UPDATE SKIP LOCKED`, so several workers can run at once
without picking up the same job.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from config import settings


class JobCancelled(Exception):
    """The job was cancelled (DELETE /api/jobs/:id) while running."""


@dataclass
class Job:
    id: str
    kind: str
    polygon: dict


def connect() -> psycopg.Connection:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    # connect_timeout applies per address, so a dead IPv6 route falls
    # through to IPv4 instead of hanging.
    return psycopg.connect(
        settings.database_url, autocommit=True, connect_timeout=5, row_factory=dict_row
    )


def claim_next(conn: psycopg.Connection) -> Job | None:
    row = conn.execute(
        """
        update jobs
           set status = 'running', progress = 0,
               started_at = now(), updated_at = now()
         where id = (
               select id from jobs
                where status = 'queued'
                order by created_at
                for update skip locked
                limit 1)
        returning id, kind, input
        """
    ).fetchone()
    if not row:
        return None
    return Job(id=str(row["id"]), kind=row["kind"], polygon=row["input"]["polygon"])


class ProgressWriter:
    """Throttled progress updates; raises JobCancelled if the row is no
    longer 'running' (the API sets 'cancelled')."""

    def __init__(self, conn: psycopg.Connection, job_id: str, min_interval_s: float = 1.0):
        self.conn = conn
        self.job_id = job_id
        self.min_interval_s = min_interval_s
        self._last = 0.0

    def __call__(self, frac: float) -> None:
        now = time.monotonic()
        if now - self._last < self.min_interval_s and frac < 1.0:
            return
        self._last = now
        row = self.conn.execute(
            """
            update jobs set progress = %s, updated_at = now()
             where id = %s and status = 'running'
            returning id
            """,
            (min(max(frac, 0.0), 1.0), self.job_id),
        ).fetchone()
        if row is None:
            raise JobCancelled(self.job_id)


def complete(conn: psycopg.Connection, job_id: str, geojson: dict, stats: dict, message: str) -> None:
    conn.execute(
        """
        update jobs
           set status = 'done', progress = 1, message = %s, result = %s, stats = %s,
               finished_at = now(), updated_at = now()
         where id = %s and status = 'running'
        """,
        (message, Jsonb(geojson), Jsonb(stats), job_id),
    )


def fail(conn: psycopg.Connection, job_id: str, error: str) -> None:
    conn.execute(
        """
        update jobs
           set status = 'error', error = %s, finished_at = now(), updated_at = now()
         where id = %s and status = 'running'
        """,
        (error[:2000], job_id),
    )
