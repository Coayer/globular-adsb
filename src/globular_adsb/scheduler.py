"""Long-running scheduler: executes the pipeline on a fixed interval."""

import time

import schedule

from globular_adsb import config
from globular_adsb.pipeline import run


def main() -> None:
    interval = config.SCHEDULE_INTERVAL_MINUTES
    print(f"Scheduler started — pipeline runs every {interval} minute(s). Ctrl-C to stop.")

    run()  # run immediately on startup

    schedule.every(interval).minutes.do(run)
    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
