"""Long-running scheduler: executes the pipeline on a fixed interval."""

import logging
import threading
import time

import schedule

from globular_adsb import config
from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT, run_fetch, run_render

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    fetch_interval = config.FETCH_INTERVAL_MINUTES
    render_interval = config.RENDER_INTERVAL_MINUTES
    log.info(
        "Scheduler started — fetch every %d min, render+upload every %d min. Ctrl-C to stop.",
        fetch_interval,
        render_interval,
    )

    run_fetch()
    run_render()

    _render_lock = threading.Lock()

    def _dispatch(fn, lock=None):
        if lock is not None and not lock.acquire(blocking=False):
            log.warning("%s already running, skipping this tick.", fn.__name__)
            return

        def _run():
            try:
                fn()
            except Exception:
                log.exception("Unhandled error in %s thread", fn.__name__)
            finally:
                if lock is not None:
                    lock.release()

        threading.Thread(target=_run, daemon=True).start()

    schedule.every(fetch_interval).minutes.do(_dispatch, run_fetch)
    schedule.every(render_interval).minutes.do(_dispatch, run_render, _render_lock)
    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
