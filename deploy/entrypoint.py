from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


processes = [subprocess.Popen([
    "python",
    "-m",
    "uvicorn",
    "assistant.app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    os.getenv("ASSISTANT_PORT", "4175"),
])]


def stop_processes(*_: int) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


signal.signal(signal.SIGTERM, stop_processes)
signal.signal(signal.SIGINT, stop_processes)

try:
    deadline = time.monotonic() + 60
    while True:
        if processes[0].poll() is not None:
            raise RuntimeError("The assistant service exited before becoming ready.")
        try:
            assistant_port = os.getenv("ASSISTANT_PORT", "4175")
            with urlopen(f"http://127.0.0.1:{assistant_port}/api/assistant/health", timeout=1):
                break
        except (URLError, TimeoutError):
            if time.monotonic() >= deadline:
                raise TimeoutError("The assistant service did not become ready within 60 seconds.")
            time.sleep(0.25)
    processes.append(subprocess.Popen(["node", "src/server/index.ts"]))

    while True:
        for process in processes:
            exit_code = process.poll()
            if exit_code is not None:
                stop_processes()
                sys.exit(exit_code or 1)
        time.sleep(0.5)
finally:
    stop_processes()
