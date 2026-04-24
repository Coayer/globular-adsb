"""Long-running scheduler: executes the pipeline on a fixed interval."""

import logging
import time

import schedule

from globular_adsb import config
from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT, run

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    interval = config.SCHEDULE_INTERVAL_MINUTES
    log.info("Scheduler started — pipeline runs every %d minute(s). Ctrl-C to stop.", interval)

    run()  # run immediately on startup

    schedule.every(interval).minutes.do(run)
    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
